import Phaser from "phaser";
import {
  itemDefinitionById,
  trainingArenaMap,
  weaponDefinitionById,
} from "@battle-hamsters/shared";
import {
  ensureHamsterPlaceholderTextures,
  hamsterTextureForSnapshot,
} from "./hamster-visuals";
import type {
  CollisionPrimitive,
  HazardZone,
  JoinRoomMessage,
  KillFeedEntry,
  PlayerInputMessage,
  PlayerSnapshot,
  SpawnPoint,
  RoomSnapshotMessage,
  ServerToClientMessage,
  WorldItemPickup,
  WorldWeaponPickup,
  WorldSnapshotMessage,
} from "@battle-hamsters/shared";

const MAP_DEFINITION = trainingArenaMap;
const GAME_WIDTH = MAP_DEFINITION.size.width;
const GAME_HEIGHT = MAP_DEFINITION.size.height;
const WS_URL =
  import.meta.env.VITE_SERVER_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8081/ws`;
const PLAYER_NAME_STORAGE_KEY = "battle-hamsters-player-name";
const PLAYER_ID_STORAGE_KEY = "battle-hamsters-player-id";
const OPS_ACCESS_STORAGE_KEY = "battle-hamsters-ops-access";
const DEBUG_VISIBLE_STORAGE_KEY = "battle-hamsters-debug-visible";
const FREE_PLAY_ROOM_ID = "free_play";

function getUrlParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

function parseBooleanUrlParam(key: string): boolean | null {
  const value = getUrlParam(key);
  if (value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }

  return true;
}

function readStoredFlag(key: string): boolean {
  return window.localStorage.getItem(key) === "1";
}

function writeStoredFlag(key: string, enabled: boolean) {
  window.localStorage.setItem(key, enabled ? "1" : "0");
}

function resolveOpsAccess(): boolean {
  const fromUrl = parseBooleanUrlParam("ops");
  if (fromUrl !== null) {
    writeStoredFlag(OPS_ACCESS_STORAGE_KEY, fromUrl);
    return fromUrl;
  }

  return readStoredFlag(OPS_ACCESS_STORAGE_KEY);
}

function resolveInitialDebugVisible(opsAccess: boolean): boolean {
  if (!opsAccess) {
    writeStoredFlag(DEBUG_VISIBLE_STORAGE_KEY, false);
    return false;
  }

  const fromUrl = parseBooleanUrlParam("debug");
  if (fromUrl !== null) {
    writeStoredFlag(DEBUG_VISIBLE_STORAGE_KEY, fromUrl);
    return fromUrl;
  }

  return readStoredFlag(DEBUG_VISIBLE_STORAGE_KEY);
}

// URL ?room=xxxx 이 있으면 그 값, 없으면 자유맵
const ROOM_ID =
  getUrlParam("room") ?? getUrlParam("roomId") ?? FREE_PLAY_ROOM_ID;
const INPUT_SEND_INTERVAL_MS = 50;
const PLAYER_SIZE = 28;
const REMOTE_PLAYER_LERP = 0.22;
const LOCAL_PLAYER_LERP = 0.35;
const PICKUP_LERP = 0.24;
const PLAYER_SNAP_DISTANCE = 96;
const PICKUP_SNAP_DISTANCE = 72;
const CAMERA_FOLLOW_LERP_X = 0.1;
const CAMERA_FOLLOW_LERP_Y = 0.1;
// Fixed canvas (viewport) dimensions. Separate from MAP_DEFINITION.size which
// is the full world/map size that the camera scrolls over.
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;
const MATCH_MIN_PLAYERS_DISPLAY = 2;
const KILL_FEED_TTL_MS = 3_000;
const KILL_FEED_DISMISSED_RETENTION_MS = 5_000;
const KILL_FEED_LINE_HEIGHT = 18;
const KILL_FEED_MARGIN_X = 24;
const KILL_FEED_MARGIN_Y = 24;
const KILL_FEED_SLIDE_IN_DISTANCE = 96;
const KILL_FEED_SLIDE_IN_MS = 200;
const KILL_FEED_EXIT_RISE = 18;
const KILL_FEED_EXIT_MS = 280;

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
  root: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  collider: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  isLocal: boolean;
  snapshot: PlayerSnapshot;
};

type RenderedWeaponPickup = {
  body: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
};

type RenderedItemPickup = {
  body: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
};

type VisibilityControlledObject =
  Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible;

type DeathEcho = {
  sprite: Phaser.GameObjects.Image;
  velocityX: number;
  velocityY: number;
  angularVelocity: number;
  fadeAt: number;
  destroyAt: number;
  baseAlpha: number;
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

function shouldSnapToTarget(
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  threshold: number,
) {
  const dx = targetX - currentX;
  const dy = targetY - currentY;
  return dx * dx + dy * dy > threshold * threshold;
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
  // URL 파라미터 우선 (Portal 에서 전달)
  const fromUrl = getUrlParam("name");
  if (fromUrl) {
    return fromUrl;
  }
  const existing = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = `hammy-${Math.random().toString(36).slice(2, 6)}`;
  window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, generated);
  return generated;
}

function getOrCreatePlayerId(): string {
  const fromUrl = getUrlParam("pid");
  if (fromUrl) {
    return fromUrl;
  }
  const existing = window.localStorage.getItem(PLAYER_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  // UUID v4 lite (crypto.randomUUID 미지원 브라우저 fallback)
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(PLAYER_ID_STORAGE_KEY, id);
  return id;
}

function resolvePlayerName(playerId: string, players: PlayerSnapshot[]): string {
  const match = players.find((player) => player.id === playerId);
  return match ? match.name : playerId;
}

function resolveWeaponName(weaponId: string): string {
  return weaponDefinitionById[weaponId]?.name ?? weaponId;
}

function formatKillFeedEntry(
  entry: KillFeedEntry,
  players: PlayerSnapshot[],
): string {
  const victim = resolvePlayerName(entry.victimId, players);
  switch (entry.cause.kind) {
    case "fall_zone":
      return `${victim} → 낙사`;
    case "instant_kill_hazard":
      return `${victim} → 함정`;
    case "weapon": {
      const killer = resolvePlayerName(entry.cause.killerId, players);
      const weapon = resolveWeaponName(entry.cause.weaponId);
      return `${killer} → ${weapon} → ${victim}`;
    }
    case "self":
      return `${victim} → 자살`;
  }
}

function killFeedColorForCause(kind: KillFeedEntry["cause"]["kind"]): string {
  switch (kind) {
    case "fall_zone":
      return "#fde68a";
    case "instant_kill_hazard":
      return "#f0abfc";
    case "weapon":
      return "#fecaca";
    case "self":
      return "#c4b5fd";
  }
}

class MainScene extends Phaser.Scene {
  private socket: WebSocket | null = null;
  private statusText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private connectionText!: Phaser.GameObjects.Text;
  private attackFlash!: Phaser.GameObjects.Graphics;
  private attackFlashUntil = 0;
  private matchOverlayBg!: Phaser.GameObjects.Rectangle;
  private matchOverlayText!: Phaser.GameObjects.Text;
  private cameraConfigured = false;
  private debugLayer: VisibilityControlledObject[] = [];
  private deathEchoes: DeathEcho[] = [];
  private renderedPlayers = new Map<string, RenderedPlayer>();
  private renderedWeaponPickups = new Map<string, RenderedWeaponPickup>();
  private renderedItemPickups = new Map<string, RenderedItemPickup>();
  private renderedKillFeed = new Map<
    string,
    {
      text: Phaser.GameObjects.Text;
      receivedAt: number;
      justEntered: boolean;
      slideInTween: Phaser.Tweens.Tween | null;
    }
  >();
  private dismissedKillFeedIds = new Map<string, number>();
  private playerName = getOrCreatePlayerName();
  // 미래 계정 연동용 — 현재는 로컬 저장만 하고 서버에 아직 전달하지 않음
  private readonly _playerId = getOrCreatePlayerId();
  private readonly debugAccess = resolveOpsAccess();
  private debugEnabled = resolveInitialDebugVisible(this.debugAccess);
  private localPlayerId: string | null = null;
  private latestTick = 0;
  private sequence = 0;
  private queuedClickAttack = false;
  private queuedPickupWeapon = false;
  private queuedDropWeapon = false;
  private attackWasDown = false;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    q: Phaser.Input.Keyboard.Key;
    e: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super("MainScene");
  }

  private addDebugObject<T extends VisibilityControlledObject>(object: T): T {
    object.setVisible(this.debugEnabled);
    this.debugLayer.push(object);
    return object;
  }

  private setDebugVisible(visible: boolean) {
    this.debugEnabled = this.debugAccess && visible;
    writeStoredFlag(DEBUG_VISIBLE_STORAGE_KEY, this.debugEnabled);

    for (const object of this.debugLayer) {
      object.setVisible(this.debugEnabled);
    }

    for (const [, rendered] of this.renderedPlayers) {
      rendered.collider.setVisible(
        this.debugEnabled && rendered.snapshot.state !== "respawning",
      );
    }
  }

  private toggleDebugVisible() {
    this.setDebugVisible(!this.debugEnabled);
  }

  private spawnDeathEcho(
    rendered: RenderedPlayer,
    previousSnapshot: PlayerSnapshot,
    nextSnapshot: PlayerSnapshot,
  ) {
    const cause = nextSnapshot.lastDeathCause;
    if (
      !cause ||
      cause.kind === "fall_zone" ||
      cause.kind === "instant_kill_hazard"
    ) {
      return;
    }

    const sprite = this.add
      .image(
        rendered.root.x,
        rendered.root.y,
        hamsterTextureForSnapshot(previousSnapshot, this.time.now),
      )
      .setDepth(5)
      .setAlpha(0.78);
    sprite.setFlipX(previousSnapshot.direction === "left");

    const drift = previousSnapshot.direction === "left" ? -1.5 : 1.5;
    this.deathEchoes.push({
      sprite,
      velocityX: previousSnapshot.velocity.x * 0.18 + drift,
      velocityY: Math.min(previousSnapshot.velocity.y * 0.2, 0) - 4.8,
      angularVelocity: drift * 0.03,
      fadeAt: this.time.now + 420,
      destroyAt: this.time.now + 980,
      baseAlpha: 0.78,
    });
  }

  private updateDeathEchoes(now: number) {
    for (let index = this.deathEchoes.length - 1; index >= 0; index -= 1) {
      const echo = this.deathEchoes[index];
      echo.sprite.x += echo.velocityX;
      echo.sprite.y += echo.velocityY;
      echo.velocityY += 0.42;
      echo.sprite.rotation += echo.angularVelocity;

      if (now >= echo.fadeAt) {
        const fadeWindow = echo.destroyAt - echo.fadeAt;
        const remaining = Math.max(0, echo.destroyAt - now);
        const ratio = fadeWindow <= 0 ? 0 : remaining / fadeWindow;
        echo.sprite.setAlpha(echo.baseAlpha * ratio);
      }

      if (now >= echo.destroyAt || echo.sprite.y > GAME_HEIGHT + 160) {
        echo.sprite.destroy();
        this.deathEchoes.splice(index, 1);
      }
    }
  }

  private clearDeathEchoes() {
    for (const echo of this.deathEchoes) {
      echo.sprite.destroy();
    }
    this.deathEchoes = [];
  }

  create() {
    this.cameras.main.setBackgroundColor("#111827");
    ensureHamsterPlaceholderTextures(this);
    this.drawStage();
    this.setDebugVisible(this.debugEnabled);

    this.statusText = this.add
      .text(24, 20, "Battle Hamsters", {
        fontSize: "28px",
        color: "#f9fafb",
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.connectionText = this.add
      .text(24, 58, `Connecting to ${WS_URL}`, {
        fontSize: "16px",
        color: "#93c5fd",
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.infoText = this.add
      .text(24, 88, "", {
        fontSize: "14px",
        color: "#d1d5db",
        lineSpacing: 6,
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.attackFlash = this.add.graphics().setDepth(9);

    this.matchOverlayBg = this.add
      .rectangle(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 0x000000, 0.6)
      .setDepth(20)
      .setScrollFactor(0)
      .setVisible(false);
    this.matchOverlayText = this.add
      .text(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2, "", {
        fontSize: "24px",
        color: "#f9fafb",
        align: "center",
        lineSpacing: 10,
      })
      .setOrigin(0.5)
      .setDepth(21)
      .setScrollFactor(0)
      .setVisible(false);

    this.add
      .text(24, VIEWPORT_HEIGHT - 70, "Move: A / D or Arrow Left / Right", {
        fontSize: "14px",
        color: "#9ca3af",
      })
      .setScrollFactor(0);
    this.add
      .text(24, VIEWPORT_HEIGHT - 46, "Jump: W / Space / Up  |  Down: S / Down", {
        fontSize: "14px",
        color: "#9ca3af",
      })
      .setScrollFactor(0);
    this.add
      .text(
        24,
        VIEWPORT_HEIGHT - 22,
        "E: Pick Up  |  Q: Drop Weapon  |  Mouse: Aim / Attack",
        {
          fontSize: "14px",
          color: "#9ca3af",
        },
      )
      .setScrollFactor(0);

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
      e: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      space: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };
    if (this.debugAccess) {
      keyboard.on("keydown-D", (event: KeyboardEvent) => {
        if (!event.altKey || !event.shiftKey) {
          return;
        }

        event.preventDefault();
        this.toggleDebugVisible();
      });
    }
    this.keys.e.on("down", () => {
      this.queuedPickupWeapon = true;
    });
    this.keys.q.on("down", () => {
      this.queuedDropWeapon = true;
    });

    this.time.addEvent({
      delay: INPUT_SEND_INTERVAL_MS,
      loop: true,
      callback: () => this.sendLatestInput(),
    });

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearDeathEchoes();
      this.socket?.close();
    });
    this.events.on(Phaser.Scenes.Events.DESTROY, () => {
      this.clearDeathEchoes();
      this.socket?.close();
    });
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

    const debug = this.addDebugObject(this.add.graphics().setDepth(2));
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
      this.addDebugObject(
        this.add.text(
          oneWayPlatform.leftX,
          oneWayPlatform.topY - 24,
          "원웨이 플랫폼",
          {
            fontSize: "12px",
            color: "#93c5fd",
          },
        ),
      );
    }

    if (PRIMARY_FLOOR) {
      this.addDebugObject(
        this.add.text(24, PRIMARY_FLOOR.topY + 12, "바닥 충돌면", {
          fontSize: "12px",
          color: "#d1d5db",
        }),
      );
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
      this.addDebugObject(
        this.add.text(
          instantKillHazard.x,
          instantKillHazard.y - 24,
          "즉사 함정",
          {
            fontSize: "12px",
            color: "#f5d0fe",
          },
        ),
      );
    }

    for (const wall of PIT_WALLS) {
      this.addDebugObject(
        this.add.text(wall.x - 48, wall.topY + 24, "pit wall", {
          fontSize: "12px",
          color: "#fed7aa",
        }),
      );
    }

    if (PRIMARY_FALL_ZONE) {
      this.addDebugObject(
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
        ),
      );
    }

    this.addDebugObject(
      this.add.text(
        24,
        112,
        "디버그: 초록=바닥, 파랑=원웨이, 주황=벽, 분홍=hazard, 노랑=spawn",
        {
          fontSize: "12px",
          color: "#a5b4fc",
        },
      ).setDepth(10),
    );
  }

  private connect() {
    this.socket = new WebSocket(WS_URL);

    this.socket.addEventListener("open", () => {
      this.connectionText.setText(
        `Connected as ${this.playerName} [${this._playerId.slice(0, 8)}]`,
      );
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
      this.clearRenderedItemPickups();
      this.clearDeathEchoes();
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
    this.renderItemPickups(message.payload.itemPickups);
    this.captureLocalPlayer(message.payload.players);
    this.maybeFinalizeCamera();
    this.applyKillFeed(message.payload.killFeed, message.payload.players);
    this.updateInfoText(message.payload.players, message.payload.matchState, null, null);
  }

  private applyWorldSnapshot(message: WorldSnapshotMessage) {
    this.latestTick = message.payload.serverTick;
    this.renderPlayers(message.payload.players);
    this.renderWeaponPickups(message.payload.weaponPickups);
    this.renderItemPickups(message.payload.itemPickups);
    this.captureLocalPlayer(message.payload.players);
    this.maybeFinalizeCamera();
    this.applyKillFeed(message.payload.killFeed, message.payload.players);
    this.updateInfoText(
      message.payload.players,
      message.payload.matchState,
      message.payload.timeRemainingMs,
      message.payload.countdownMs ?? null,
    );
  }

  private applyKillFeed(entries: KillFeedEntry[], players: PlayerSnapshot[]) {
    const now = this.time.now;
    for (const entry of entries) {
      if (this.renderedKillFeed.has(entry.id)) {
        continue;
      }
      if (this.dismissedKillFeedIds.has(entry.id)) {
        continue;
      }
      const text = this.add
        .text(0, 0, formatKillFeedEntry(entry, players), {
          fontSize: "13px",
          color: killFeedColorForCause(entry.cause.kind),
          backgroundColor: "#0b1220cc",
          padding: { left: 8, right: 8, top: 4, bottom: 4 },
        })
        .setDepth(12)
        .setScrollFactor(0)
        .setAlpha(0);
      this.renderedKillFeed.set(entry.id, {
        text,
        receivedAt: now,
        justEntered: true,
        slideInTween: null,
      });
    }
    this.layoutKillFeed();
  }

  private pruneKillFeed(now: number) {
    let removed = false;
    for (const [id, rendered] of this.renderedKillFeed) {
      if (now - rendered.receivedAt >= KILL_FEED_TTL_MS) {
        this.startKillFeedExitAnimation(rendered);
        this.renderedKillFeed.delete(id);
        this.dismissedKillFeedIds.set(id, now);
        removed = true;
      }
    }
    for (const [id, dismissedAt] of this.dismissedKillFeedIds) {
      if (now - dismissedAt >= KILL_FEED_DISMISSED_RETENTION_MS) {
        this.dismissedKillFeedIds.delete(id);
      }
    }
    if (removed) {
      this.layoutKillFeed();
    }
  }

  private startKillFeedExitAnimation(rendered: {
    text: Phaser.GameObjects.Text;
    slideInTween: Phaser.Tweens.Tween | null;
  }) {
    rendered.slideInTween?.stop();
    rendered.slideInTween = null;
    const { text } = rendered;
    this.tweens.add({
      targets: text,
      y: text.y - KILL_FEED_EXIT_RISE,
      alpha: 0,
      duration: KILL_FEED_EXIT_MS,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private configureCameraForMap(followTarget: Phaser.GameObjects.Container) {
    const { visualBounds, cameraPolicy } = MAP_DEFINITION;
    this.cameras.main.setBounds(
      visualBounds.left,
      visualBounds.top,
      visualBounds.right - visualBounds.left,
      visualBounds.bottom - visualBounds.top,
    );
    if (cameraPolicy === "follow") {
      this.cameras.main.startFollow(
        followTarget,
        false,
        CAMERA_FOLLOW_LERP_X,
        CAMERA_FOLLOW_LERP_Y,
      );
    }
  }

  private maybeFinalizeCamera() {
    if (this.cameraConfigured || !this.localPlayerId) {
      return;
    }
    const rendered = this.renderedPlayers.get(this.localPlayerId);
    if (!rendered) {
      return;
    }
    this.configureCameraForMap(rendered.root);
    this.cameraConfigured = true;
  }

  private layoutKillFeed() {
    const ordered = [...this.renderedKillFeed.values()].sort(
      (a, b) => a.receivedAt - b.receivedAt,
    );
    ordered.forEach((rendered, index) => {
      const finalX = VIEWPORT_WIDTH - KILL_FEED_MARGIN_X - rendered.text.width;
      const finalY = KILL_FEED_MARGIN_Y + index * KILL_FEED_LINE_HEIGHT;

      if (rendered.justEntered) {
        rendered.justEntered = false;
        rendered.text.setPosition(
          finalX - KILL_FEED_SLIDE_IN_DISTANCE,
          finalY,
        );
        rendered.slideInTween = this.tweens.add({
          targets: rendered.text,
          x: finalX,
          alpha: 1,
          duration: KILL_FEED_SLIDE_IN_MS,
          ease: "Sine.easeOut",
          onComplete: () => {
            rendered.slideInTween = null;
          },
        });
        return;
      }

      rendered.text.y = finalY;
      if (rendered.slideInTween && rendered.slideInTween.isPlaying()) {
        rendered.slideInTween.updateTo("x", finalX, true);
      } else {
        rendered.text.x = finalX;
      }
    });
  }

  private updateInfoText(
    players: PlayerSnapshot[],
    matchState: string,
    timeRemainingMs: number | null,
    countdownMs: number | null,
  ) {
    const localPlayer = players.find(
      (player) => player.id === this.localPlayerId,
    );
    this.infoText.setText([
      `room: ${ROOM_ID}`,
      `players: ${players.length}`,
      `match: ${matchState}`,
      `hp: ${localPlayer?.hp ?? 0}`,
      `kills: ${localPlayer?.kills ?? 0}  deaths: ${localPlayer?.deaths ?? 0}`,
      `weapon: ${localPlayer ? (weaponDefinitionById[localPlayer.equippedWeaponId]?.name ?? localPlayer.equippedWeaponId) : "unknown"}`,
      `ammo: ${localPlayer?.equippedWeaponResource ?? "∞"}`,
      `lives: ${localPlayer?.lives ?? 0}`,
      `time: ${timeRemainingMs === null ? "∞" : `${Math.ceil(timeRemainingMs / 1000)}s`}`,
    ]);

    this.updateMatchOverlay(players, matchState, countdownMs);
  }

  private updateMatchOverlay(
    players: PlayerSnapshot[],
    matchState: string,
    countdownMs: number | null,
  ) {
    if (matchState === "waiting") {
      this.matchOverlayBg.setVisible(true);
      this.matchOverlayText.setVisible(true);
      if (countdownMs !== null && countdownMs > 0) {
        this.matchOverlayText.setText(
          `게임 시작까지\n${Math.ceil(countdownMs / 1000)}초`,
        );
      } else {
        this.matchOverlayText.setText(
          `대기 중...\n${players.length}명 / ${MATCH_MIN_PLAYERS_DISPLAY}명 이상 필요`,
        );
      }
    } else if (matchState === "finished") {
      this.matchOverlayBg.setVisible(true);
      this.matchOverlayText.setVisible(true);
      const sorted = [...players].sort(
        (a, b) => b.kills - a.kills || a.deaths - b.deaths,
      );
      const lines = ["게임 종료!\n"];
      sorted.forEach((p, i) => {
        const marker = p.id === this.localPlayerId ? " ◀" : "";
        lines.push(`#${i + 1}  ${p.name}  ${p.kills}킬 ${p.deaths}데스${marker}`);
      });
      lines.push("\n매치가 종료되었습니다.\n로비로 돌아가려면 뒤로 가기를 눌러주세요.");
      this.matchOverlayText.setText(lines.join("\n"));
    } else {
      this.matchOverlayBg.setVisible(false);
      this.matchOverlayText.setVisible(false);
    }
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
        const root = this.add.container(player.position.x, player.position.y);
        const shadow = this.add.ellipse(0, 12, 22, 8, 0x020617, 0.22);
        const sprite = this.add.image(
          0,
          -2,
          hamsterTextureForSnapshot(player, this.time.now),
        );
        const collider = this.add.rectangle(
          0,
          0,
          PLAYER_SIZE,
          PLAYER_SIZE,
          0x000000,
          0,
        );
        collider.setVisible(this.debugEnabled);
        collider.setStrokeStyle(2, 0xffedd5, 0.95);
        root.add([shadow, sprite, collider]);
        rendered = {
          root,
          shadow,
          sprite,
          collider,
          label: this.add.text(player.position.x, player.position.y - 28, player.name, {
            fontSize: "12px",
            color: "#f9fafb",
          }),
          targetX: player.position.x,
          targetY: player.position.y,
          isLocal: false,
          snapshot: player,
        };
        this.renderedPlayers.set(player.id, rendered);
      }

      const previousSnapshot = rendered.snapshot;
      const isLocalPlayer = player.id === this.localPlayerId;
      rendered.isLocal = isLocalPlayer;
      rendered.collider.setStrokeStyle(
        2,
        isLocalPlayer ? 0xeafff7 : 0xffedd5,
        0.95,
      );
      rendered.shadow.setFillStyle(isLocalPlayer ? 0x14532d : 0x020617, 0.24);
      rendered.targetX = player.position.x;
      rendered.targetY = player.position.y;
      if (
        previousSnapshot.state !== "respawning" &&
        player.state === "respawning"
      ) {
        this.spawnDeathEcho(rendered, previousSnapshot, player);
      }

      rendered.snapshot = player;
      const isRespawning = player.state === "respawning";
      rendered.root.setVisible(!isRespawning);
      rendered.label.setVisible(!isRespawning);
      rendered.collider.setVisible(this.debugEnabled && !isRespawning);
      if (
        previousSnapshot.state === "respawning" ||
        shouldSnapToTarget(
          rendered.root.x,
          rendered.root.y,
          rendered.targetX,
          rendered.targetY,
          PLAYER_SNAP_DISTANCE,
        )
      ) {
        rendered.root.setPosition(rendered.targetX, rendered.targetY);
      }
      rendered.label.setText(player.name);
      if (!isRespawning) {
        rendered.label.setPosition(
          rendered.root.x - rendered.label.width / 2,
          rendered.root.y - 32,
        );
      }
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

    rendered.root.destroy();
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

  private clearRenderedItemPickups() {
    for (const [pickupId, rendered] of this.renderedItemPickups) {
      rendered.body.destroy();
      rendered.label.destroy();
      this.renderedItemPickups.delete(pickupId);
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
          targetX: pickup.position.x,
          targetY: pickup.position.y,
        };
        this.renderedWeaponPickups.set(pickup.id, rendered);
      }

      rendered.targetX = pickup.position.x;
      rendered.targetY = pickup.position.y;
      if (
        shouldSnapToTarget(
          rendered.body.x,
          rendered.body.y,
          rendered.targetX,
          rendered.targetY,
          PICKUP_SNAP_DISTANCE,
        )
      ) {
        rendered.body.setPosition(rendered.targetX, rendered.targetY);
      }
      rendered.body.setFillStyle(
        pickup.source === "spawn" ? 0x38bdf8 : 0xf97316,
        0.95,
      );
      rendered.label.setText(`${weaponName} (${pickup.resourceRemaining})`);
      rendered.label.setPosition(
        rendered.body.x - rendered.label.width / 2,
        rendered.body.y - 20,
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

  private renderItemPickups(itemPickups: WorldItemPickup[]) {
    const nextIds = new Set(itemPickups.map((pickup) => pickup.id));

    for (const pickup of itemPickups) {
      let rendered = this.renderedItemPickups.get(pickup.id);
      const itemName = itemDefinitionById[pickup.itemId]?.name ?? pickup.itemId;

      if (!rendered) {
        const fillColor =
          pickup.spawnStyle === "airdrop" ? 0xf59e0b : 0x4ade80;
        const strokeColor =
          pickup.spawnStyle === "airdrop" ? 0x7c2d12 : 0x14532d;
        rendered = {
          body: this.add.rectangle(
            pickup.position.x,
            pickup.position.y,
            14,
            14,
            fillColor,
            0.95,
          ),
          label: this.add.text(
            pickup.position.x,
            pickup.position.y - 18,
            itemName,
            {
              fontSize: "11px",
              color: "#dcfce7",
            },
          ),
          targetX: pickup.position.x,
          targetY: pickup.position.y,
        };
        rendered.body.setStrokeStyle(2, strokeColor, 0.95);
        rendered.body.setAngle(45);
        this.renderedItemPickups.set(pickup.id, rendered);
      }

      rendered.body.setFillStyle(
        pickup.spawnStyle === "airdrop" ? 0xf59e0b : 0x4ade80,
        0.95,
      );
      rendered.body.setStrokeStyle(
        2,
        pickup.spawnStyle === "airdrop" ? 0x7c2d12 : 0x14532d,
        0.95,
      );
      rendered.targetX = pickup.position.x;
      rendered.targetY = pickup.position.y;
      if (
        shouldSnapToTarget(
          rendered.body.x,
          rendered.body.y,
          rendered.targetX,
          rendered.targetY,
          PICKUP_SNAP_DISTANCE,
        )
      ) {
        rendered.body.setPosition(rendered.targetX, rendered.targetY);
      }
      rendered.label.setText(itemName);
      rendered.label.setPosition(
        rendered.body.x - rendered.label.width / 2,
        rendered.body.y - 20,
      );
    }

    for (const [pickupId, rendered] of this.renderedItemPickups) {
      if (!nextIds.has(pickupId)) {
        rendered.body.destroy();
        rendered.label.destroy();
        this.renderedItemPickups.delete(pickupId);
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
    const originX = localPlayer?.root.x ?? GAME_WIDTH / 2;
    const originY = localPlayer?.root.y ?? GAME_HEIGHT / 2;
    const aimX = pointer.worldX - originX;
    const aimY = pointer.worldY - originY;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    const aim = { x: aimX / aimLength, y: aimY / aimLength };

    const moveX =
      Number(this.cursors.right.isDown || this.keys.d.isDown) -
      Number(this.cursors.left.isDown || this.keys.a.isDown);
    const moveY = Number(this.cursors.down.isDown || this.keys.s.isDown);
    const attackHeld = pointer.isDown;
    const attackPressed =
      this.queuedClickAttack || (attackHeld && !this.attackWasDown);
    if (attackPressed) {
      this.showAttackFlash(originX, originY, aim.x, aim.y);
    }
    this.attackWasDown = attackHeld;
    const pickupWeaponPressed =
      this.queuedPickupWeapon || Phaser.Input.Keyboard.JustDown(this.keys.e);
    const dropWeaponPressed =
      this.queuedDropWeapon || Phaser.Input.Keyboard.JustDown(this.keys.q);

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
        attack: attackHeld,
        attackPressed,
        pickupWeaponPressed,
        dropWeapon: dropWeaponPressed,
        dropWeaponPressed,
      },
    } satisfies PlayerInputMessage);
    this.queuedClickAttack = false;
    this.queuedPickupWeapon = false;
    this.queuedDropWeapon = false;
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
    this.pruneKillFeed(this.time.now);
    this.updateDeathEchoes(this.time.now);

    if (this.attackFlashUntil !== 0 && this.time.now > this.attackFlashUntil) {
      this.attackFlash.clear();
      this.attackFlashUntil = 0;
    }

    for (const [, rendered] of this.renderedPlayers) {
      const lerpFactor = rendered.isLocal ? LOCAL_PLAYER_LERP : REMOTE_PLAYER_LERP;
      rendered.root.x = Phaser.Math.Linear(rendered.root.x, rendered.targetX, lerpFactor);
      rendered.root.y = Phaser.Math.Linear(rendered.root.y, rendered.targetY, lerpFactor);
      rendered.sprite.setTexture(
        hamsterTextureForSnapshot(rendered.snapshot, this.time.now),
      );
      rendered.sprite.setFlipX(rendered.snapshot.direction === "left");
      if (rendered.snapshot.state === "respawning") {
        rendered.root.setAlpha(1);
        continue;
      }
      rendered.label.setPosition(
        rendered.root.x - rendered.label.width / 2,
        rendered.root.y - 32,
      );
      rendered.root.setAlpha(1);
    }

    for (const [, rendered] of this.renderedWeaponPickups) {
      rendered.body.x = Phaser.Math.Linear(rendered.body.x, rendered.targetX, PICKUP_LERP);
      rendered.body.y = Phaser.Math.Linear(rendered.body.y, rendered.targetY, PICKUP_LERP);
      rendered.label.setPosition(
        rendered.body.x - rendered.label.width / 2,
        rendered.body.y - 20,
      );
    }

    for (const [, rendered] of this.renderedItemPickups) {
      rendered.body.x = Phaser.Math.Linear(rendered.body.x, rendered.targetX, PICKUP_LERP);
      rendered.body.y = Phaser.Math.Linear(rendered.body.y, rendered.targetY, PICKUP_LERP);
      rendered.label.setPosition(
        rendered.body.x - rendered.label.width / 2,
        rendered.body.y - 20,
      );
    }

    this.statusText.setText(
      `Battle Hamsters  |  server tick ${this.latestTick}  |  room ${ROOM_ID}${this.debugEnabled ? "  |  DEBUG" : ""}`,
    );
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
  backgroundColor: "#111827",
  scene: MainScene,
});
