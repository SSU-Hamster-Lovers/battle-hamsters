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
import { resolvePickupCollapseTransform } from "./pickup-vfx";
import type {
  CollisionPrimitive,
  DamageAppliedEvent,
  HazardZone,
  JoinRoomMessage,
  KillFeedEntry,
  PingMessage,
  PlayerInputMessage,
  ProjectileSnapshot,
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
const PROJECTILE_LERP = 0.58;
const PROJECTILE_SNAP_DISTANCE = 88;
const PROJECTILE_PREDICTION_MS = 75;
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

function resolveClampedAimForWeapon(
  weaponId: string,
  aim: { x: number; y: number },
  direction: "left" | "right",
) {
  const aimProfile = weaponDefinitionById[weaponId]?.aimProfile;
  if (!aimProfile) {
    return aim;
  }

  const localAngle =
    direction === "left"
      ? Math.atan2(aim.y, -aim.x)
      : Math.atan2(aim.y, aim.x);
  const clampedLocalAngle = Math.max(
    (aimProfile.minAimDeg * Math.PI) / 180,
    Math.min((aimProfile.maxAimDeg * Math.PI) / 180, localAngle),
  );

  return {
    x:
      direction === "left"
        ? -Math.cos(clampedLocalAngle)
        : Math.cos(clampedLocalAngle),
    y: Math.sin(clampedLocalAngle),
  };
}

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
  burnFlame: Phaser.GameObjects.Graphics;
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

type RenderedProjectile = {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Ellipse;
  trail: Phaser.GameObjects.Rectangle;
  weaponId: string;
  serverX: number;
  serverY: number;
  velocityX: number;
  velocityY: number;
  gravityPerSec2: number;
  lastSnapshotAt: number;
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

function drawSpikeStrip(
  scene: Phaser.Scene,
  hazard: HazardZone & {
    type: "instant_kill_hazard";
    x: number;
    y: number;
    width: number;
    height: number;
  },
) {
  scene.add.rectangle(
    hazard.x + hazard.width / 2,
    hazard.y + hazard.height - 3,
    hazard.width,
    6,
    0x374151,
    0.9,
  );

  const spikeCount = Math.max(4, Math.round(hazard.width / 24));
  const spikeWidth = hazard.width / spikeCount;
  for (let i = 0; i < spikeCount; i += 1) {
    const centerX = hazard.x + spikeWidth * i + spikeWidth / 2;
    const spike = scene.add.triangle(
      centerX,
      hazard.y + hazard.height / 2,
      -spikeWidth / 2,
      hazard.height / 2,
      0,
      -hazard.height / 2,
      spikeWidth / 2,
      hazard.height / 2,
      0x9ca3af,
      0.96,
    );
    spike.setStrokeStyle(1, 0xe5e7eb, 0.8);
  }
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

function resolveProjectilePresentation(weaponId: string): {
  color: number;
  radius: number;
  /** 타원 세로 반지름. 없으면 radius와 동일. */
  radiusY?: number;
  trailLength: number;
  trailThickness: number;
} {
  switch (weaponId) {
    case "seed_shotgun":
      // 씨앗: 작고 녹색/갈색
      return {
        color: 0x88cc44,
        radius: 3,
        trailLength: 3,
        trailThickness: 2,
      };
    case "walnut_cannon":
      // 호두: 넓적하고 갈색, 포물선으로 회전하며 날아감
      return {
        color: 0xc8a05a,
        radius: 6,
        radiusY: 4,
        trailLength: 10,
        trailThickness: 4,
      };
    default:
      return {
        color: 0xf8fafc,
        radius: 3,
        trailLength: 5,
        trailThickness: 2,
      };
  }
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
  private mortarArc!: Phaser.GameObjects.Graphics;
  private matchOverlayBg!: Phaser.GameObjects.Rectangle;
  private matchOverlayText!: Phaser.GameObjects.Text;
  private cameraConfigured = false;
  private debugLayer: VisibilityControlledObject[] = [];
  private deathEchoes: DeathEcho[] = [];
  private hitParticles: HitParticle[] = [];
  private renderedPlayers = new Map<string, RenderedPlayer>();
  private renderedProjectiles = new Map<string, RenderedProjectile>();
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

  // ── Mortar arc preview ───────────────────────────────────────────────────

  private updateMortarArc() {
    this.mortarArc.clear();

    const localPlayer = this.localPlayerId
      ? this.renderedPlayers.get(this.localPlayerId)
      : null;
    if (!localPlayer || localPlayer.snapshot.equippedWeaponId !== "blueberry_mortar") {
      return;
    }

    const mortarDef = weaponDefinitionById["blueberry_mortar"];
    if (!mortarDef) return;

    const pointer = this.input.activePointer;
    const originX = localPlayer.root.x;
    const originY = localPlayer.root.y;
    const rawAimX = pointer.worldX - originX;
    const rawAimY = pointer.worldY - originY;
    const aimLength = Math.hypot(rawAimX, rawAimY) || 1;
    const rawAim = { x: rawAimX / aimLength, y: rawAimY / aimLength };

    const clampedAim = resolveClampedAimForWeapon(
      "blueberry_mortar",
      rawAim,
      localPlayer.snapshot.direction,
    );

    const pres = resolveWeaponEquipPresentation("blueberry_mortar");
    const dir = localPlayer.snapshot.direction;
    const xSign = dir === "left" ? -1 : 1;
    const xPull = Math.abs(clampedAim.y) * 3;
    const anchorYOffset = clampedAim.y * 8;
    const weaponCenterX = xSign * Math.max(0, pres.offsetX - xPull);
    const weaponCenterY = pres.offsetY + anchorYOffset;
    let px = originX + weaponCenterX + pres.muzzleFromCenter * clampedAim.x;
    let py = originY + weaponCenterY + pres.muzzleFromCenter * clampedAim.y;

    const speed = mortarDef.projectileSpeed;
    const gravity = (mortarDef.projectileGravityPerSec2 ?? 0) as number;
    let vx = clampedAim.x * speed;
    let vy = clampedAim.y * speed;
    let rangeRemaining = mortarDef.range;

    const dt = 0.05; // 50ms steps (서버 TICK_INTERVAL_MS와 동일)
    const maxSteps = 120;
    const mapW = GAME_WIDTH;
    const mapH = GAME_HEIGHT + 200;

    for (let i = 0; i < maxSteps; i++) {
      // 서버와 동일한 사다리꼴 적분 (trapezoidal): avg_vel * dt
      const nvy = vy + gravity * dt;
      const avgvy = (vy + nvy) * 0.5;
      const nx = px + vx * dt;
      const ny = py + avgvy * dt;
      const stepLen = Math.hypot(vx * dt, avgvy * dt);
      vy = nvy;

      // 사거리 소진 → 현재 스텝의 비율만큼만 이동
      if (stepLen > 0 && stepLen >= rangeRemaining) {
        const scale = rangeRemaining / stepLen;
        const ex = px + vx * dt * scale;
        const ey = py + avgvy * dt * scale;
        this.mortarArc.lineStyle(2, 0xa78bfa, 0.7);
        this.mortarArc.strokeCircle(ex, ey, 12);
        this.mortarArc.lineStyle(1, 0xffffff, 0.4);
        this.mortarArc.strokeCircle(ex, ey, 6);
        break;
      }
      rangeRemaining -= stepLen;

      // 맵 경계 밖 → 중단
      if (nx < 0 || nx > mapW || ny > mapH) break;

      // 짝수 스텝만 점으로 그림 (점선 효과)
      if (i % 2 === 0) {
        const alpha = 0.25 + (i / maxSteps) * 0.4;
        const radius = i < maxSteps * 0.8 ? 2.5 : 4;
        this.mortarArc.fillStyle(0xc4b5fd, alpha);
        this.mortarArc.fillCircle(nx, ny, radius);
      }

      px = nx;
      py = ny;

      // 맵 바닥(또는 마지막 스텝): 착지 예상 원 표시
      if (i === maxSteps - 1 || ny > mapH - 200) {
        this.mortarArc.lineStyle(2, 0xa78bfa, 0.7);
        this.mortarArc.strokeCircle(nx, ny, 12);
        this.mortarArc.lineStyle(1, 0xffffff, 0.4);
        this.mortarArc.strokeCircle(nx, ny, 6);
        break;
      }
    }
  }

  // ── Burn flame ────────────────────────────────────────────────────────────

  private updateBurnFlames(now: number) {
    for (const [, rendered] of this.renderedPlayers) {
      const isBurning =
        rendered.snapshot.state !== "respawning" &&
        rendered.snapshot.effects.some((e) => e.kind === "burn");
      if (!isBurning) {
        rendered.burnFlame.clear();
        continue;
      }
      this.redrawBurnFlame(rendered.burnFlame, now);
    }
  }

  /**
   * 매 프레임 sin 파형 기반으로 3-레이어 불꽃 실루엣을 재드로우한다.
   *
   * 불꽃 형태:
   *  - 상단: 포물선 envelope 위에 두 개의 sin 파형을 더해 흔들리는 혀 모양
   *  - 하단: 반타원 (플레이어 발 아래 살짝 감싸는 형태)
   *
   * 레이어 순서: 어두운 주황(외곽) → 밝은 주황 → 노란 코어
   */
  private redrawBurnFlame(g: Phaser.GameObjects.Graphics, now: number) {
    g.clear();

    const layers: Array<{
      color: number;
      alpha: number;
      wx: number;
      wy: number;
      ts: number;
      phase: number;
    }> = [
      // 외곽층: 붉은-주황, 넓고 느린 흔들림
      { color: 0xcc2200, alpha: 0.55, wx: 1.0, wy: 1.0,  ts: 1.0, phase: 0.0 },
      // 중간층: 주황, 중간
      { color: 0xff6600, alpha: 0.62, wx: 0.78, wy: 0.86, ts: 1.35, phase: 2.1 },
      // 코어: 노란빛, 좁고 빠른 흔들림
      { color: 0xffdd00, alpha: 0.48, wx: 0.52, wy: 0.68, ts: 0.85, phase: 4.7 },
    ];

    for (const L of layers) {
      this.drawBurnFlameLayer(g, now, L.color, L.alpha, L.wx, L.wy, L.ts, L.phase);
    }
  }

  private drawBurnFlameLayer(
    g: Phaser.GameObjects.Graphics,
    now: number,
    color: number,
    alpha: number,
    wx: number,
    wy: number,
    ts: number,
    phase: number,
  ) {
    // 플레이어는 28×28 px. 불꽃은 플레이어보다 조금 넓고 위로 길게.
    const W = 15 * wx;     // 좌우 반폭 (px)
    const topH = 40 * wy;  // 중심 위로 최대 불꽃 높이
    const botH = 10 * wy;  // 중심 아래 반타원 높이

    g.fillStyle(color, alpha);
    g.beginPath();

    // ① 상단 흔들리는 불꽃 엣지: 왼쪽(-W) → 오른쪽(+W)
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const u = i / N;        // 0 → 1
      const nx = u * 2 - 1;  // -1 → 1 (중앙=0)
      const x = nx * W;

      // 포물선 envelope: 가장자리에서 0, 중앙에서 1
      const env = 1.0 - nx * nx;

      // 두 sin 파형을 더해 불규칙한 불꽃 혀 모양 생성
      const f =
        Math.sin((now * ts) / 165 + nx * 5.2 + phase) * 8.5 * wy +
        Math.sin((now * ts) / 95 + nx * 10.8 + phase + 0.7) * 4.0 * wy;

      // y < 0 = 위쪽; envelope이 높이를 조절하고 f가 흔들림을 준다
      const y = -(topH * env) + f;

      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }

    // ② 하단 반타원: 오른쪽(+W,0) → 바닥(0,botH) → 왼쪽(-W,0)
    const botN = 16;
    for (let i = 0; i <= botN; i++) {
      const angle = (i / botN) * Math.PI; // 0 → π
      const x = Math.cos(angle) * W;
      const y = Math.sin(angle) * botH;
      g.lineTo(x, y);
    }

    g.closePath();
    g.fillPath();
  }

  // ─────────────────────────────────────────────────────────────────────────

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
    this.mortarArc = this.add.graphics().setDepth(8);

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

      drawSpikeStrip(this, hazard);
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
      this.clearRenderedProjectiles();
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
    this.clearRenderedProjectiles();
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
    this.renderProjectiles(message.payload.projectiles);
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
        const burnFlame = this.add.graphics();
        root.add([shadow, burnFlame, sprite, weaponOverlay, collider]);
        rendered = {
          root,
          shadow,
          sprite,
          weaponOverlay,
          collider,
          burnFlame,
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

    if (impactStyle === "seed_burst") {
      this.spawnSeedImpactBurst(impactPoint, direction, isExact);
      return;
    }

    if (impactStyle === "cannon_impact") {
      this.spawnCannonImpactBurst(impactPoint, direction, isExact);
      return;
    }

    if (impactStyle === "explosion_burst") {
      this.spawnExplosionBurst(impactPoint);
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

  private spawnSeedImpactBurst(
    impactPoint: Vector2,
    direction: Vector2,
    isExact: boolean,
  ) {
    // 씨앗 파편 — 녹색/갈색 작은 타원 4~6개
    const colors = [0x88cc44, 0x55cc44, 0xb8844e, 0x6da836];
    const count = isExact ? 6 : 4;
    for (let i = 0; i < count; i++) {
      const speed = Phaser.Math.FloatBetween(1.2, 2.4);
      const spreadX = Phaser.Math.FloatBetween(-0.4, 0.4);
      const spreadY = Phaser.Math.FloatBetween(-0.3, 0.2);
      const node = this.add
        .ellipse(
          impactPoint.x + Phaser.Math.FloatBetween(-2, 2),
          impactPoint.y + Phaser.Math.FloatBetween(-2, 2),
          Phaser.Math.Between(2, 4),
          Phaser.Math.Between(3, 5),
          Phaser.Utils.Array.GetRandom(colors) as number,
          0.88,
        )
        .setDepth(8);
      this.hitParticles.push({
        node,
        velocityX: (direction.x + spreadX) * speed,
        velocityY: (direction.y + spreadY) * speed - 0.3,
        angularVelocity: Phaser.Math.FloatBetween(-0.1, 0.1),
        gravity: 0.18,
        drag: 0.97,
        scaleXVelocity: 0,
        scaleYVelocity: 0,
        fadeAt: this.time.now + (isExact ? 150 : 100),
        destroyAt: this.time.now + (isExact ? 380 : 280),
        baseAlpha: 0.88,
      });
    }
  }

  private spawnCannonImpactBurst(
    impactPoint: Vector2,
    direction: Vector2,
    isExact: boolean,
  ) {
    // 호두 대포 충격 — 갈색/베이지 큰 파편 + 먼지 구름
    const debrisColors = [0xd4b896, 0xf8c06a, 0xe2c88a, 0xc8a05a];
    const dustColors = [0xd1d5db, 0xe5e7eb, 0xc8a05a];
    const count = isExact ? 10 : 7;
    for (let i = 0; i < count; i++) {
      const isDust = i >= count - 3;
      const speed = isDust
        ? Phaser.Math.FloatBetween(0.6, 1.4)
        : Phaser.Math.FloatBetween(1.8, 3.6);
      const spreadX = Phaser.Math.FloatBetween(-0.5, 0.5);
      const spreadY = Phaser.Math.FloatBetween(-0.4, 0.2);
      const colors = isDust ? dustColors : debrisColors;
      const size = isDust ? Phaser.Math.Between(5, 9) : Phaser.Math.Between(4, 7);
      const node = this.add
        .rectangle(
          impactPoint.x + Phaser.Math.FloatBetween(-3, 3),
          impactPoint.y + Phaser.Math.FloatBetween(-3, 3),
          size,
          isDust ? size : Phaser.Math.Between(3, 5),
          Phaser.Utils.Array.GetRandom(colors) as number,
          isDust ? 0.55 : 0.9,
        )
        .setDepth(8);
      node.setAngle(Phaser.Math.FloatBetween(-45, 45));
      this.hitParticles.push({
        node,
        velocityX: (direction.x + spreadX) * speed,
        velocityY: (direction.y + spreadY) * speed - (isDust ? 0.2 : 0.5),
        angularVelocity: Phaser.Math.FloatBetween(-0.06, 0.06),
        gravity: isDust ? 0.04 : 0.2,
        drag: isDust ? 0.94 : 0.95,
        scaleXVelocity: 0,
        scaleYVelocity: 0,
        fadeAt: this.time.now + (isExact ? 200 : 140),
        destroyAt: this.time.now + (isExact ? 520 : 380),
        baseAlpha: isDust ? 0.55 : 0.9,
      });
    }
  }

  private spawnExplosionBurst(impactPoint: Vector2) {
    // 블루베리 박격포 폭발 — 보라/흰 원형 파동 + 파편
    const coreColors = [0xddd6fe, 0xffffff, 0xc4b5fd];
    const fragmentColors = [0x7c3aed, 0x6d28d9, 0xa78bfa, 0xffffff];
    // 폭발 중심 플래시
    for (let i = 0; i < 3; i++) {
      const size = Phaser.Math.Between(14, 22);
      const node = this.add
        .ellipse(
          impactPoint.x + Phaser.Math.FloatBetween(-4, 4),
          impactPoint.y + Phaser.Math.FloatBetween(-4, 4),
          size,
          size * 0.8,
          Phaser.Utils.Array.GetRandom(coreColors) as number,
          0.8,
        )
        .setDepth(9);
      this.hitParticles.push({
        node,
        velocityX: Phaser.Math.FloatBetween(-0.4, 0.4),
        velocityY: Phaser.Math.FloatBetween(-0.8, -0.2),
        angularVelocity: Phaser.Math.FloatBetween(-0.04, 0.04),
        gravity: 0.06,
        drag: 0.9,
        scaleXVelocity: 0.04,
        scaleYVelocity: 0.04,
        fadeAt: this.time.now + 100,
        destroyAt: this.time.now + 350,
        baseAlpha: 0.8,
      });
    }
    // 파편 파티클 (방사형)
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + Phaser.Math.FloatBetween(-0.3, 0.3);
      const speed = Phaser.Math.FloatBetween(2.5, 5.0);
      const size = Phaser.Math.Between(3, 6);
      const node = this.add
        .rectangle(
          impactPoint.x,
          impactPoint.y,
          size,
          Phaser.Math.Between(2, 4),
          Phaser.Utils.Array.GetRandom(fragmentColors) as number,
          0.9,
        )
        .setDepth(8);
      node.setAngle(Phaser.Math.RadToDeg(angle));
      this.hitParticles.push({
        node,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 0.5,
        angularVelocity: Phaser.Math.FloatBetween(-0.08, 0.08),
        gravity: 0.18,
        drag: 0.96,
        scaleXVelocity: 0,
        scaleYVelocity: 0,
        fadeAt: this.time.now + 200,
        destroyAt: this.time.now + 500,
        baseAlpha: 0.9,
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

  private spawnFlameParticles(
    muzzleX: number,
    muzzleY: number,
    aimX: number,
    aimY: number,
  ) {
    // 색상: 안쪽(노란/주황) ~ 바깥쪽(주황/붉은)으로 섞임
    const flameColors = [0xffdd44, 0xff9900, 0xff6600, 0xff3300, 0xffaa00];
    const perpX = -aimY;
    const perpY = aimX;
    const count = Phaser.Math.Between(2, 3);

    for (let i = 0; i < count; i++) {
      // speed 4.5~7.5 px/frame, drag 0.98 → 최대 ~155px 이동 (hit range 170px 내)
      const speed = Phaser.Math.FloatBetween(4.5, 7.5);
      const side = Phaser.Math.FloatBetween(-0.3, 0.3);
      const vx = (aimX + side * perpX) * speed;
      const vy = (aimY + side * perpY) * speed - Phaser.Math.FloatBetween(0.1, 0.35);
      const size = Phaser.Math.FloatBetween(4, 6.5);
      // 수명 280~430ms: 최고속도 파티클이 범위 경계 근처에서 페이드아웃
      const lifetime = Phaser.Math.Between(280, 430);
      const node = this.add
        .ellipse(
          muzzleX + Phaser.Math.FloatBetween(-2, 2),
          muzzleY + Phaser.Math.FloatBetween(-2, 2),
          size,
          size * 0.75,
          Phaser.Utils.Array.GetRandom(flameColors) as number,
          0.85,
        )
        .setDepth(8);

      this.hitParticles.push({
        node,
        velocityX: vx,
        velocityY: vy,
        angularVelocity: Phaser.Math.FloatBetween(-0.02, 0.02),
        gravity: 0.31,
        drag: 0.98,
        scaleXVelocity: 0.022,
        scaleYVelocity: 0.018,
        fadeAt: this.time.now + lifetime * 0.5,
        destroyAt: this.time.now + lifetime,
        baseAlpha: 0.85,
      });
    }
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
      const clampedAim = resolveClampedAimForWeapon(
        snapshot.equippedWeaponId,
        effectiveAim,
        dir,
      );
      const clampedAimX = clampedAim.x;
      const clampedAimY = clampedAim.y;

      // anchorY 보간: 위 조준 시 총구가 올라가고, 아래 조준 시 내려간다
      const anchorYOffset = clampedAimY * 8;
      // 수직 조준일수록 X를 몸통 방향으로 당겨 공중부양처럼 보이지 않게 한다
      const xPull = Math.abs(clampedAimY) * 3;

      const xSign = dir === "left" ? -1 : 1;
      rendered.weaponOverlay.setPosition(
        xSign * Math.max(0, presentation.offsetX - xPull),
        presentation.offsetY + anchorYOffset,
      );

      // rotation: Phaser transform 순서 = Scale(flipX) → Rotate → Translate
      // right-facing: 배럴 팁 (+6,0) → Rotate(a) → (6cosA, 6sinA) = aim
      //   → a = atan2(aim.y, aim.x)
      // left-facing : 배럴 팁 (+6,0) → flipX → (-6,0) → Rotate(a) → (-6cosA, -6sinA) = aim
      //   → cosA = -aim.x, sinA = -aim.y → a = atan2(-aim.y, -aim.x)
      const angle =
        dir === "left"
          ? Math.atan2(-clampedAimY, -clampedAimX)
          : Math.atan2(clampedAimY, clampedAimX);
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

  private clearRenderedProjectiles() {
    for (const [projectileId, rendered] of this.renderedProjectiles) {
      rendered.root.destroy();
      this.renderedProjectiles.delete(projectileId);
    }
  }

  private clearRenderedItemPickups() {
    for (const [pickupId, rendered] of this.renderedItemPickups) {
      rendered.body.destroy();
      rendered.label.destroy();
      this.renderedItemPickups.delete(pickupId);
    }
  }

  private renderProjectiles(projectiles: ProjectileSnapshot[]) {
    const nextIds = new Set(projectiles.map((projectile) => projectile.id));
    const snapshotNow = this.time.now;

    for (const projectile of projectiles) {
      let rendered = this.renderedProjectiles.get(projectile.id);
      const presentation = resolveProjectilePresentation(projectile.weaponId);
      const predictedX = projectile.position.x;
      const predictedY = projectile.position.y;

      if (!rendered) {
        const trail = this.add.rectangle(
          -presentation.trailLength * 0.5,
          0,
          presentation.trailLength,
          presentation.trailThickness,
          presentation.color,
          0.32,
        );
        const ry = presentation.radiusY ?? presentation.radius;
        const body = this.add.ellipse(
          0,
          0,
          presentation.radius * 2,
          ry * 2,
          presentation.color,
          0.96,
        );
        trail.setOrigin(0.5);
        const root = this.add
          .container(predictedX, predictedY, [trail, body])
          .setDepth(6.5);
        rendered = {
          root,
          body,
          trail,
          weaponId: projectile.weaponId,
          serverX: projectile.position.x,
          serverY: projectile.position.y,
          velocityX: projectile.velocity.x,
          velocityY: projectile.velocity.y,
          gravityPerSec2:
            weaponDefinitionById[projectile.weaponId]?.projectileGravityPerSec2 ?? 0,
          lastSnapshotAt: snapshotNow,
        };
        this.renderedProjectiles.set(projectile.id, rendered);
      }

      rendered.body.setSize(
        presentation.radius * 2,
        (presentation.radiusY ?? presentation.radius) * 2,
      );
      rendered.body.setFillStyle(presentation.color, 0.96);
      rendered.trail.setSize(presentation.trailLength, presentation.trailThickness);
      rendered.trail.setFillStyle(presentation.color, 0.32);
      rendered.trail.setPosition(-presentation.trailLength * 0.5, 0);
      rendered.weaponId = projectile.weaponId;
      rendered.serverX = projectile.position.x;
      rendered.serverY = projectile.position.y;
      rendered.velocityX = projectile.velocity.x;
      rendered.velocityY = projectile.velocity.y;
      rendered.gravityPerSec2 =
        weaponDefinitionById[projectile.weaponId]?.projectileGravityPerSec2 ?? 0;
      rendered.lastSnapshotAt = snapshotNow;
      if (
        shouldSnapToTarget(
          rendered.root.x,
          rendered.root.y,
          predictedX,
          predictedY,
          PROJECTILE_SNAP_DISTANCE,
        )
      ) {
        rendered.root.setPosition(predictedX, predictedY);
      }
      rendered.root.setRotation(
        Math.atan2(projectile.velocity.y, projectile.velocity.x),
      );
    }

    for (const [projectileId, rendered] of this.renderedProjectiles) {
      if (!nextIds.has(projectileId)) {
        rendered.root.destroy();
        this.renderedProjectiles.delete(projectileId);
      }
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
      const equippedId = localPlayer?.snapshot.equippedWeaponId ?? "paws";
      const pres = resolveWeaponEquipPresentation(equippedId);
      const flashAim = localPlayer
        ? resolveClampedAimForWeapon(
            equippedId,
            aim,
            localPlayer.snapshot.direction,
          )
        : aim;
      let muzzleWorldX: number;
      let muzzleWorldY: number;

      if (pres.textureKey !== null && localPlayer) {
        // updateWeaponOverlay 와 동일한 수식으로 총구 세계 좌표를 역산한다.
        // 증명: 이미지 센터에서 총구까지의 벡터는 회전/flip 후 항상 aim * muzzleFromCenter 이므로
        //   muzzle_world = player + weapon_center_offset + muzzleFromCenter * aim
        const dir = localPlayer.snapshot.direction;
        const xSign = dir === "left" ? -1 : 1;
        const xPull = Math.abs(flashAim.y) * 3;
        const anchorYOffset = flashAim.y * 8;
        const weaponCenterX = xSign * Math.max(0, pres.offsetX - xPull);
        const weaponCenterY = pres.offsetY + anchorYOffset;
        muzzleWorldX =
          originX + weaponCenterX + pres.muzzleFromCenter * flashAim.x;
        muzzleWorldY =
          originY + weaponCenterY + pres.muzzleFromCenter * flashAim.y;
      } else {
        // overlay 없는 무기(paws 등)는 캐릭터 중심 기준 고정 오프셋
        muzzleWorldX = originX + flashAim.x * 15;
        muzzleWorldY = originY + flashAim.y * 15;
      }

      this.showAttackFlash(
        equippedId,
        muzzleWorldX,
        muzzleWorldY,
        flashAim.x,
        flashAim.y,
      );
    }

    // 레이저 커터 빔 — attackHeld 동안 매 50ms 틱마다 지속 렌더
    if (attackHeld && localPlayer?.snapshot.equippedWeaponId === "laser_cutter") {
      const beamAim = resolveClampedAimForWeapon(
        "laser_cutter",
        aim,
        localPlayer.snapshot.direction,
      );
      const beamPres = resolveWeaponEquipPresentation("laser_cutter");
      const dir = localPlayer.snapshot.direction;
      const xSign = dir === "left" ? -1 : 1;
      const xPull = Math.abs(beamAim.y) * 3;
      const anchorYOffset = beamAim.y * 8;
      const weaponCenterX = xSign * Math.max(0, beamPres.offsetX - xPull);
      const weaponCenterY = beamPres.offsetY + anchorYOffset;
      const bMuzzleX = originX + weaponCenterX + beamPres.muzzleFromCenter * beamAim.x;
      const bMuzzleY = originY + weaponCenterY + beamPres.muzzleFromCenter * beamAim.y;
      this.attackFlash.clear();
      // 외부 글로우 (넓고 반투명 시안)
      this.attackFlash.lineStyle(4, 0x22d3ee, 0.3);
      this.attackFlash.lineBetween(bMuzzleX, bMuzzleY, bMuzzleX + beamAim.x * 500, bMuzzleY + beamAim.y * 500);
      // 코어 빔 (밝은 시안)
      this.attackFlash.lineStyle(2, 0x67e8f9, 0.9);
      this.attackFlash.lineBetween(bMuzzleX, bMuzzleY, bMuzzleX + beamAim.x * 500, bMuzzleY + beamAim.y * 500);
      // 중심선 (흰색)
      this.attackFlash.lineStyle(1, 0xffffff, 0.95);
      this.attackFlash.lineBetween(bMuzzleX, bMuzzleY, bMuzzleX + beamAim.x * 500, bMuzzleY + beamAim.y * 500);
      // 렌즈 글로우
      this.attackFlash.fillStyle(0x22d3ee, 0.85);
      this.attackFlash.fillCircle(bMuzzleX, bMuzzleY, 4);
      this.attackFlashUntil = this.time.now + 80;
    }

    // 불씨 뿌리개 연속 화염 파티클 — attackHeld 동안 매 50ms 틱마다 생성
    if (attackHeld && localPlayer?.snapshot.equippedWeaponId === "ember_sprinkler") {
      const flamAim = resolveClampedAimForWeapon(
        "ember_sprinkler",
        aim,
        localPlayer.snapshot.direction,
      );
      const flamPres = resolveWeaponEquipPresentation("ember_sprinkler");
      let flamMuzzleX: number;
      let flamMuzzleY: number;
      if (flamPres.textureKey !== null) {
        const dir = localPlayer.snapshot.direction;
        const xSign = dir === "left" ? -1 : 1;
        const xPull = Math.abs(flamAim.y) * 3;
        const anchorYOffset = flamAim.y * 8;
        const weaponCenterX = xSign * Math.max(0, flamPres.offsetX - xPull);
        const weaponCenterY = flamPres.offsetY + anchorYOffset;
        flamMuzzleX = originX + weaponCenterX + flamPres.muzzleFromCenter * flamAim.x;
        flamMuzzleY = originY + weaponCenterY + flamPres.muzzleFromCenter * flamAim.y;
      } else {
        flamMuzzleX = originX + flamAim.x * 14;
        flamMuzzleY = originY + flamAim.y * 14;
      }
      this.spawnFlameParticles(flamMuzzleX, flamMuzzleY, flamAim.x, flamAim.y);
    }

    // 다람쥐 기관총 연속 총구 섬광 — attackHeld 동안 매 50ms 틱마다 렌더
    if (attackHeld && localPlayer?.snapshot.equippedWeaponId === "squirrel_gatling") {
      const gatAim = resolveClampedAimForWeapon(
        "squirrel_gatling",
        aim,
        localPlayer.snapshot.direction,
      );
      const gatPres = resolveWeaponEquipPresentation("squirrel_gatling");
      const dir = localPlayer.snapshot.direction;
      const xSign = dir === "left" ? -1 : 1;
      const xPull = Math.abs(gatAim.y) * 3;
      const anchorYOffset = gatAim.y * 8;
      const weaponCenterX = xSign * Math.max(0, gatPres.offsetX - xPull);
      const weaponCenterY = gatPres.offsetY + anchorYOffset;
      const gatMuzzleX = originX + weaponCenterX + gatPres.muzzleFromCenter * gatAim.x;
      const gatMuzzleY = originY + weaponCenterY + gatPres.muzzleFromCenter * gatAim.y;
      // 매 틱 랜덤 크기로 기관총 특유의 깜박이는 총구 섬광 표현
      const flashR = 4 + Math.random() * 3;
      this.attackFlash.clear();
      // 외부 글로우 (넓고 반투명 황금색)
      this.attackFlash.fillStyle(0xfbbf24, 0.28);
      this.attackFlash.fillCircle(gatMuzzleX, gatMuzzleY, flashR * 2.5);
      // 중간 글로우
      this.attackFlash.fillStyle(0xfef3c7, 0.65);
      this.attackFlash.fillCircle(gatMuzzleX, gatMuzzleY, flashR * 1.4);
      // 코어 섬광 (밝은 흰색)
      this.attackFlash.fillStyle(0xffffff, 0.95);
      this.attackFlash.fillCircle(gatMuzzleX, gatMuzzleY, flashR * 0.65);
      // tracer 라인 (빠른 총알 궤적)
      this.attackFlash.lineStyle(1.5, 0xfde68a, 0.55);
      this.attackFlash.lineBetween(
        gatMuzzleX,
        gatMuzzleY,
        gatMuzzleX + gatAim.x * 50,
        gatMuzzleY + gatAim.y * 50,
      );
      this.attackFlashUntil = this.time.now + 60;
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
    muzzleX: number,
    muzzleY: number,
    aimX: number,
    aimY: number,
  ) {
    this.attackFlash.clear();
    const fireStyle = resolveWeaponFireStyle(weaponId);

    if (fireStyle === "flame_stream") {
      // 화염 파티클은 sendLatestInput에서 attackHeld 동안 매 틱 생성됨
      return;
    }

    if (fireStyle === "beam_pulse") {
      // 레이저 빔은 sendLatestInput에서 attackHeld 동안 매 틱 렌더됨
      return;
    }

    if (fireStyle === "shotgun_spread") {
      // 5줄기 부채꼴 tracer
      const spreadAngles = [-0.38, -0.19, 0, 0.19, 0.38];
      this.attackFlash.lineStyle(1.5, 0xd4e47c, 0.82);
      for (const angle of spreadAngles) {
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const sx = aimX * cosA - aimY * sinA;
        const sy = aimX * sinA + aimY * cosA;
        this.attackFlash.lineBetween(
          muzzleX,
          muzzleY,
          muzzleX + sx * 28,
          muzzleY + sy * 28,
        );
      }
      this.attackFlash.fillStyle(0xfef9c3, 0.92);
      this.attackFlash.fillCircle(muzzleX, muzzleY, 5);
      this.attackFlashUntil = this.time.now + 80;
      return;
    }

    if (fireStyle === "cannon_blast") {
      // 크고 둥근 총구 화염 + 연기 링
      const cx = muzzleX + aimX * 10;
      const cy = muzzleY + aimY * 10;
      // 연기 링 2개
      this.attackFlash.lineStyle(5, 0x9ca3af, 0.45);
      this.attackFlash.strokeCircle(muzzleX + aimX * 20, muzzleY + aimY * 20, 11);
      this.attackFlash.lineStyle(3, 0xd1d5db, 0.3);
      this.attackFlash.strokeCircle(muzzleX + aimX * 30, muzzleY + aimY * 30, 15);
      // 화염 코어
      this.attackFlash.fillStyle(0xfef08a, 0.95);
      this.attackFlash.fillCircle(cx, cy, 13);
      this.attackFlash.fillStyle(0xfef9c3, 1);
      this.attackFlash.fillCircle(muzzleX + aimX * 5, muzzleY + aimY * 5, 8);
      this.attackFlashUntil = this.time.now + 110;
      return;
    }

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

      const p1x = muzzleX + aimX * nearDist + perpX * nearHW;
      const p1y = muzzleY + aimY * nearDist + perpY * nearHW;
      const p2x = muzzleX + aimX * nearDist - perpX * nearHW;
      const p2y = muzzleY + aimY * nearDist - perpY * nearHW;
      const p3x = muzzleX + aimX * farDist - perpX * farHW;
      const p3y = muzzleY + aimY * farDist - perpY * farHW;
      const p4x = muzzleX + aimX * farDist + perpX * farHW;
      const p4y = muzzleY + aimY * farDist + perpY * farHW;

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

    if (fireStyle === "sniper_flash") {
      // 길고 얇은 흰색 트레이서
      this.attackFlash.lineStyle(2, 0xffffff, 0.88);
      this.attackFlash.lineBetween(
        muzzleX,
        muzzleY,
        muzzleX + aimX * 500,
        muzzleY + aimY * 500,
      );
      // 밝은 muzzle 섬광
      this.attackFlash.fillStyle(0xe8f4ff, 0.95);
      this.attackFlash.fillCircle(muzzleX, muzzleY, 5);
      // 스코프 글린트 (총신 뒤쪽 위에 작은 시안 점)
      this.attackFlash.fillStyle(0x7dd3fc, 0.7);
      this.attackFlash.fillCircle(
        muzzleX - aimX * 16,
        muzzleY - aimY * 16 - 6,
        3,
      );
      this.attackFlashUntil = this.time.now + 80;
      return;
    }

    if (fireStyle === "auto_flash") {
      // sendLatestInput 의 연속 섬광 블록이 이미 처리하므로 여기서는 스킵
      // (첫 클릭 시 sendLatestInput 에서도 동시에 그리기 때문에 중복 방지)
      return;
    }

    if (fireStyle === "mortar_arc") {
      // 박격포 발사 — 크고 둥근 총구 폭발 + 보라/흰 섬광
      this.attackFlash.fillStyle(0xddd6fe, 0.9);
      this.attackFlash.fillCircle(muzzleX, muzzleY, 11);
      this.attackFlash.fillStyle(0xffffff, 0.7);
      this.attackFlash.fillCircle(muzzleX, muzzleY, 6);
      // 연기 링
      this.attackFlash.lineStyle(3, 0x8b5cf6, 0.45);
      this.attackFlash.strokeCircle(muzzleX + aimX * 8, muzzleY + aimY * 8, 8);
      this.attackFlashUntil = this.time.now + 100;
      return;
    }

    if (fireStyle === "slash_arc") {
      // 도토리 대검 — 넓은 부채꼴 호 섬광
      const perpX = -aimY;
      const perpY = aimX;
      const slashDist = 50;
      // 좌우로 퍼지는 세 줄기 섬광
      for (let i = -1; i <= 1; i++) {
        const spread = i * 0.38;
        const ex = muzzleX + (aimX * Math.cos(spread) - aimY * Math.sin(spread)) * slashDist;
        const ey = muzzleY + (aimX * Math.sin(spread) + aimY * Math.cos(spread)) * slashDist;
        const alpha = i === 0 ? 0.85 : 0.5;
        this.attackFlash.lineStyle(i === 0 ? 3 : 1.5, 0xe2e8f0, alpha);
        this.attackFlash.lineBetween(muzzleX, muzzleY, ex, ey);
      }
      // 임팩트 원점 섬광 (갈색/황금)
      this.attackFlash.fillStyle(0xd97706, 0.75);
      this.attackFlash.fillCircle(muzzleX, muzzleY, 6);
      this.attackFlash.fillStyle(0xfef3c7, 0.9);
      this.attackFlash.fillCircle(muzzleX, muzzleY, 3);
      // 파편 선 4개 (방사형)
      this.attackFlash.lineStyle(1.5, 0xd97706, 0.6);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.atan2(aimY, aimX);
        const sx = Math.cos(angle);
        const sy = Math.sin(angle);
        this.attackFlash.lineBetween(
          muzzleX + sx * 4, muzzleY + sy * 4,
          muzzleX + sx * 12 + perpX * (i % 2 === 0 ? 4 : -4),
          muzzleY + sy * 12 + perpY * (i % 2 === 0 ? 4 : -4),
        );
      }
      this.attackFlashUntil = this.time.now + 90;
      return;
    }

    this.attackFlash.lineStyle(3, 0xfef08a, 0.95);
    this.attackFlash.lineBetween(
      muzzleX,
      muzzleY,
      muzzleX + aimX * 46,
      muzzleY + aimY * 46,
    );
    this.attackFlash.fillStyle(0xfef08a, 0.9);
    this.attackFlash.fillCircle(muzzleX + aimX * 20, muzzleY + aimY * 20, 3);
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
    this.updateBurnFlames(this.time.now);

    if (this.attackFlashUntil !== 0 && this.time.now > this.attackFlashUntil) {
      this.attackFlash.clear();
      this.attackFlashUntil = 0;
    }

    this.updateMortarArc();

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
      const { scale: wScale, xOffset: wXOffset } = resolvePickupCollapseTransform(
        rendered.spawnedAt,
        rendered.despawnAt,
        Date.now(),
      );
      rendered.root.x =
        Phaser.Math.Linear(rendered.root.x, rendered.targetX, PICKUP_LERP) + wXOffset;
      rendered.root.y = Phaser.Math.Linear(
        rendered.root.y,
        rendered.targetY,
        PICKUP_LERP,
      );
      rendered.root.setScale(wScale);
      rendered.root.setAlpha(this.resolvePickupBlinkAlpha(rendered.spawnedAt, rendered.despawnAt));
    }

    for (const [, rendered] of this.renderedProjectiles) {
      const elapsedMs = Math.min(
        Math.max(0, this.time.now - rendered.lastSnapshotAt),
        PROJECTILE_PREDICTION_MS,
      );
      const elapsedSec = elapsedMs / 1000;
      const predictedX = rendered.serverX + rendered.velocityX * elapsedSec;
      const predictedY =
        rendered.serverY +
        rendered.velocityY * elapsedSec +
        rendered.gravityPerSec2 * 0.5 * elapsedSec * elapsedSec;
      const predictedVelocityY =
        rendered.velocityY + rendered.gravityPerSec2 * elapsedSec;

      rendered.root.x = Phaser.Math.Linear(rendered.root.x, predictedX, PROJECTILE_LERP);
      rendered.root.y = Phaser.Math.Linear(rendered.root.y, predictedY, PROJECTILE_LERP);
      rendered.root.setRotation(
        Math.atan2(predictedVelocityY, rendered.velocityX),
      );
    }

    for (const [, rendered] of this.renderedItemPickups) {
      const { scale: iScale, xOffset: iXOffset } = resolvePickupCollapseTransform(
        rendered.spawnedAt,
        rendered.despawnAt,
        Date.now(),
      );
      rendered.body.x =
        Phaser.Math.Linear(rendered.body.x, rendered.targetX, PICKUP_LERP) + iXOffset;
      rendered.body.y = Phaser.Math.Linear(rendered.body.y, rendered.targetY, PICKUP_LERP);
      rendered.body.setScale(iScale);
      const alpha = this.resolvePickupBlinkAlpha(rendered.spawnedAt, rendered.despawnAt);
      rendered.body.setAlpha(alpha);
      rendered.label.setScale(iScale);
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
    const remaining = despawnAt - Date.now();
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
