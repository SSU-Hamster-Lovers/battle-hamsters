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
import {
  ensureWeaponHudTextures,
  resolveWeaponImpactStyle,
  ensureWeaponPickupTextures,
  getWeaponHudTextureKey,
  resolveWeaponEquipPresentation,
  resolveWeaponFireStyle,
  resolveWeaponPickupPresentation,
  weaponPickupAccentColor,
} from "./weapon-presentation";
import type {
  CollisionPrimitive,
  DamageAppliedEvent,
  HazardZone,
  JoinRoomMessage,
  KillFeedEntry,
  PingMessage,
  PlayerInputMessage,
  PlayerSnapshot,
  SpawnPoint,
  RoomSnapshotMessage,
  ServerToClientMessage,
  WorldItemPickup,
  WorldWeaponPickup,
  WorldSnapshotMessage,
  Vector2,
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
  const searchValue = new URLSearchParams(window.location.search).get(key);
  if (searchValue !== null) {
    return searchValue;
  }

  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const normalizedHash = rawHash.startsWith("?") ? rawHash.slice(1) : rawHash;
  return new URLSearchParams(normalizedHash).get(key);
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

// URL query/hash 에 room 값이 있으면 그 값, 없으면 자유맵
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
const KILL_FEED_CARD_H = 22;
const KILL_FEED_CARD_GAP = 3;
const KILL_FEED_MARGIN_X = 24;
const KILL_FEED_MARGIN_Y = 24;
const KILL_FEED_SLIDE_IN_DISTANCE = 96;
const KILL_FEED_EXIT_MS = 400;
const KILL_FEED_EXIT_RISE = 12;

// HUD 하단 바
const HUD_BAR_HEIGHT = 88;
const HUD_BAR_Y = VIEWPORT_HEIGHT - HUD_BAR_HEIGHT; // 512
const HUD_CARD_W = 184;
const HUD_CARD_H = 80;
const HUD_CARD_PAD_Y = 4;
const HUD_LEFT_CARD_X = 8;
const HUD_RIGHT_CARD_X = VIEWPORT_WIDTH - 8 - HUD_CARD_W; // 514
const HUD_FACE_SIZE = 24;
const HUD_MAX_HP = 100;
const HUD_TIMER_PANEL_W = 156;
const HUD_TIMER_PANEL_H = 50;
const HUD_TIMER_FREE_PLAY_THRESHOLD_MS = 99 * 60 * 60 * 1000;
const HUD_RECENT_TARGET_TTL_MS = 6_000;
const KILL_FEED_SLIDE_IN_MS = 200;
const DAMAGE_EVENT_DISMISSED_RETENTION_MS = 1_200;
const NETWORK_PING_INTERVAL_MS = 2_000;
const HUD_MAX_LIFE_PIPS = 6;

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
  weaponOverlay: Phaser.GameObjects.Image;
  collider: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  isLocal: boolean;
  snapshot: PlayerSnapshot;
  lastImpactDirection: Vector2 | null;
  lastImpactAt: number;
};

type RenderedWeaponPickup = {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Ellipse | Phaser.GameObjects.Image;
  accent: Phaser.GameObjects.Rectangle;
  codeText: Phaser.GameObjects.Text;
  detailText: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  spawnedAt: number;
  despawnAt: number | null;
};

type RenderedItemPickup = {
  body: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  spawnedAt: number;
  despawnAt: number | null;
};

type VisibilityControlledObject =
  Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible;

type DeathEcho = {
  sprite: Phaser.GameObjects.Image;
  velocityX: number;
  velocityY: number;
  angularVelocity: number;
  gravity: number;
  fadeAt: number;
  destroyAt: number;
  baseAlpha: number;
};

type HitParticle = {
  node: Phaser.GameObjects.Shape;
  velocityX: number;
  velocityY: number;
  angularVelocity: number;
  gravity: number;
  drag: number;
  scaleXVelocity: number;
  scaleYVelocity: number;
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

function vectorLengthSquared(vector: Vector2): number {
  return vector.x * vector.x + vector.y * vector.y;
}

function normalizeVector(vector: Vector2, fallback: Vector2): Vector2 {
  const lengthSq = vectorLengthSquared(vector);
  if (lengthSq <= 0.0001) {
    return fallback;
  }

  const length = Math.sqrt(lengthSq);
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function addUpwardBias(direction: Vector2): Vector2 {
  return normalizeVector(
    {
      x: direction.x,
      y: Math.min(direction.y, 0) - 0.38,
    },
    { x: 0, y: -1 },
  );
}

function fallbackImpactDirection(
  previousSnapshot: PlayerSnapshot,
  nextSnapshot: PlayerSnapshot,
): Vector2 {
  const deltaVelocity = {
    x: nextSnapshot.velocity.x - previousSnapshot.velocity.x,
    y: nextSnapshot.velocity.y - previousSnapshot.velocity.y,
  };
  if (vectorLengthSquared(deltaVelocity) > 0.3) {
    return addUpwardBias(normalizeVector(deltaVelocity, { x: 1, y: 0 }));
  }

  if (vectorLengthSquared(nextSnapshot.velocity) > 0.3) {
    return addUpwardBias(normalizeVector(nextSnapshot.velocity, { x: 1, y: 0 }));
  }

  return previousSnapshot.direction === "left"
    ? { x: -0.74, y: -0.46 }
    : { x: 0.74, y: -0.46 };
}

function getOrCreatePlayerName(): string {
  // URL query/hash 우선 (Portal 에서 전달)
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

function resolveWeaponAbbrev(weaponId: string): string {
  const name = weaponDefinitionById[weaponId]?.name ?? weaponId;
  return name
    .split(/[\s_-]+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
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

function notificationColor(kind: "join" | "left"): string {
  return kind === "join" ? "#86efac" : "#fca5a5";
}

class MainScene extends Phaser.Scene {
  private socket: WebSocket | null = null;
  private networkStatusText!: Phaser.GameObjects.Text;
  private attackFlash!: Phaser.GameObjects.Graphics;
  private attackFlashUntil = 0;
  private matchOverlayBg!: Phaser.GameObjects.Rectangle;
  private matchOverlayText!: Phaser.GameObjects.Text;
  private cameraConfigured = false;
  private debugLayer: VisibilityControlledObject[] = [];
  private deathEchoes: DeathEcho[] = [];
  private hitParticles: HitParticle[] = [];
  private renderedPlayers = new Map<string, RenderedPlayer>();
  private renderedWeaponPickups = new Map<string, RenderedWeaponPickup>();
  private renderedItemPickups = new Map<string, RenderedItemPickup>();
  private renderedKillFeed = new Map<
    string,
    {
      container: Phaser.GameObjects.Container;
      cardW: number;
      receivedAt: number;
      justEntered: boolean;
      slideInTween: Phaser.Tweens.Tween | null;
    }
  >();
  // HUD
  private hudBgGraphics!: Phaser.GameObjects.Graphics;
  private hudLeftGraphics!: Phaser.GameObjects.Graphics;
  private hudRightGraphics!: Phaser.GameObjects.Graphics;
  private hudCenterGraphics!: Phaser.GameObjects.Graphics;
  private hudLeftNameText!: Phaser.GameObjects.Text;
  private hudLeftStatText!: Phaser.GameObjects.Text;
  private hudLeftLifeText!: Phaser.GameObjects.Text;
  private hudLeftKillText!: Phaser.GameObjects.Text;
  private hudRightNameText!: Phaser.GameObjects.Text;
  private hudRightStatText!: Phaser.GameObjects.Text;
  private hudRightLifeText!: Phaser.GameObjects.Text;
  private hudRightKillText!: Phaser.GameObjects.Text;
  private hudLeftWeaponIcon!: Phaser.GameObjects.Image;
  private hudRightWeaponIcon!: Phaser.GameObjects.Image;
  private hudTimerText!: Phaser.GameObjects.Text;
  private hudTimerSubText!: Phaser.GameObjects.Text;
  private dismissedKillFeedIds = new Map<string, number>();
  private dismissedDamageEventIds = new Map<string, number>();
  private playerName = getOrCreatePlayerName();
  // 미래 계정 연동용 — 현재는 로컬 저장만 하고 서버에 아직 전달하지 않음
  private readonly debugAccess = resolveOpsAccess();
  private debugEnabled = resolveInitialDebugVisible(this.debugAccess);
  private localPlayerId: string | null = null;
  private sequence = 0;
  private latestPingMs: number | null = null;
  private networkState: "connecting" | "joining" | "online" | "offline" | "error" = "connecting";
  private pendingPingNonce: string | null = null;
  private pendingPingSentAt: number | null = null;
  private knownPlayerNames = new Map<string, string>();
  private recentAttackTargetId: string | null = null;
  private recentAttackAt = 0;
  private queuedClickAttack = false;
  private queuedPickupWeapon = false;
  private queuedDropWeapon = false;
  private attackWasDown = false;
  private latestAim = { x: 1, y: 0 };
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
    if (!cause || cause.kind === "instant_kill_hazard") {
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

    if (cause.kind === "fall_zone") {
      const spinDirection = previousSnapshot.direction === "left" ? -1 : 1;
      this.deathEchoes.push({
        sprite,
        velocityX: previousSnapshot.velocity.x * 0.06,
        velocityY: Math.max(previousSnapshot.velocity.y * 0.18, 1.6) + 2.8,
        angularVelocity: spinDirection * 0.16,
        gravity: 0.56,
        fadeAt: this.time.now + 260,
        destroyAt: this.time.now + 860,
        baseAlpha: 0.78,
      });
      return;
    }

    const recentImpactDirection =
      rendered.lastImpactDirection &&
      this.time.now - rendered.lastImpactAt <= 700
        ? rendered.lastImpactDirection
        : null;
    const recoilOppositeDirection = recentImpactDirection
      ? {
          x: -recentImpactDirection.x,
          y: -recentImpactDirection.y,
        }
      : normalizeVector(
          {
            x: -previousSnapshot.velocity.x,
            y: -previousSnapshot.velocity.y,
          },
          previousSnapshot.direction === "left"
            ? { x: 1, y: -0.2 }
            : { x: -1, y: -0.2 },
        );
    const launchDirection = addUpwardBias(recoilOppositeDirection);

    this.deathEchoes.push({
      sprite,
      velocityX: previousSnapshot.velocity.x * 0.05 + launchDirection.x * 1.2,
      velocityY:
        Math.min(previousSnapshot.velocity.y * 0.06, 0) + launchDirection.y * 1.45 - 1.35,
      angularVelocity: launchDirection.x * 0.016,
      gravity: 0.22,
      fadeAt: this.time.now + 620,
      destroyAt: this.time.now + 1460,
      baseAlpha: 0.78,
    });
  }

  private updateDeathEchoes(now: number) {
    for (let index = this.deathEchoes.length - 1; index >= 0; index -= 1) {
      const echo = this.deathEchoes[index];
      echo.sprite.x += echo.velocityX;
      echo.sprite.y += echo.velocityY;
      echo.velocityY += echo.gravity;
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

  private clearHitParticles() {
    for (const particle of this.hitParticles) {
      particle.node.destroy();
    }
    this.hitParticles = [];
  }

  private updateHitParticles(now: number) {
    for (let index = this.hitParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.hitParticles[index];
      particle.node.x += particle.velocityX;
      particle.node.y += particle.velocityY;
      particle.velocityX *= particle.drag;
      particle.velocityY = particle.velocityY * particle.drag + particle.gravity;
      particle.node.rotation += particle.angularVelocity;
      particle.node.setScale(
        Math.max(0.18, particle.node.scaleX + particle.scaleXVelocity),
        Math.max(0.18, particle.node.scaleY + particle.scaleYVelocity),
      );

      if (now >= particle.fadeAt) {
        const fadeWindow = particle.destroyAt - particle.fadeAt;
        const remaining = Math.max(0, particle.destroyAt - now);
        const ratio = fadeWindow <= 0 ? 0 : remaining / fadeWindow;
        particle.node.setAlpha(particle.baseAlpha * ratio);
      }

      if (now >= particle.destroyAt) {
        particle.node.destroy();
        this.hitParticles.splice(index, 1);
      }
    }
  }

  create() {
    getOrCreatePlayerId();
    this.cameras.main.setBackgroundColor("#111827");
    ensureHamsterPlaceholderTextures(this);
    ensureWeaponPickupTextures(this);
    ensureWeaponHudTextures(this);
    this.drawStage();
    this.setDebugVisible(this.debugEnabled);

    this.networkStatusText = this.add
      .text(16, 12, "WS connecting", {
        fontSize: "11px",
        color: "#93c5fd",
        backgroundColor: "#00000066",
        padding: { left: 5, right: 5, top: 2, bottom: 2 },
      })
      .setDepth(10)
      .setScrollFactor(0);
    this.refreshNetworkStatusText();

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

    // 키 가이드 — HUD 위쪽에 배치
    this.add
      .text(
        VIEWPORT_WIDTH / 2,
        HUD_BAR_Y - 18,
        "WASD/방향키: 이동  |  Space: 점프  |  E: 줍기  |  Q: 버리기  |  마우스: 조준/공격",
        { fontSize: "11px", color: "#6b7280" },
      )
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(10);

    this.createHud();

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
    this.time.addEvent({
      delay: NETWORK_PING_INTERVAL_MS,
      loop: true,
      callback: () => this.sendPing(),
    });

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearDeathEchoes();
      this.clearHitParticles();
      this.socket?.close();
    });
    this.events.on(Phaser.Scenes.Events.DESTROY, () => {
      this.clearDeathEchoes();
      this.clearHitParticles();
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
    this.networkState = "connecting";
    this.refreshNetworkStatusText();

    this.socket.addEventListener("open", () => {
      this.networkState = "joining";
      this.refreshNetworkStatusText();
      this.send({
        type: "join_room",
        timestamp: Date.now(),
        payload: {
          roomId: ROOM_ID,
          playerName: this.playerName,
        },
      } satisfies JoinRoomMessage);
      this.sendPing();
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerToClientMessage;
      this.handleServerMessage(message);
    });

    this.socket.addEventListener("close", () => {
      this.networkState = "offline";
      this.refreshNetworkStatusText();
      this.localPlayerId = null;
      this.clearRenderedPlayers();
      this.clearRenderedWeaponPickups();
      this.clearRenderedItemPickups();
      this.clearDeathEchoes();
      this.clearHitParticles();
      this.dismissedDamageEventIds.clear();
      this.time.delayedCall(2000, () => {
        if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
          this.connect();
        }
      });
    });

    this.socket.addEventListener("error", () => {
      this.networkState = "error";
      this.refreshNetworkStatusText();
    });
  }

  private handleServerMessage(message: ServerToClientMessage) {
    switch (message.type) {
      case "welcome": {
        this.networkState = "online";
        this.refreshNetworkStatusText();
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
        this.knownPlayerNames.set(message.payload.playerId, message.payload.name);
        this.pushSystemNotification(
          `입장: ${message.payload.name}`,
          "join",
          `join:${message.payload.playerId}:${message.timestamp}`,
        );
        return;
      }
      case "player_left": {
        const leavingName =
          this.knownPlayerNames.get(message.payload.playerId) ??
          message.payload.playerId.slice(0, 8);
        this.pushSystemNotification(
          `퇴장: ${leavingName}`,
          "left",
          `left:${message.payload.playerId}:${message.timestamp}`,
        );
        this.removeRenderedPlayer(message.payload.playerId);
        this.knownPlayerNames.delete(message.payload.playerId);
        return;
      }
      case "pong": {
        if (
          this.pendingPingNonce !== null &&
          this.pendingPingSentAt !== null &&
          message.payload.nonce === this.pendingPingNonce
        ) {
          this.latestPingMs = Math.max(0, Date.now() - this.pendingPingSentAt);
          this.pendingPingNonce = null;
          this.pendingPingSentAt = null;
          this.networkState = "online";
          this.refreshNetworkStatusText();
        }
        return;
      }
      case "error": {
        this.networkState = "error";
        this.refreshNetworkStatusText(message.payload.code);
      }
    }
  }

  private applyRoomSnapshot(message: RoomSnapshotMessage) {
    if (message.payload.selfPlayerId) {
      this.localPlayerId = message.payload.selfPlayerId;
    }
    this.cachePlayerNames(message.payload.players);
    this.captureRecentAttackTarget(message.payload.damageEvents);
    const damageEventMap = this.buildDamageEventMap(message.payload.damageEvents);
    this.renderPlayers(message.payload.players, damageEventMap);
    this.renderWeaponPickups(message.payload.weaponPickups);
    this.renderItemPickups(message.payload.itemPickups);
    this.captureLocalPlayer(message.payload.players);
    this.maybeFinalizeCamera();
    this.applyKillFeed(message.payload.killFeed, message.payload.players);
    this.updateInfoText(message.payload.players, message.payload.matchState, null, null);
  }

  private applyWorldSnapshot(message: WorldSnapshotMessage) {
    this.cachePlayerNames(message.payload.players);
    this.captureRecentAttackTarget(message.payload.damageEvents);
    const damageEventMap = this.buildDamageEventMap(message.payload.damageEvents);
    this.renderPlayers(message.payload.players, damageEventMap);
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

  private cachePlayerNames(players: PlayerSnapshot[]) {
    for (const player of players) {
      this.knownPlayerNames.set(player.id, player.name);
    }
  }

  private captureRecentAttackTarget(events: DamageAppliedEvent[]) {
    if (!this.localPlayerId) {
      return;
    }
    for (const event of events) {
      if (event.attackerId !== this.localPlayerId || event.victimId === this.localPlayerId) {
        continue;
      }
      this.recentAttackTargetId = event.victimId;
      this.recentAttackAt = this.time.now;
    }
  }

  private buildDamageEventMap(
    events: DamageAppliedEvent[],
  ): Map<string, DamageAppliedEvent[]> {
    const byVictim = new Map<string, DamageAppliedEvent[]>();
    for (const event of events) {
      const existing = byVictim.get(event.victimId);
      if (existing) {
        existing.push(event);
      } else {
        byVictim.set(event.victimId, [event]);
      }
    }
    return byVictim;
  }

  private applyKillFeed(entries: KillFeedEntry[], players: PlayerSnapshot[]) {
    const now = this.time.now;
    for (const entry of entries) {
      if (this.renderedKillFeed.has(entry.id)) continue;
      if (this.dismissedKillFeedIds.has(entry.id)) continue;

      const accentColor = killFeedColorForCause(entry.cause.kind);
      const pad = { x: 8, y: 4 };
      const iconSize = 16;
      const iconGap = 4;
      const depth = 12;

      // 카드 내부 요소 생성
      const container = this.add
        .container(0, 0)
        .setDepth(depth)
        .setScrollFactor(0)
        .setAlpha(0);

      if (entry.cause.kind === "weapon") {
        // 공격자 텍스트
        const killerName = resolvePlayerName(entry.cause.killerId, players);
        const victimName = resolvePlayerName(entry.victimId, players);
        const killerText = this.add.text(0, 0, killerName, {
          fontSize: "13px",
          color: accentColor,
        });
        const iconX = killerText.width + iconGap + iconSize / 2;
        const weaponIconKey = getWeaponHudTextureKey(entry.cause.weaponId);
        const hasTexture = this.textures.exists(weaponIconKey);
        let iconW = iconSize;
        let iconObj: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
        if (hasTexture) {
          const img = this.add
            .image(iconX, 0, weaponIconKey)
            .setDisplaySize(iconSize, iconSize)
            .setOrigin(0.5, 0);
          iconObj = img;
        } else {
          const abbrev = resolveWeaponAbbrev(entry.cause.weaponId);
          const abbrText = this.add.text(iconX, 0, `[${abbrev}]`, {
            fontSize: "13px",
            color: "#888888",
          });
          iconW = abbrText.width;
          iconObj = abbrText;
        }
        const victimX = iconX + iconW / 2 + iconGap;
        const victimText = this.add.text(victimX, 0, victimName, {
          fontSize: "13px",
          color: accentColor,
        });
        const totalW = victimX + victimText.width + pad.x * 2;
        const totalH = KILL_FEED_CARD_H;

        const bg = this.add.rectangle(0, 0, totalW, totalH, 0x0b1220, 0.85);
        bg.setOrigin(0, 0);
        bg.setStrokeStyle(1, 0x334155, 0.6);

        // 텍스트/아이콘 수직 중앙 정렬
        const textY = pad.y;
        killerText.setPosition(pad.x, textY);
        iconObj.setPosition(pad.x + killerText.width + iconGap + iconW / 2, 0);
        victimText.setPosition(victimX + pad.x, textY);

        container.add([bg, killerText, iconObj, victimText]);
        this.renderedKillFeed.set(entry.id, {
          container,
          cardW: totalW,
          receivedAt: now,
          justEntered: true,
          slideInTween: null,
        });
      } else {
        // 낙사/함정/자살 — 단순 텍스트 카드
        const label = formatKillFeedEntry(entry, players);
        const labelText = this.add.text(pad.x, pad.y, label, {
          fontSize: "13px",
          color: accentColor,
        });
        const totalW = labelText.width + pad.x * 2;
        const totalH = KILL_FEED_CARD_H;
        const bg = this.add.rectangle(0, 0, totalW, totalH, 0x0b1220, 0.85);
        bg.setOrigin(0, 0);
        bg.setStrokeStyle(1, 0x334155, 0.6);
        container.add([bg, labelText]);
        this.renderedKillFeed.set(entry.id, {
          container,
          cardW: totalW,
          receivedAt: now,
          justEntered: true,
          slideInTween: null,
        });
      }
    }
    this.layoutKillFeed();
  }

  private pushSystemNotification(
    label: string,
    kind: "join" | "left",
    id: string,
  ) {
    if (this.renderedKillFeed.has(id) || this.dismissedKillFeedIds.has(id)) {
      return;
    }
    const pad = { x: 8, y: 4 };
    const accentColor = notificationColor(kind);
    const depth = 12;
    const container = this.add.container(0, 0).setDepth(depth).setScrollFactor(0).setAlpha(0);
    const labelText = this.add.text(pad.x + 18, pad.y, label, {
      fontSize: "13px",
      color: accentColor,
    });
    const icon = this.add.circle(pad.x + 8, KILL_FEED_CARD_H / 2, 4, kind === "join" ? 0x22c55e : 0xef4444, 0.95);
    const totalW = labelText.width + pad.x * 2 + 18;
    const bg = this.add.rectangle(0, 0, totalW, KILL_FEED_CARD_H, 0x0b1220, 0.85);
    bg.setOrigin(0, 0);
    bg.setStrokeStyle(1, 0x334155, 0.6);
    container.add([bg, icon, labelText]);
    this.renderedKillFeed.set(id, {
      container,
      cardW: totalW,
      receivedAt: this.time.now,
      justEntered: true,
      slideInTween: null,
    });
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
    container: Phaser.GameObjects.Container;
    slideInTween: Phaser.Tweens.Tween | null;
  }) {
    rendered.slideInTween?.stop();
    rendered.slideInTween = null;
    const { container } = rendered;
    this.tweens.add({
      targets: container,
      y: container.y - KILL_FEED_EXIT_RISE,
      alpha: 0,
      duration: KILL_FEED_EXIT_MS,
      ease: "Sine.easeOut",
      onComplete: () => container.destroy(true),
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
      const finalX = VIEWPORT_WIDTH - KILL_FEED_MARGIN_X - rendered.cardW;
      const finalY =
        KILL_FEED_MARGIN_Y + index * (KILL_FEED_CARD_H + KILL_FEED_CARD_GAP);

      if (rendered.justEntered) {
        rendered.justEntered = false;
        rendered.container.setPosition(
          finalX - KILL_FEED_SLIDE_IN_DISTANCE,
          finalY,
        );
        rendered.slideInTween = this.tweens.add({
          targets: rendered.container,
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

      rendered.container.y = finalY;
      if (rendered.slideInTween && rendered.slideInTween.isPlaying()) {
        rendered.slideInTween.updateTo("x", finalX, true);
      } else {
        rendered.container.x = finalX;
      }
    });
  }

  private updateInfoText(
    players: PlayerSnapshot[],
    matchState: string,
    timeRemainingMs: number | null,
    countdownMs: number | null,
  ) {
    this.updateHud(players, timeRemainingMs);
    this.updateMatchOverlay(players, matchState, countdownMs);
  }

  // ── HUD ──────────────────────────────────────────────────────────────

  private createHud() {
    const depth = 11;

    // 배경 바
    this.hudBgGraphics = this.add
      .graphics()
      .setDepth(depth)
      .setScrollFactor(0);
    this.hudBgGraphics.fillGradientStyle(
      0x140d08,
      0x140d08,
      0x090706,
      0x090706,
      0.95,
    );
    this.hudBgGraphics.fillRect(0, HUD_BAR_Y, VIEWPORT_WIDTH, HUD_BAR_HEIGHT);
    this.hudBgGraphics.lineStyle(1, 0x3d2610, 1);
    this.hudBgGraphics.lineBetween(0, HUD_BAR_Y, VIEWPORT_WIDTH, HUD_BAR_Y);
    this.hudBgGraphics.lineStyle(1, 0x24160d, 0.8);
    this.hudBgGraphics.lineBetween(0, HUD_BAR_Y + 1, VIEWPORT_WIDTH, HUD_BAR_Y + 1);

    // 좌측 카드 Graphics (매 업데이트마다 다시 그림)
    this.hudLeftGraphics = this.add
      .graphics()
      .setDepth(depth + 1)
      .setScrollFactor(0);

    // 우측 카드 Graphics
    this.hudRightGraphics = this.add
      .graphics()
      .setDepth(depth + 1)
      .setScrollFactor(0);

    this.hudCenterGraphics = this.add
      .graphics()
      .setDepth(depth + 1)
      .setScrollFactor(0);

    const textDepth = depth + 2;
    const textStyle = {
      fontSize: "11px",
      color: "#d6c0a4",
      lineSpacing: 3,
    };

    // 좌측 카드 텍스트
    this.hudLeftNameText = this.add
      .text(0, 0, "", { ...textStyle, fontSize: "12px", color: "#f9e4c8", fontStyle: "bold" })
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudLeftStatText = this.add
      .text(0, 0, "", textStyle)
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudLeftLifeText = this.add
      .text(0, 0, "", {
        ...textStyle,
        fontSize: "10px",
        color: "#f8e4a2",
        fontStyle: "bold",
      })
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudLeftKillText = this.add
      .text(0, 0, "", {
        ...textStyle,
        fontSize: "10px",
        color: "#f7c2a2",
        fontStyle: "bold",
      })
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudLeftWeaponIcon = this.add
      .image(0, 0, getWeaponHudTextureKey("paws"))
      .setDepth(textDepth)
      .setScrollFactor(0)
      .setScale(1.05);

    // 우측 카드 텍스트
    this.hudRightNameText = this.add
      .text(0, 0, "", { ...textStyle, fontSize: "12px", color: "#f9e4c8", fontStyle: "bold" })
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudRightStatText = this.add
      .text(0, 0, "", textStyle)
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudRightLifeText = this.add
      .text(0, 0, "", {
        ...textStyle,
        fontSize: "10px",
        color: "#f8e4a2",
        fontStyle: "bold",
      })
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudRightKillText = this.add
      .text(0, 0, "", {
        ...textStyle,
        fontSize: "10px",
        color: "#f7c2a2",
        fontStyle: "bold",
      })
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudRightWeaponIcon = this.add
      .image(0, 0, getWeaponHudTextureKey("paws"))
      .setDepth(textDepth)
      .setScrollFactor(0)
      .setScale(1.05);

    // 타이머 (중앙)
    this.hudTimerText = this.add
      .text(VIEWPORT_WIDTH / 2, HUD_BAR_Y + HUD_BAR_HEIGHT / 2, "", {
        fontSize: "26px",
        fontStyle: "bold",
        color: "#f8ead4",
      })
      .setOrigin(0.5, 0.6)
      .setDepth(textDepth)
      .setScrollFactor(0);
    this.hudTimerSubText = this.add
      .text(VIEWPORT_WIDTH / 2, HUD_BAR_Y + 18, "", {
        fontSize: "10px",
        color: "#9f7d57",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0)
      .setDepth(textDepth)
      .setScrollFactor(0);
  }

  private updateHud(
    players: PlayerSnapshot[],
    timeRemainingMs: number | null,
  ) {
    const localPlayer = players.find((p) => p.id === this.localPlayerId) ?? null;
    const opponent = this.selectHudOpponent(players, timeRemainingMs);

    this.drawPlayerCard(
      this.hudLeftGraphics,
      this.hudLeftNameText,
      this.hudLeftStatText,
      this.hudLeftLifeText,
      this.hudLeftKillText,
      this.hudLeftWeaponIcon,
      HUD_LEFT_CARD_X,
      HUD_BAR_Y + HUD_CARD_PAD_Y,
      localPlayer,
      true,
    );

    this.drawPlayerCard(
      this.hudRightGraphics,
      this.hudRightNameText,
      this.hudRightStatText,
      this.hudRightLifeText,
      this.hudRightKillText,
      this.hudRightWeaponIcon,
      HUD_RIGHT_CARD_X,
      HUD_BAR_Y + HUD_CARD_PAD_Y,
      opponent,
      false,
    );

    this.updateHudTimer(timeRemainingMs);
  }

  private selectHudOpponent(
    players: PlayerSnapshot[],
    timeRemainingMs: number | null,
  ): PlayerSnapshot | null {
    const opponents = players.filter((p) => p.id !== this.localPlayerId);
    if (opponents.length === 0) {
      return null;
    }

    const isFreePlay =
      timeRemainingMs === null || timeRemainingMs >= HUD_TIMER_FREE_PLAY_THRESHOLD_MS;
    if (
      isFreePlay &&
      this.recentAttackTargetId !== null &&
      this.time.now - this.recentAttackAt <= HUD_RECENT_TARGET_TTL_MS
    ) {
      const recentTarget = opponents.find((p) => p.id === this.recentAttackTargetId);
      if (recentTarget) {
        return recentTarget;
      }
    }

    return opponents.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0] ?? null;
  }

  private updateHudTimer(timeRemainingMs: number | null) {
    const panelX = VIEWPORT_WIDTH / 2 - HUD_TIMER_PANEL_W / 2;
    const panelY = HUD_BAR_Y + 16;
    const isFreePlay =
      timeRemainingMs === null || timeRemainingMs >= HUD_TIMER_FREE_PLAY_THRESHOLD_MS;

    this.hudCenterGraphics.clear();
    this.hudCenterGraphics.fillStyle(0x20150f, 0.96);
    this.hudCenterGraphics.fillRoundedRect(
      panelX,
      panelY,
      HUD_TIMER_PANEL_W,
      HUD_TIMER_PANEL_H,
      10,
    );
    this.hudCenterGraphics.fillStyle(0x3d2610, 0.45);
    this.hudCenterGraphics.fillRoundedRect(
      panelX + 6,
      panelY + 6,
      HUD_TIMER_PANEL_W - 12,
      10,
      5,
    );
    this.hudCenterGraphics.lineStyle(1.5, 0x6b4427, 0.95);
    this.hudCenterGraphics.strokeRoundedRect(
      panelX,
      panelY,
      HUD_TIMER_PANEL_W,
      HUD_TIMER_PANEL_H,
      10,
    );

    if (isFreePlay) {
      this.hudTimerSubText.setText("OPEN WORLD").setColor("#9f7d57");
      this.hudTimerText.setText("FREE PLAY").setColor("#f8ead4").setFontSize("20px");
      return;
    }

    const secs = Math.max(0, Math.ceil(timeRemainingMs / 1000));
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;
    const label =
      hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`;
    const danger = secs <= 10;

    this.hudTimerSubText
      .setText(hours > 0 ? "MATCH TIMER" : "TIME LEFT")
      .setColor(danger ? "#fda4af" : "#9f7d57");
    this.hudTimerText
      .setText(label)
      .setColor(danger ? "#ef4444" : "#f8ead4")
      .setFontSize(hours > 0 ? "21px" : "26px");
  }

  private drawPlayerCard(
    g: Phaser.GameObjects.Graphics,
    nameText: Phaser.GameObjects.Text,
    statText: Phaser.GameObjects.Text,
    lifeText: Phaser.GameObjects.Text,
    killText: Phaser.GameObjects.Text,
    weaponIcon: Phaser.GameObjects.Image,
    cardX: number,
    cardY: number,
    player: PlayerSnapshot | null,
    isLocal: boolean,
  ) {
    g.clear();

    if (!player) {
      g.fillStyle(0x120c09, 0.48);
      g.fillRoundedRect(cardX, cardY, HUD_CARD_W, HUD_CARD_H, 8);
      g.lineStyle(1, 0x5c3d1e, 0.28);
      g.strokeRoundedRect(cardX, cardY, HUD_CARD_W, HUD_CARD_H, 6);
      nameText
        .setPosition(cardX + 12, cardY + 20)
        .setOrigin(0, 0)
        .setText(isLocal ? "YOU" : "RIVAL")
        .setColor("#7d6651")
        .setVisible(true);
      statText
        .setPosition(cardX + 12, cardY + 42)
        .setOrigin(0, 0)
        .setText(isLocal ? "joining..." : "waiting...")
        .setColor("#6f5a48")
        .setVisible(true);
      lifeText.setVisible(false);
      killText.setVisible(false);
      weaponIcon.setVisible(false);
      return;
    }

    nameText.setVisible(true);
    statText.setVisible(true);
    lifeText.setVisible(true);
    killText.setVisible(true);
    weaponIcon.setVisible(true);

    const mirrored = !isLocal;
    const faceR = HUD_FACE_SIZE / 2;
    const faceX = mirrored ? cardX + HUD_CARD_W - 22 : cardX + 22;
    const faceY = cardY + 44;
    const infoX = mirrored ? cardX + 10 : cardX + 46;
    const infoY = cardY + 10;
    const infoW = HUD_CARD_W - 56;
    const nameY = infoY + 1;
    const pipY = infoY + 16;
    const barX = infoX;
    const barY = infoY + 25;
    const barW = infoW;
    const barH = 12;
    const hpRatio = Math.max(0, Math.min(1, player.hp / HUD_MAX_HP));
    const barFillColor =
      hpRatio > 0.5 ? 0x7cfc00 : hpRatio > 0.25 ? 0xeab308 : 0xef4444;
    const bodyColor = isLocal ? 0xc8874a : 0x4a4a4a;
    const earColor = isLocal ? 0xd4a574 : 0x5a5a5a;
    const accent = isLocal ? 0x93c5fd : 0xcbd5e1;
    const pipGap = 10;
    const pipStartX = infoX + 6;
    const visibleLifePips = Math.min(player.lives, HUD_MAX_LIFE_PIPS);
    const pipOverflowX = pipStartX + HUD_MAX_LIFE_PIPS * pipGap + 4;
    const bottomRowY = barY + 17;
    const weaponIconX = infoX + 7;
    const weaponInfoX = infoX + 18;
    const killInfoX = infoX + infoW - 2;

    // ── 컴팩트 바 배경 ──
    g.fillStyle(0x120c09, 0.72);
    g.fillRoundedRect(cardX + 4, cardY + 14, HUD_CARD_W - 8, 48, 10);
    g.fillStyle(0x30231a, 0.95);
    g.fillRoundedRect(infoX - 3, infoY - 2, infoW + 6, 44, 8);
    g.fillStyle(0x17110d, 0.96);
    g.fillRoundedRect(infoX, infoY, infoW, 40, 7);
    g.lineStyle(1.2, 0x7a5a34, 0.9);
    g.strokeRoundedRect(infoX, infoY, infoW, 40, 7);

    g.fillStyle(0x1a120e, 0.95);
    g.fillRoundedRect(infoX + 2, infoY + 2, infoW - 4, 10, 4);

    // ── HP 바 (가로) ──
    g.fillStyle(0x20150f, 1);
    g.fillRoundedRect(barX, barY, barW, barH, 5);
    g.fillStyle(0x0f0a06, 0.42);
    g.fillRoundedRect(barX + 2, barY + 2, barW - 4, 3, 2);
    if (hpRatio > 0) {
      const filledW = Math.max(8, Math.floor(barW * hpRatio));
      g.fillStyle(barFillColor, 1);
      g.fillRoundedRect(barX, barY, filledW, barH, 5);
    }
    g.lineStyle(1, 0x0f0a06, 0.4);
    for (let i = 1; i <= 4; i++) {
      const segX = barX + (barW * i) / 5;
      g.lineBetween(segX, barY + 1, segX, barY + barH - 1);
    }
    g.lineStyle(1.2, 0x5c3d1e, 0.9);
    g.strokeRoundedRect(barX, barY, barW, barH, 5);

    // ── 생명 pip ──
    for (let i = 0; i < HUD_MAX_LIFE_PIPS; i++) {
      const px = pipStartX + i * pipGap;
      const alive = i < visibleLifePips;
      g.fillStyle(alive ? 0x7cfc00 : 0x314126, alive ? 0.95 : 0.8);
      g.fillCircle(px, pipY, 3.7);
      g.lineStyle(1, alive ? 0xeaffc4 : 0x10160d, alive ? 0.7 : 0.35);
      g.strokeCircle(px, pipY, 3.7);
    }

    // ── 얼굴 받침 ──
    g.fillStyle(0x120c09, 0.55);
    g.fillCircle(faceX, faceY, faceR + 4);
    g.lineStyle(1.2, isLocal ? 0x9d6a3e : 0x6b5a4d, 0.9);
    g.strokeCircle(faceX, faceY, faceR + 4);

    // 귀
    g.fillStyle(earColor, 1);
    g.fillCircle(faceX - 10, faceY - 13, 6);
    g.fillCircle(faceX + 10, faceY - 13, 6);
    // 귀 안쪽 (핑크)
    g.fillStyle(0xff8fab, 0.55);
    g.fillCircle(faceX - 10, faceY - 13, 3.2);
    g.fillCircle(faceX + 10, faceY - 13, 3.2);
    // 얼굴 몸
    g.fillStyle(bodyColor, 1);
    g.fillCircle(faceX, faceY, faceR);
    // 눈
    g.fillStyle(0x2c1810, 1);
    g.fillCircle(faceX - 6, faceY - 4, 3);
    g.fillCircle(faceX + 6, faceY - 4, 3);
    // 눈 하이라이트
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(faceX - 5, faceY - 5.5, 1.2);
    g.fillCircle(faceX + 7, faceY - 5.5, 1.2);
    // 코
    g.fillStyle(0xff8fab, 1);
    g.fillEllipse(faceX, faceY + 3, 5, 3.5);
    // 얼굴 테두리
    g.lineStyle(1, 0x5c3d1e, 0.5);
    g.strokeCircle(faceX, faceY, faceR);

    // ── 텍스트 업데이트 ──
    nameText
      .setPosition(infoX + 4, nameY)
      .setOrigin(0, 0)
      .setText(player.name.length > 11 ? `${player.name.slice(0, 11)}…` : player.name)
      .setColor(isLocal ? "#fde7c7" : "#e8d4bd");

    const ammo =
      player.equippedWeaponResource !== null &&
      player.equippedWeaponResource !== undefined
        ? String(player.equippedWeaponResource)
        : "∞";
    const weaponIconKey = getWeaponHudTextureKey(player.equippedWeaponId);
    if (this.textures.exists(weaponIconKey)) {
      weaponIcon.setTexture(weaponIconKey);
    }
    weaponIcon.setPosition(weaponIconX, bottomRowY + 5).setScale(0.62);
    statText
      .setPosition(weaponInfoX, bottomRowY - 2)
      .setOrigin(0, 0)
      .setColor("#cdb498")
      .setText(`${resolveWeaponAbbrev(player.equippedWeaponId)} [${ammo}]`);
    lifeText
      .setPosition(pipOverflowX, pipY - 7)
      .setOrigin(0, 0)
      .setText(player.lives > HUD_MAX_LIFE_PIPS ? `+${player.lives - HUD_MAX_LIFE_PIPS}` : "")
      .setColor("#d2e6b2");
    killText
      .setPosition(killInfoX, bottomRowY - 2)
      .setOrigin(1, 0)
      .setText(`K ${player.kills}`)
      .setColor(accent === 0x93c5fd ? "#dbeafe" : "#e2e8f0");
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

  private renderPlayers(
    players: PlayerSnapshot[],
    damageEventMap: Map<string, DamageAppliedEvent[]>,
  ) {
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
        const weaponOverlay = this.add.image(0, 0, "__MISSING").setVisible(false);
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
        root.add([shadow, sprite, weaponOverlay, collider]);
        rendered = {
          root,
          shadow,
          sprite,
          weaponOverlay,
          collider,
          label: this.add.text(player.position.x, player.position.y - 28, player.name, {
            fontSize: "12px",
            color: "#f9fafb",
          }),
          targetX: player.position.x,
          targetY: player.position.y,
          isLocal: false,
          snapshot: player,
          lastImpactDirection: null,
          lastImpactAt: 0,
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
      this.applyDamageFeedback(
        rendered,
        previousSnapshot,
        player,
        damageEventMap.get(player.id) ?? [],
      );
      if (
        previousSnapshot.state !== "respawning" &&
        player.state === "respawning"
      ) {
        this.spawnDeathEcho(rendered, previousSnapshot, player);
      }

      rendered.snapshot = player;
      const isRespawning = player.state === "respawning";
      this.updateWeaponOverlay(
        rendered,
        player,
        isRespawning,
        isLocalPlayer ? this.latestAim : undefined,
      );
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

  private applyDamageFeedback(
    rendered: RenderedPlayer,
    previousSnapshot: PlayerSnapshot,
    nextSnapshot: PlayerSnapshot,
    damageEvents: DamageAppliedEvent[],
  ) {
    let exactDamageApplied = false;

    for (const event of damageEvents) {
      if (this.dismissedDamageEventIds.has(event.id)) {
        continue;
      }

      this.spawnHitBurst(
        event.weaponId,
        event.impactPoint,
        event.impactDirection,
        event.damage,
        true,
      );
      rendered.lastImpactDirection = addUpwardBias(event.impactDirection);
      rendered.lastImpactAt = this.time.now;
      this.dismissedDamageEventIds.set(event.id, this.time.now);
      exactDamageApplied = true;
    }

    if (!exactDamageApplied && previousSnapshot.hp > nextSnapshot.hp) {
      const direction = fallbackImpactDirection(previousSnapshot, nextSnapshot);
      const impactPoint = {
        x: nextSnapshot.position.x - direction.x * PLAYER_SIZE * 0.28,
        y: nextSnapshot.position.y - 7 - direction.y * 3,
      };
      this.spawnHitBurst(
        null,
        impactPoint,
        direction,
        previousSnapshot.hp - nextSnapshot.hp,
        false,
      );
      rendered.lastImpactDirection = direction;
      rendered.lastImpactAt = this.time.now;
    }
  }

  private spawnHitBurst(
    weaponId: string | null,
    impactPoint: Vector2,
    impactDirection: Vector2,
    damage: number,
    isExact: boolean,
  ) {
    const impactStyle = weaponId
      ? resolveWeaponImpactStyle(weaponId)
      : "generic_spark";
    const direction = addUpwardBias(normalizeVector(impactDirection, { x: 1, y: -0.2 }));

    if (impactStyle === "paws_dust") {
      this.spawnPawsImpactBurst(impactPoint, direction, damage, isExact);
      return;
    }

    this.spawnSparkImpactBurst(impactPoint, direction, damage, isExact, impactStyle);
  }

  private spawnSparkImpactBurst(
    impactPoint: Vector2,
    direction: Vector2,
    damage: number,
    isExact: boolean,
    impactStyle: "generic_spark" | "acorn_spark",
  ) {
    const count = isExact ? 7 : 5;
    const colors =
      impactStyle === "acorn_spark"
        ? isExact
          ? [0xfde68a, 0xfca5a5, 0xfef3c7]
          : [0xfcd34d, 0xfde68a]
        : isExact
          ? [0xe2e8f0, 0xf8fafc, 0xcbd5e1]
          : [0xe5e7eb, 0xcbd5e1];

    for (let index = 0; index < count; index += 1) {
      const speed = Phaser.Math.FloatBetween(1.4, 2.8) + damage * 0.015;
      const spreadX = Phaser.Math.FloatBetween(-0.35, 0.35);
      const spreadY = Phaser.Math.FloatBetween(-0.25, 0.18);
      const velocityX = (direction.x + spreadX) * speed;
      const velocityY = (direction.y + spreadY) * speed - 0.35;
      const node = this.add
        .rectangle(
          impactPoint.x + Phaser.Math.FloatBetween(-1.5, 1.5),
          impactPoint.y + Phaser.Math.FloatBetween(-1.5, 1.5),
          Phaser.Math.Between(3, 5),
          Phaser.Math.Between(2, 4),
          Phaser.Utils.Array.GetRandom(colors),
          0.92,
        )
        .setDepth(8);
      node.setAngle(Phaser.Math.FloatBetween(-35, 35));
      this.hitParticles.push({
        node,
        velocityX,
        velocityY,
        angularVelocity: Phaser.Math.FloatBetween(-0.08, 0.08),
        gravity: 0.16,
        drag: 0.96,
        scaleXVelocity: 0,
        scaleYVelocity: 0,
        fadeAt: this.time.now + (isExact ? 160 : 120),
        destroyAt: this.time.now + (isExact ? 430 : 320),
        baseAlpha: 0.92,
      });
    }
  }

  private spawnPawsImpactBurst(
    impactPoint: Vector2,
    direction: Vector2,
    damage: number,
    isExact: boolean,
  ) {
    const dustCount = isExact ? 5 : 3;
    const dustColors = [0xd6b38a, 0xc89b72, 0xe7cfb3];
    const sideX = -direction.y;
    const sideY = direction.x;

    for (let index = 0; index < dustCount; index += 1) {
      const burst = this.add
        .ellipse(
          impactPoint.x + Phaser.Math.FloatBetween(-2, 2),
          impactPoint.y + Phaser.Math.FloatBetween(-2, 2),
          Phaser.Math.Between(8, 12),
          Phaser.Math.Between(5, 8),
          Phaser.Utils.Array.GetRandom(dustColors),
          0.82,
        )
        .setDepth(8);
      burst.setAngle(Phaser.Math.FloatBetween(-35, 35));

      const forwardPush = Phaser.Math.FloatBetween(0.5, 1.15) + damage * 0.01;
      const sideSpread = Phaser.Math.FloatBetween(-0.7, 0.7);
      this.hitParticles.push({
        node: burst,
        velocityX: direction.x * forwardPush + sideX * sideSpread,
        velocityY: direction.y * forwardPush + sideY * sideSpread - 0.12,
        angularVelocity: Phaser.Math.FloatBetween(-0.03, 0.03),
        gravity: 0.04,
        drag: 0.9,
        scaleXVelocity: 0.018,
        scaleYVelocity: 0.012,
        fadeAt: this.time.now + (isExact ? 110 : 90),
        destroyAt: this.time.now + (isExact ? 280 : 220),
        baseAlpha: 0.82,
      });
    }

    const shockwave = this.add
      .ellipse(impactPoint.x, impactPoint.y, 12, 8, 0xfef3c7, 0.2)
      .setDepth(7);
    shockwave.setStrokeStyle(2, 0xf8d7a4, 0.9);
    shockwave.setAngle(Phaser.Math.RadToDeg(Math.atan2(direction.y, direction.x)));
    this.hitParticles.push({
      node: shockwave,
      velocityX: direction.x * 0.35,
      velocityY: direction.y * 0.18 - 0.05,
      angularVelocity: 0,
      gravity: 0.01,
      drag: 0.88,
      scaleXVelocity: 0.065,
      scaleYVelocity: 0.04,
      fadeAt: this.time.now + 60,
      destroyAt: this.time.now + (isExact ? 190 : 160),
      baseAlpha: 0.9,
    });
  }

  private updateWeaponOverlay(
    rendered: RenderedPlayer,
    snapshot: PlayerSnapshot,
    isRespawning: boolean,
    aim?: { x: number; y: number },
  ) {
    const presentation = resolveWeaponEquipPresentation(snapshot.equippedWeaponId);
    const visible = presentation.textureKey !== null && !isRespawning;

    if (presentation.textureKey !== null) {
      rendered.weaponOverlay.setTexture(presentation.textureKey);

      const dir = snapshot.direction;
      const effectiveAim =
        aim ?? (dir === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 });

      // anchorY 보간: 위 조준 시 총구가 올라가고, 아래 조준 시 내려간다
      const anchorYOffset = effectiveAim.y * 8;
      // 수직 조준일수록 X를 몸통 방향으로 당겨 공중부양처럼 보이지 않게 한다
      const xPull = Math.abs(effectiveAim.y) * 3;

      const xSign = dir === "left" ? -1 : 1;
      rendered.weaponOverlay.setPosition(
        xSign * Math.max(0, presentation.offsetX - xPull),
        presentation.offsetY + anchorYOffset,
      );

      // rotation: Phaser transform 순서 = position → rotation → scale(flipX)
      // right-facing: atan2(aim.y, aim.x)
      // left-facing : atan2(aim.y, -aim.x) — flipX가 텍스처를 반전하므로 X 성분을 반전
      const angle =
        dir === "left"
          ? Math.atan2(effectiveAim.y, -effectiveAim.x)
          : Math.atan2(effectiveAim.y, effectiveAim.x);
      rendered.weaponOverlay.setRotation(angle);

      rendered.weaponOverlay.setFlipX(
        presentation.flipWithDirection && dir === "left",
      );
    }

    rendered.weaponOverlay.setVisible(visible);
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
      rendered.root.destroy();
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
      const presentation = resolveWeaponPickupPresentation(pickup.weaponId);
      const accentColor = weaponPickupAccentColor(pickup.source);

      if (!rendered) {
        const shadow = this.add.ellipse(0, 12, 30, 10, 0x020617, 0.26);
        const body =
          presentation.textureKey !== null
            ? this.add.image(0, 0, presentation.textureKey)
            : this.add.ellipse(0, 0, 22, 14, accentColor, 0.95);
        const accent = this.add.rectangle(
          0,
          presentation.textureKey !== null ? 12 : 10,
          presentation.textureKey !== null ? 34 : 18,
          6,
          accentColor,
          0.98,
        );
        const codeText = this.add
          .text(
            0,
            presentation.textureKey !== null ? 12 : 0,
            presentation.code,
            {
              fontSize: presentation.textureKey !== null ? "11px" : "10px",
              color: presentation.textureKey !== null ? "#0f172a" : "#e2e8f0",
              fontStyle: "bold",
            },
          )
          .setOrigin(0.5);
        const detailText = this.add
          .text(0, presentation.textureKey !== null ? 26 : -18, "", {
            fontSize: "10px",
            color: "#cbd5e1",
          })
          .setOrigin(0.5);
        const root = this.add
          .container(pickup.position.x, pickup.position.y, [
            shadow,
            body,
            accent,
            codeText,
            detailText,
          ])
          .setDepth(6);

        rendered = {
          root,
          body,
          accent,
          codeText,
          detailText,
          targetX: pickup.position.x,
          targetY: pickup.position.y,
          spawnedAt: pickup.spawnedAt,
          despawnAt: pickup.despawnAt ?? null,
        };
        this.renderedWeaponPickups.set(pickup.id, rendered);
      }

      rendered.targetX = pickup.position.x;
      rendered.targetY = pickup.position.y;
      rendered.spawnedAt = pickup.spawnedAt;
      rendered.despawnAt = pickup.despawnAt ?? null;
      if (
        shouldSnapToTarget(
          rendered.root.x,
          rendered.root.y,
          rendered.targetX,
          rendered.targetY,
          PICKUP_SNAP_DISTANCE,
        )
      ) {
        rendered.root.setPosition(rendered.targetX, rendered.targetY);
      }
      if (rendered.body instanceof Phaser.GameObjects.Ellipse) {
        rendered.body.setFillStyle(accentColor, 0.95);
      }
      rendered.accent.setFillStyle(accentColor, 0.98);
      rendered.codeText.setText(presentation.code);
      rendered.detailText.setText(
        presentation.showNameLabel
          ? `${weaponName} (${pickup.resourceRemaining})`
          : pickup.source === "spawn"
            ? ""
            : `${pickup.resourceRemaining}`,
      );
    }

    for (const [pickupId, rendered] of this.renderedWeaponPickups) {
      if (!nextIds.has(pickupId)) {
        rendered.root.destroy();
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
          spawnedAt: pickup.spawnedAt,
          despawnAt: pickup.despawnAt ?? null,
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
      rendered.spawnedAt = pickup.spawnedAt;
      rendered.despawnAt = pickup.despawnAt ?? null;
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
    this.latestAim = aim;

    const moveX =
      Number(this.cursors.right.isDown || this.keys.d.isDown) -
      Number(this.cursors.left.isDown || this.keys.a.isDown);
    const moveY = Number(this.cursors.down.isDown || this.keys.s.isDown);
    const attackHeld = pointer.isDown;
    const attackPressed =
      this.queuedClickAttack || (attackHeld && !this.attackWasDown);
    if (attackPressed) {
      this.showAttackFlash(
        localPlayer?.snapshot.equippedWeaponId ?? "paws",
        originX,
        originY,
        aim.x,
        aim.y,
      );
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
    weaponId: string,
    originX: number,
    originY: number,
    aimX: number,
    aimY: number,
  ) {
    this.attackFlash.clear();
    const fireStyle = resolveWeaponFireStyle(weaponId);
    const muzzleX = originX + aimX * 15;
    const muzzleY = originY + aimY * 15;

    if (fireStyle === "muzzle_flash") {
      const tracerEndX = muzzleX + aimX * 62;
      const tracerEndY = muzzleY + aimY * 62;
      const sideX = -aimY;
      const sideY = aimX;

      this.attackFlash.lineStyle(2, 0xfde68a, 0.9);
      this.attackFlash.lineBetween(muzzleX, muzzleY, tracerEndX, tracerEndY);

      this.attackFlash.fillStyle(0xf59e0b, 0.96);
      this.attackFlash.fillTriangle(
        muzzleX + aimX * 11,
        muzzleY + aimY * 11,
        muzzleX - sideX * 3,
        muzzleY - sideY * 3,
        muzzleX + sideX * 3,
        muzzleY + sideY * 3,
      );
      this.attackFlash.fillStyle(0xfef3c7, 0.92);
      this.attackFlash.fillCircle(muzzleX, muzzleY, 3.5);
      this.attackFlashUntil = this.time.now + 70;
      return;
    }

    if (fireStyle === "paws_pulse") {
      // 사다리꼴 원뿔: 에임 방향으로 내지르는 주먹 모양
      // 좁은 쪽(캐릭터 방향) → 넓은 쪽(주먹 끝)
      const perpX = -aimY;
      const perpY = aimX;
      const nearDist = 12;
      const farDist = 76;
      const nearHW = 6;
      const farHW = 24;

      const p1x = originX + aimX * nearDist + perpX * nearHW;
      const p1y = originY + aimY * nearDist + perpY * nearHW;
      const p2x = originX + aimX * nearDist - perpX * nearHW;
      const p2y = originY + aimY * nearDist - perpY * nearHW;
      const p3x = originX + aimX * farDist - perpX * farHW;
      const p3y = originY + aimY * farDist - perpY * farHW;
      const p4x = originX + aimX * farDist + perpX * farHW;
      const p4y = originY + aimY * farDist + perpY * farHW;

      this.attackFlash.fillStyle(0xfb923c, 0.72);
      this.attackFlash.fillPoints(
        [
          { x: p1x, y: p1y },
          { x: p2x, y: p2y },
          { x: p3x, y: p3y },
          { x: p4x, y: p4y },
        ],
        true,
      );
      this.attackFlash.lineStyle(2, 0xfef08a, 0.88);
      this.attackFlash.strokePoints(
        [
          { x: p1x, y: p1y },
          { x: p2x, y: p2y },
          { x: p3x, y: p3y },
          { x: p4x, y: p4y },
        ],
        true,
      );
      this.attackFlashUntil = this.time.now + 90;
      return;
    }

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

  private send(message: JoinRoomMessage | PlayerInputMessage | PingMessage) {
    this.socket?.send(JSON.stringify(message));
  }

  update() {
    this.pruneKillFeed(this.time.now);
    this.pruneDismissedDamageEvents(this.time.now);
    this.updateDeathEchoes(this.time.now);
    this.updateHitParticles(this.time.now);

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
      rendered.root.x = Phaser.Math.Linear(
        rendered.root.x,
        rendered.targetX,
        PICKUP_LERP,
      );
      rendered.root.y = Phaser.Math.Linear(
        rendered.root.y,
        rendered.targetY,
        PICKUP_LERP,
      );
      rendered.root.setAlpha(this.resolvePickupBlinkAlpha(rendered.spawnedAt, rendered.despawnAt));
    }

    for (const [, rendered] of this.renderedItemPickups) {
      rendered.body.x = Phaser.Math.Linear(rendered.body.x, rendered.targetX, PICKUP_LERP);
      rendered.body.y = Phaser.Math.Linear(rendered.body.y, rendered.targetY, PICKUP_LERP);
      const alpha = this.resolvePickupBlinkAlpha(rendered.spawnedAt, rendered.despawnAt);
      rendered.body.setAlpha(alpha);
      rendered.label.setAlpha(alpha);
      rendered.label.setPosition(
        rendered.body.x - rendered.label.width / 2,
        rendered.body.y - 20,
      );
    }
  }

  private sendPing() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingPingNonce = nonce;
    this.pendingPingSentAt = Date.now();
    this.send({
      type: "ping",
      timestamp: Date.now(),
      payload: { nonce },
    } satisfies PingMessage);
  }

  private refreshNetworkStatusText(errorCode?: string) {
    let label = "WS connecting";
    let color = "#93c5fd";
    if (this.networkState === "joining") {
      label = "WS joining";
    } else if (this.networkState === "online") {
      label = this.latestPingMs !== null ? `WS ${this.latestPingMs}ms` : "WS online";
      color = this.latestPingMs !== null && this.latestPingMs >= 180 ? "#fca5a5" : "#86efac";
    } else if (this.networkState === "offline") {
      label = "WS offline";
      color = "#fca5a5";
    } else if (this.networkState === "error") {
      label = errorCode ? `WS error ${errorCode}` : "WS error";
      color = "#fca5a5";
    }
    this.networkStatusText.setText(label).setColor(color);
  }

  private resolvePickupBlinkAlpha(spawnedAt: number, despawnAt: number | null): number {
    if (despawnAt === null || despawnAt <= spawnedAt) {
      return 1;
    }
    const total = despawnAt - spawnedAt;
    const remaining = despawnAt - this.time.now;
    if (remaining <= 0) {
      return 0.22;
    }
    const ratio = remaining / total;
    if (ratio > 0.35) {
      return 1;
    }

    let period = 220;
    if (ratio <= 0.08) {
      period = 70;
    } else if (ratio <= 0.18) {
      period = 140;
    }
    const phase = Math.floor(remaining / period) % 2 === 0;
    return phase ? 1 : 0.22;
  }

  private pruneDismissedDamageEvents(now: number) {
    for (const [id, receivedAt] of this.dismissedDamageEventIds) {
      if (now - receivedAt >= DAMAGE_EVENT_DISMISSED_RETENTION_MS) {
        this.dismissedDamageEventIds.delete(id);
      }
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
  backgroundColor: "#111827",
  scene: MainScene,
});
