import type { EntityId, TimestampMs, Vector2 } from "./common";
import type {
  DamageAppliedEvent,
  KillFeedEntry,
  MatchSnapshot,
  PlayerSnapshot,
} from "./world";
import type { WorldItemPickup } from "./items";
import type { WorldWeaponPickup } from "./weapons";

export interface ProtocolEnvelope<TType extends string, TPayload> {
  type: TType;
  timestamp: TimestampMs;
  payload: TPayload;
}

export interface JoinRoomPayload {
  roomId: EntityId;
  playerName: string;
}

export interface PlayerInputPayload {
  sequence: number;
  move: Vector2;
  aim: Vector2;
  jump: boolean;
  attack: boolean;
  attackPressed: boolean;
  pickupWeaponPressed: boolean;
  dropWeapon: boolean;
  dropWeaponPressed: boolean;
}

export interface PingPayload {
  nonce: string;
}

export interface WelcomePayload {
  connectionId: EntityId;
  serverVersion: string;
}

export interface RoomSnapshotPayload {
  roomId: EntityId;
  selfPlayerId?: EntityId;
  players: PlayerSnapshot[];
  weaponPickups: WorldWeaponPickup[];
  itemPickups: WorldItemPickup[];
  matchState: "waiting" | "running" | "finished";
  killFeed: KillFeedEntry[];
  damageEvents: DamageAppliedEvent[];
}

export interface WorldSnapshotPayload extends MatchSnapshot {}

export interface PlayerJoinedPayload {
  playerId: EntityId;
  name: string;
}

export interface PlayerLeftPayload {
  playerId: EntityId;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export type JoinRoomMessage = ProtocolEnvelope<"join_room", JoinRoomPayload>;
export type PlayerInputMessage = ProtocolEnvelope<
  "player_input",
  PlayerInputPayload
>;
export type PingMessage = ProtocolEnvelope<"ping", PingPayload>;

export type WelcomeMessage = ProtocolEnvelope<"welcome", WelcomePayload>;
export type RoomSnapshotMessage = ProtocolEnvelope<
  "room_snapshot",
  RoomSnapshotPayload
>;
export type WorldSnapshotMessage = ProtocolEnvelope<
  "world_snapshot",
  WorldSnapshotPayload
>;
export type PlayerJoinedMessage = ProtocolEnvelope<
  "player_joined",
  PlayerJoinedPayload
>;
export type PlayerLeftMessage = ProtocolEnvelope<
  "player_left",
  PlayerLeftPayload
>;
export type PongMessage = ProtocolEnvelope<"pong", PingPayload>;
export type ErrorMessage = ProtocolEnvelope<"error", ErrorPayload>;

export type ClientToServerMessage =
  | JoinRoomMessage
  | PlayerInputMessage
  | PingMessage;

export type ServerToClientMessage =
  | WelcomeMessage
  | RoomSnapshotMessage
  | WorldSnapshotMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PongMessage
  | ErrorMessage;
