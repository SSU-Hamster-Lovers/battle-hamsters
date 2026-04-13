import type {
  Direction,
  EntityId,
  MatchState,
  PlayerState,
  TimestampMs,
  Vector2,
} from "./common";
import type { ItemSpawnPoint, WorldItemPickup } from "./items";
import type { WeaponSpawnPoint, WorldWeaponPickup } from "./weapons";

export interface SpawnPoint {
  id: EntityId;
  x: number;
  y: number;
}

export interface RectArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundsRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type BoundaryPolicy = "closed" | "open";
export type CameraPolicy = "static" | "follow" | "dynamic";

export interface FloorCollisionPrimitive {
  id: EntityId;
  type: "floor";
  leftX: number;
  rightX: number;
  topY: number;
}

export interface OneWayPlatformCollisionPrimitive {
  id: EntityId;
  type: "one_way_platform";
  leftX: number;
  rightX: number;
  topY: number;
}

export interface SolidWallCollisionPrimitive {
  id: EntityId;
  type: "solid_wall";
  x: number;
  topY: number;
  bottomY: number;
}

export type CollisionPrimitive =
  | FloorCollisionPrimitive
  | OneWayPlatformCollisionPrimitive
  | SolidWallCollisionPrimitive;

export interface FallZoneHazard extends RectArea {
  id: EntityId;
  type: "fall_zone";
}

export interface InstantKillHazard extends RectArea {
  id: EntityId;
  type: "instant_kill_hazard";
}

export type HazardZone = FallZoneHazard | InstantKillHazard;

export interface MapDefinition {
  version: number;
  id: EntityId;
  name: string;
  size: {
    width: number;
    height: number;
  };
  boundaryPolicy: BoundaryPolicy;
  cameraPolicy: CameraPolicy;
  visualBounds: BoundsRect;
  gameplayBounds: BoundsRect;
  deathBounds: BoundsRect;
  spawnPoints: SpawnPoint[];
  terrain: unknown[];
  collision: CollisionPrimitive[];
  hazards: HazardZone[];
  weaponSpawns: WeaponSpawnPoint[];
  itemSpawns: ItemSpawnPoint[];
  decorations: unknown[];
}

export interface GrabState {
  targetPlayerId: EntityId;
  remainingMs: number;
}

export interface StatusEffectInstance {
  kind: "burn";
  killerId: EntityId | null;
  weaponId: EntityId;
  expiresAt: TimestampMs;
}

export interface ProjectileSnapshot {
  id: EntityId;
  ownerId: EntityId;
  weaponId: EntityId;
  position: Vector2;
  velocity: Vector2;
}

export interface PlayerSnapshot {
  id: EntityId;
  name: string;
  position: Vector2;
  velocity: Vector2;
  direction: Direction;
  hp: number;
  lives: number;
  moveSpeedRank: number;
  maxJumpCount: 1 | 2 | 3;
  jumpCountUsed: number;
  grounded: boolean;
  dropThroughUntil: number | null;
  respawnAt: number | null;
  equippedWeaponId: EntityId;
  equippedWeaponResource: number | null;
  grabState: GrabState | null;
  lastDeathCause: DeathCause | null;
  state: PlayerState;
  kills: number;
  deaths: number;
  effects: StatusEffectInstance[];
}

export interface RoomConfig {
  version: number;
  roomId: EntityId;
  mode: "deathmatch";
  teamMode: boolean;
  maxPlayers: number;
  mapId: EntityId;
  timeLimitSec: number;
  stockLives: number;
  startHp: number;
  baseJumpCount: 1 | 2 | 3;
  maxJumpCountLimit: 1 | 2 | 3;
  friendlyFire: boolean;
}

export interface MatchSnapshot {
  version: number;
  roomId: EntityId;
  matchState: MatchState;
  serverTick: number;
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
  weaponPickups: WorldWeaponPickup[];
  itemPickups: WorldItemPickup[];
  timeRemainingMs: number;
  countdownMs: number | null;
  killFeed: KillFeedEntry[];
  damageEvents: DamageAppliedEvent[];
}

/**
 * 사망 원인. killer/weapon 정보는 이 `cause` 내부에 포함된다.
 * - `fall_zone`: 낙사 구역에 떨어져 사망
 * - `instant_kill_hazard`: 즉사 함정 진입으로 사망
 * - `weapon`: 다른 플레이어의 무기에 의해 사망
 * - `self`: 자기 반동/자폭 등 스스로의 피해로 사망
 */
export type DeathCause =
  | { kind: "fall_zone" }
  | { kind: "instant_kill_hazard" }
  | { kind: "weapon"; killerId: EntityId; weaponId: EntityId }
  | { kind: "self"; weaponId: EntityId };

export interface KillFeedEntry {
  id: EntityId;
  occurredAt: TimestampMs;
  victimId: EntityId;
  cause: DeathCause;
}

export interface DamageAppliedEvent {
  id: EntityId;
  occurredAt: TimestampMs;
  victimId: EntityId;
  attackerId: EntityId;
  weaponId: EntityId;
  damage: number;
  impactDirection: Vector2;
  impactPoint: Vector2;
}
