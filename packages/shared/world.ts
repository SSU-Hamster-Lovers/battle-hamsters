import type { Direction, EntityId, MatchState, PlayerState, Vector2 } from './common'
import type { ItemSpawnPoint, WorldItemPickup } from './items'
import type { WeaponSpawnPoint, WorldWeaponPickup } from './weapons'

export interface MapDefinition {
  version: number
  id: EntityId
  name: string
  size: {
    width: number
    height: number
  }
  spawnPoints: Array<{
    id: EntityId
    x: number
    y: number
  }>
  terrain: unknown[]
  collision: unknown[]
  hazards: unknown[]
  weaponSpawns: WeaponSpawnPoint[]
  itemSpawns: ItemSpawnPoint[]
  decorations: unknown[]
}

export interface GrabState {
  targetPlayerId: EntityId
  remainingMs: number
}

export interface PlayerSnapshot {
  id: EntityId
  name: string
  position: Vector2
  velocity: Vector2
  direction: Direction
  hp: number
  lives: number
  moveSpeedRank: number
  maxJumpCount: 1 | 2 | 3
  equippedWeaponId: EntityId
  equippedWeaponResource: number | null
  grabState: GrabState | null
  state: PlayerState
}

export interface RoomConfig {
  version: number
  roomId: EntityId
  mode: 'deathmatch'
  teamMode: boolean
  maxPlayers: number
  mapId: EntityId
  timeLimitSec: number
  stockLives: number
  friendlyFire: boolean
}

export interface MatchSnapshot {
  version: number
  roomId: EntityId
  matchState: MatchState
  serverTick: number
  players: PlayerSnapshot[]
  projectiles: unknown[]
  weaponPickups: WorldWeaponPickup[]
  itemPickups: WorldItemPickup[]
  timeRemainingMs: number
}
