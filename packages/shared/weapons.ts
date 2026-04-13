import type {
  DespawnStyle,
  EntityId,
  SpawnStyle,
  TimedWorldEntity,
  Vector2,
} from "./common";

export type HitType = "melee" | "hitscan" | "projectile" | "beam";
export type FireMode = "single" | "burst" | "auto" | "channel";
export type ResourceModel = "infinite" | "magazine" | "capacity";
export type WeaponRarity = "common" | "uncommon" | "rare";

export type WeaponSpecialEffect =
  | { kind: "none" }
  | { kind: "explode"; fuseMs?: number; radius?: number }
  | { kind: "grab"; grabDurationMs: number }
  | { kind: "heal_block"; durationMs: number }
  | { kind: "burn"; durationMs: number; tickDamage: number; tickIntervalMs: number };

/**
 * 무기별 허용 조준 각도 범위.
 * 0deg = 캐릭터 정면 수평, 음수 = 위쪽, 양수 = 아래쪽.
 * 없으면 무제한 회전 허용.
 */
export interface WeaponAimProfile {
  minAimDeg: number;
  maxAimDeg: number;
}

export interface WeaponDefinition {
  version: number;
  id: EntityId;
  name: string;
  hitType: HitType;
  fireMode: FireMode;
  resourceModel: ResourceModel;
  damage: number;
  knockback: number;
  selfRecoilForce: number;
  selfRecoilAngleDeg: number;
  selfRecoilAngleJitterDeg: number;
  selfRecoilGroundMultiplier: number;
  selfRecoilAirMultiplier: number;
  attackIntervalMs: number;
  range: number;
  projectileSpeed: number;
  spreadDeg: number;
  pelletCount: number;
  maxResource: number;
  resourcePerShot: number;
  resourcePerSecond: number;
  discardOnEmpty: boolean;
  pickupWeight: number;
  rarity: WeaponRarity;
  worldDespawnMs: number;
  specialEffect: WeaponSpecialEffect | null;
  aimProfile?: WeaponAimProfile;
}

export interface WeaponSpawnPoint {
  id: EntityId;
  weaponId: EntityId;
  x: number;
  y: number;
  respawnMs: number;
  despawnAfterMs: number;
  spawnStyle: SpawnStyle;
  despawnStyle: DespawnStyle;
  mode: "fixed" | "random_candidates";
  spawnGroupId?: EntityId;
}

export interface WorldWeaponPickup extends TimedWorldEntity {
  id: EntityId;
  weaponId: EntityId;
  position: Vector2;
  source: "spawn" | "dropped" | "reward";
  resourceRemaining: number;
  spawnStyle: SpawnStyle;
  despawnStyle: DespawnStyle;
}
