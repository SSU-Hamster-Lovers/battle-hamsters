import Phaser from "phaser";
import {
  trainingArenaMap,
  weaponDefinitionById,
} from "@battle-hamsters/shared";
import type {
  CollisionPrimitive,
  HazardZone,
  JoinRoomMessage,
  PlayerInputMessage,
  PlayerSnapshot,
  SpawnPoint,
  RoomSnapshotMessage,
  ServerToClientMessage,
  WorldWeaponPickup,
  WorldSnapshotMessage,
} from "@battle-hamsters/shared";

const MAP_DEFINITION = trainingArenaMap;
const GAME_WIDTH = MAP_DEFINITION.size.width;
const GAME_HEIGHT = MAP_DEFINITION.size.height;
const ROOM_ID = "room_alpha";
const WS_URL =
  import.meta.env.VITE_SERVER_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8081/ws`;
const PLAYER_NAME_STORAGE_KEY = "battle-hamsters-player-name";
const INPUT_SEND_INTERVAL_MS = 50;
const PLAYER_SIZE = 28;

const COLLISION_PRIMITIVES: CollisionPrimitive[] = MAP_DEFINITION.collision;
const HAZARDS: HazardZone[] = MAP_DEFINITION.hazards;
const SPAWN_POINTS: SpawnPoint[] = MAP_DEFINITION.spawnPoints;

const PRIMARY_FLOOR =
  COLLISION_PRIMITIVES.find(
    (
      primitive,
    ): primitive is CollisionPrimitive & { type: "floor"; topY: number } =>
      primitive.type === "floor",
  ) ?? null;

const PRIMARY_FALL_ZONE =
  HAZARDS.find(
    (
      hazard,
    ): hazard is HazardZone & {
      type: "fall_zone";
      x: number;
      y: number;
      width: number;
      height: number;
    } => hazard.type === "fall_zone" && isRectHazard(hazard),
  ) ?? null;

const PIT_WALLS = COLLISION_PRIMITIVES.filter(
  (
    primitive,
  ): primitive is CollisionPrimitive & {
    type: "solid_wall";
    x: number;
    topY: number;
    bottomY: number;
  } => primitive.type === "solid_wall",
);

type RenderedPlayer = {
  body: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
};

type RenderedWeaponPickup = {
  body: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
};

function drawCross(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
) {
  graphics.lineBetween(x - size, y, x + size, y);
  graphics.lineBetween(x, y - size, x, y + size);
}

function isRectHazard(hazard: HazardZone): hazard is HazardZone & {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return "width" in hazard && "height" in hazard;
}

function getOrCreatePlayerName(): string {
  const existing = window.sessionStorage.getItem(PLAYER_NAME_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const generated = `hammy-${Math.random().toString(36).slice(2, 6)}`;
  window.sessionStorage.setItem(PLAYER_NAME_STORAGE_KEY, generated);
  return generated;
}

class MainScene extends Phaser.Scene {
  private socket: WebSocket | null = null;
  private statusText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private connectionText!: Phaser.GameObjects.Text;
  private attackFlash!: Phaser.GameObjects.Graphics;
  private attackFlashUntil = 0;
  private renderedPlayers = new Map<string, RenderedPlayer>();
  private renderedWeaponPickups = new Map<string, RenderedWeaponPickup>();
  private playerName = getOrCreatePlayerName();
  private localPlayerId: string | null = null;
  private latestTick = 0;
  private sequence = 0;
  private queuedClickAttack = false;
  private attackWasDown = false;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    q: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super("MainScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#111827");
    this.drawStage();

    this.statusText = this.add
      .text(24, 20, "Battle Hamsters", {
        fontSize: "28px",
        color: "#f9fafb",
      })
      .setDepth(10);

    this.connectionText = this.add
      .text(24, 58, `Connecting to ${WS_URL}`, {
        fontSize: "16px",
        color: "#93c5fd",
      })
      .setDepth(10);

    this.infoText = this.add
      .text(24, 88, "", {
        fontSize: "14px",
        color: "#d1d5db",
        lineSpacing: 6,
      })
      .setDepth(10);

    this.attackFlash = this.add.graphics().setDepth(9);

    this.add.text(24, GAME_HEIGHT - 70, "Move: A / D or Arrow Left / Right", {
      fontSize: "14px",
      color: "#9ca3af",
    });
    this.add.text(
      24,
      GAME_HEIGHT - 46,
      "Jump: W / Space / Up  |  Down: S / Down",
      {
        fontSize: "14px",
        color: "#9ca3af",
      },
    );
    this.add.text(
      24,
      GAME_HEIGHT - 22,
      "Q: Drop Weapon  |  Mouse: Aim / Attack",
      {
        fontSize: "14px",
        color: "#9ca3af",
      },
    );

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is unavailable in this Phaser scene");
    }

    this.cursors = keyboard.createCursorKeys();
    this.keys = {
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      q: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      space: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };

    this.time.addEvent({
      delay: INPUT_SEND_INTERVAL_MS,
      loop: true,
      callback: () => this.sendLatestInput(),
    });

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.socket?.close());
    this.events.on(Phaser.Scenes.Events.DESTROY, () => this.socket?.close());
    this.input.on("pointerdown", () => {
      this.queuedClickAttack = true;
    });

    this.connect();
  }

  private drawStage() {
    for (const primitive of COLLISION_PRIMITIVES) {
      if (primitive.type === "floor") {
        this.add.rectangle(
          primitive.leftX + (primitive.rightX - primitive.leftX) / 2,
          primitive.topY + (GAME_HEIGHT - primitive.topY) / 2,
          primitive.rightX - primitive.leftX,
          GAME_HEIGHT - primitive.topY,
          0x1f2937,
        );
      }

      if (primitive.type === "one_way_platform") {
        this.add.rectangle(
          primitive.leftX + (primitive.rightX - primitive.leftX) / 2,
          primitive.topY + 6,
          primitive.rightX - primitive.leftX,
          12,
          0x60a5fa,
        );
      }
    }

    for (const hazard of HAZARDS) {
      if (!isRectHazard(hazard)) {
        continue;
      }

      if (hazard.type === "fall_zone") {
        continue;
      }

      this.add.rectangle(
        hazard.x + hazard.width / 2,
        hazard.y + hazard.height / 2,
        hazard.width,
        hazard.height,
        0xc026d3,
        0.55,
      );
    }

    const debug = this.add.graphics().setDepth(2);
    for (const primitive of COLLISION_PRIMITIVES) {
      if (primitive.type === "floor") {
        debug.lineStyle(2, 0x22c55e, 0.9);
        debug.lineBetween(
          primitive.leftX,
          primitive.topY,
          primitive.rightX,
          primitive.topY,
        );
      }

      if (primitive.type === "one_way_platform") {
        debug.lineStyle(2, 0x38bdf8, 0.9);
        debug.lineBetween(
          primitive.leftX,
          primitive.topY,
          primitive.rightX,
          primitive.topY,
        );
      }

      if (primitive.type === "solid_wall") {
        debug.lineStyle(2, 0xfb923c, 0.9);
        debug.lineBetween(
          primitive.x,
          primitive.topY,
          primitive.x,
          primitive.bottomY,
        );
      }
    }

    for (const hazard of HAZARDS) {
      if (!isRectHazard(hazard)) {
        continue;
      }

      if (hazard.type === "fall_zone") {
        continue;
      }

      debug.lineStyle(2, 0xe879f9, 0.95);
      debug.strokeRect(hazard.x, hazard.y, hazard.width, hazard.height);
    }

    debug.lineStyle(2, 0xfbbf24, 0.9);
    for (const spawnPoint of SPAWN_POINTS) {
      drawCross(debug, spawnPoint.x, spawnPoint.y, 8);
    }

    const oneWayPlatform = COLLISION_PRIMITIVES.find(
      (
        primitive,
      ): primitive is CollisionPrimitive & {
        type: "one_way_platform";
        leftX: number;
        topY: number;
      } => primitive.type === "one_way_platform",
    );
    if (oneWayPlatform) {
      this.add.text(
        oneWayPlatform.leftX,
        oneWayPlatform.topY - 24,
        "원웨이 플랫폼",
        {
          fontSize: "12px",
          color: "#93c5fd",
        },
      );
    }

    if (PRIMARY_FLOOR) {
      this.add.text(24, PRIMARY_FLOOR.topY + 12, "바닥 충돌면", {
        fontSize: "12px",
        color: "#d1d5db",
      });
    }

    const instantKillHazard = HAZARDS.find(
      (
        hazard,
      ): hazard is HazardZone & {
        type: "instant_kill_hazard";
        x: number;
        y: number;
      } => hazard.type === "instant_kill_hazard" && isRectHazard(hazard),
    );
    if (instantKillHazard) {
      this.add.text(
        instantKillHazard.x,
        instantKillHazard.y - 24,
        "즉사 함정",
        {
          fontSize: "12px",
          color: "#f5d0fe",
        },
      );
    }

    for (const wall of PIT_WALLS) {
      this.add.text(wall.x - 48, wall.topY + 24, "pit wall", {
        fontSize: "12px",
        color: "#fed7aa",
      });
    }

    if (PRIMARY_FALL_ZONE) {
      this.add.text(
        24,
        PRIMARY_FALL_ZONE.y > GAME_HEIGHT
          ? GAME_HEIGHT - 96
          : PRIMARY_FALL_ZONE.y + 24,
        "fall zone은 화면 밖 논리 영역",
        {
          fontSize: "12px",
          color: "#a78bfa",
        },
      );
    }

    this.add
      .text(
        24,
        112,
        "디버그: 초록=바닥, 파랑=원웨이, 주황=벽, 분홍=hazard, 노랑=spawn",
        {
          fontSize: "12px",
          color: "#a5b4fc",
        },
      )
      .setDepth(10);
  }

  private connect() {
    this.socket = new WebSocket(WS_URL);

    this.socket.addEventListener("open", () => {
      this.connectionText.setText(`Connected as ${this.playerName}`);
      this.connectionText.setColor("#86efac");
      this.send({
        type: "join_room",
        timestamp: Date.now(),
        payload: {
          roomId: ROOM_ID,
          playerName: this.playerName,
        },
      } satisfies JoinRoomMessage);
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerToClientMessage;
      this.handleServerMessage(message);
    });

    this.socket.addEventListener("close", () => {
      this.connectionText.setText(
        "Disconnected from server. Retrying in 2s...",
      );
      this.connectionText.setColor("#fca5a5");
      this.localPlayerId = null;
      this.clearRenderedPlayers();
      this.clearRenderedWeaponPickups();
      this.time.delayedCall(2000, () => {
        if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
          this.connect();
        }
      });
    });

    this.socket.addEventListener("error", () => {
      this.connectionText.setText("WebSocket error. Check the Rust server.");
      this.connectionText.setColor("#fca5a5");
    });
  }

  private handleServerMessage(message: ServerToClientMessage) {
    switch (message.type) {
      case "welcome": {
        this.connectionText.setText(
          `Connected (${message.payload.connectionId}) / waiting for room join...`,
        );
        this.connectionText.setColor("#86efac");
        return;
      }
      case "room_snapshot": {
        this.applyRoomSnapshot(message);
        return;
      }
      case "world_snapshot": {
        this.applyWorldSnapshot(message);
        return;
      }
      case "player_joined": {
        this.connectionText.setText(`Player joined: ${message.payload.name}`);
        this.connectionText.setColor("#93c5fd");
        return;
      }
      case "player_left": {
        this.removeRenderedPlayer(message.payload.playerId);
        this.connectionText.setText(`Player left: ${message.payload.playerId}`);
        this.connectionText.setColor("#fca5a5");
        return;
      }
      case "pong": {
        return;
      }
      case "error": {
        this.connectionText.setText(`Server error: ${message.payload.code}`);
        this.connectionText.setColor("#fca5a5");
      }
    }
  }

  private applyRoomSnapshot(message: RoomSnapshotMessage) {
    if (message.payload.selfPlayerId) {
      this.localPlayerId = message.payload.selfPlayerId;
    }
    this.renderPlayers(message.payload.players);
    this.renderWeaponPickups(message.payload.weaponPickups);
    this.captureLocalPlayer(message.payload.players);
    this.updateInfoText(message.payload.players, "waiting", null);
  }

  private applyWorldSnapshot(message: WorldSnapshotMessage) {
    this.latestTick = message.payload.serverTick;
    this.renderPlayers(message.payload.players);
    this.renderWeaponPickups(message.payload.weaponPickups);
    this.captureLocalPlayer(message.payload.players);
    this.updateInfoText(
      message.payload.players,
      message.payload.matchState,
      message.payload.timeRemainingMs,
    );
  }

  private updateInfoText(
    players: PlayerSnapshot[],
    matchState: string,
    timeRemainingMs: number | null,
  ) {
    const localPlayer = players.find(
      (player) => player.id === this.localPlayerId,
    );
    this.infoText.setText([
      `room: ${ROOM_ID}`,
      `players: ${players.length}`,
      `match: ${matchState}`,
      `self: ${this.localPlayerId ?? "unknown"}`,
      `weapon: ${localPlayer ? (weaponDefinitionById[localPlayer.equippedWeaponId]?.name ?? localPlayer.equippedWeaponId) : "unknown"}`,
      `ammo: ${localPlayer?.equippedWeaponResource ?? "∞"}`,
      `grounded: ${localPlayer?.grounded ?? false}`,
      `state: ${localPlayer?.state ?? "unknown"}`,
      `jumps used: ${localPlayer?.jumpCountUsed ?? 0}`,
      `lives: ${localPlayer?.lives ?? 0}`,
      `tick: ${this.latestTick}`,
      `time remaining: ${timeRemainingMs === null ? "waiting" : `${Math.ceil(timeRemainingMs / 1000)}s`}`,
    ]);
  }

  private captureLocalPlayer(players: PlayerSnapshot[]) {
    if (this.localPlayerId) {
      return;
    }

    const local = players.find((player) => player.name === this.playerName);
    if (local) {
      this.localPlayerId = local.id;
    }
  }

  private renderPlayers(players: PlayerSnapshot[]) {
    const nextIds = new Set(players.map((player) => player.id));

    for (const player of players) {
      let rendered = this.renderedPlayers.get(player.id);
      if (!rendered) {
        rendered = {
          body: this.add.rectangle(
            player.position.x,
            player.position.y,
            PLAYER_SIZE,
            PLAYER_SIZE,
            0xf59e0b,
          ),
          label: this.add.text(
            player.position.x,
            player.position.y - 28,
            player.name,
            {
              fontSize: "12px",
              color: "#f9fafb",
            },
          ),
        };
        this.renderedPlayers.set(player.id, rendered);
      }

      const isLocalPlayer = player.id === this.localPlayerId;
      const baseColor = isLocalPlayer ? 0x34d399 : 0xf59e0b;
      const color = player.state === "respawning" ? 0x94a3b8 : baseColor;

      rendered.body.setFillStyle(color);
      rendered.body.setStrokeStyle(
        2,
        isLocalPlayer ? 0xeafff7 : 0xffedd5,
        0.95,
      );
      rendered.body.setPosition(player.position.x, player.position.y);
      rendered.label.setText(
        player.state === "respawning"
          ? `${player.name} (리스폰 중)`
          : player.name,
      );
      rendered.label.setPosition(
        player.position.x - rendered.label.width / 2,
        player.position.y - 32,
      );
      rendered.body.setAlpha(player.state === "alive" ? 1 : 0.35);
    }

    for (const [playerId] of this.renderedPlayers) {
      if (!nextIds.has(playerId)) {
        this.removeRenderedPlayer(playerId);
      }
    }
  }

  private removeRenderedPlayer(playerId: string) {
    const rendered = this.renderedPlayers.get(playerId);
    if (!rendered) {
      return;
    }

    rendered.body.destroy();
    rendered.label.destroy();
    this.renderedPlayers.delete(playerId);
  }

  private clearRenderedPlayers() {
    for (const playerId of [...this.renderedPlayers.keys()]) {
      this.removeRenderedPlayer(playerId);
    }
  }

  private clearRenderedWeaponPickups() {
    for (const [pickupId, rendered] of this.renderedWeaponPickups) {
      rendered.body.destroy();
      rendered.label.destroy();
      this.renderedWeaponPickups.delete(pickupId);
    }
  }

  private renderWeaponPickups(weaponPickups: WorldWeaponPickup[]) {
    const nextIds = new Set(weaponPickups.map((pickup) => pickup.id));

    for (const pickup of weaponPickups) {
      let rendered = this.renderedWeaponPickups.get(pickup.id);
      const weaponName =
        weaponDefinitionById[pickup.weaponId]?.name ?? pickup.weaponId;

      if (!rendered) {
        rendered = {
          body: this.add.ellipse(
            pickup.position.x,
            pickup.position.y,
            22,
            14,
            pickup.source === "spawn" ? 0x38bdf8 : 0xf97316,
            0.95,
          ),
          label: this.add.text(
            pickup.position.x,
            pickup.position.y - 18,
            weaponName,
            {
              fontSize: "11px",
              color: "#f8fafc",
            },
          ),
        };
        this.renderedWeaponPickups.set(pickup.id, rendered);
      }

      rendered.body.setPosition(pickup.position.x, pickup.position.y);
      rendered.body.setFillStyle(
        pickup.source === "spawn" ? 0x38bdf8 : 0xf97316,
        0.95,
      );
      rendered.label.setText(`${weaponName} (${pickup.resourceRemaining})`);
      rendered.label.setPosition(
        pickup.position.x - rendered.label.width / 2,
        pickup.position.y - 20,
      );
    }

    for (const [pickupId, rendered] of this.renderedWeaponPickups) {
      if (!nextIds.has(pickupId)) {
        rendered.body.destroy();
        rendered.label.destroy();
        this.renderedWeaponPickups.delete(pickupId);
      }
    }
  }

  private sendLatestInput() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const localPlayer = this.localPlayerId
      ? this.renderedPlayers.get(this.localPlayerId)
      : null;
    const pointer = this.input.activePointer;
    const originX = localPlayer?.body.x ?? GAME_WIDTH / 2;
    const originY = localPlayer?.body.y ?? GAME_HEIGHT / 2;
    const aimX = pointer.worldX - originX;
    const aimY = pointer.worldY - originY;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    const aim = { x: aimX / aimLength, y: aimY / aimLength };

    const moveX =
      Number(this.cursors.right.isDown || this.keys.d.isDown) -
      Number(this.cursors.left.isDown || this.keys.a.isDown);
    const moveY = Number(this.cursors.down.isDown || this.keys.s.isDown);
    const attackPressed = pointer.isDown || this.queuedClickAttack;
    if (attackPressed && !this.attackWasDown) {
      this.showAttackFlash(originX, originY, aim.x, aim.y);
    }
    this.attackWasDown = pointer.isDown;

    this.send({
      type: "player_input",
      timestamp: Date.now(),
      payload: {
        sequence: ++this.sequence,
        move: { x: moveX, y: moveY },
        aim,
        jump:
          Phaser.Input.Keyboard.JustDown(this.keys.space) ||
          Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
          Phaser.Input.Keyboard.JustDown(this.keys.w),
        attack: attackPressed,
        dropWeapon: Phaser.Input.Keyboard.JustDown(this.keys.q),
      },
    } satisfies PlayerInputMessage);
    this.queuedClickAttack = false;
  }

  private showAttackFlash(
    originX: number,
    originY: number,
    aimX: number,
    aimY: number,
  ) {
    this.attackFlash.clear();
    this.attackFlash.lineStyle(3, 0xfef08a, 0.95);
    this.attackFlash.lineBetween(
      originX,
      originY,
      originX + aimX * 46,
      originY + aimY * 46,
    );
    this.attackFlash.fillStyle(0xfef08a, 0.9);
    this.attackFlash.fillCircle(originX + aimX * 20, originY + aimY * 20, 3);
    this.attackFlashUntil = this.time.now + 80;
  }

  private send(message: JoinRoomMessage | PlayerInputMessage) {
    this.socket?.send(JSON.stringify(message));
  }

  update() {
    if (this.attackFlashUntil !== 0 && this.time.now > this.attackFlashUntil) {
      this.attackFlash.clear();
      this.attackFlashUntil = 0;
    }
    this.statusText.setText(
      `Battle Hamsters  |  server tick ${this.latestTick}  |  room ${ROOM_ID}`,
    );
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#111827",
  scene: MainScene,
});
