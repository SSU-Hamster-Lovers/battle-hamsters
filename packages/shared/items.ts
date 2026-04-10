import type { EntityId, SpawnStyle, TimedWorldEntity, Vector2 } from './common'

export type ItemType =
  | 'speed_rank_up'
  | 'extra_life'
  | 'health_recover'
  | 'jump_boost'

export interface JumpBoostEffect {
  jumpCountDelta: number
}

export interface SpeedRankUpEffect {
  speedRankDelta: number
}

export interface ExtraLifeEffect {
  extraLives: number
}

export interface HealthRecoverEffect {
  healAmount: number
}

export type ItemEffect =
  | JumpBoostEffect
  | SpeedRankUpEffect
  | ExtraLifeEffect
  | HealthRecoverEffect

export interface ItemDefinition {
  version: number
  id: EntityId
  name: string
  itemType: ItemType
  maxStack: number
  effect: ItemEffect
}

export interface ItemSpawnPoint {
  id: EntityId
  itemId: EntityId
  x: number
  y: number
  respawnMs: number
  spawnStyle: SpawnStyle
}

export interface WorldItemPickup extends TimedWorldEntity {
  id: EntityId
  itemId: EntityId
  position: Vector2
  source: 'spawn' | 'reward'
  spawnStyle: SpawnStyle
}
