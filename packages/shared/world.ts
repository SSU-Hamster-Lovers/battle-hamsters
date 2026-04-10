import type {
  Direction,
  EntityId,
  MatchState,
  PlayerState,
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
  state: PlayerState;
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
  friendlyFire: boolean;
}

export interface MatchSnapshot {
  version: number;
  roomId: EntityId;
  matchState: MatchState;
  serverTick: number;
  players: PlayerSnapshot[];
  projectiles: unknown[];
  weaponPickups: WorldWeaponPickup[];
  itemPickups: WorldItemPickup[];
  timeRemainingMs: number;
}
