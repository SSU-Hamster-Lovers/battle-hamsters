export type EntityId = string
export type TimestampMs = number

export interface Vector2 {
  x: number
  y: number
}

export type Direction = 'left' | 'right'

export type MatchState = 'waiting' | 'running' | 'finished'

export type PlayerState = 'alive' | 'respawning' | 'eliminated'

export type SpawnStyle = 'airdrop' | 'fade_in' | 'triggered'
export type DespawnStyle = 'shrink_pop'

export interface TimedWorldEntity {
  spawnedAt: TimestampMs
  despawnAt?: TimestampMs
}
