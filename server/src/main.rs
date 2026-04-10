use actix::Recipient;
use actix_web::{web, App, HttpResponse, HttpServer, Responder};
mod game_data;
mod room_combat;
mod room_pickups;
mod room_runtime;
mod ws_runtime;
use game_data::{
    ground_top_y, pit_left_x, pit_right_x, primary_fall_zone, room_id, runtime_map_data,
    weapon_definition, world_height, HazardKind,
};
use room_combat::{respawn_player, trigger_respawn};
use room_runtime::{intersecting_hazard, spawn_position, step_player, surface_contains_x};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use ws_runtime::{start_room_loop, ws_handler, AppState, WsText};

const SERVER_VERSION: &str = "0.1.0";
const ROOM_ID: &str = "room_alpha";
const DEFAULT_TIME_LIMIT_MS: u64 = 300_000;
const TICK_RATE: u64 = 20;
const TICK_INTERVAL_MS: u64 = 1000 / TICK_RATE;
const HEARTBEAT_INTERVAL_SECS: u64 = 5;
const CLIENT_TIMEOUT_SECS: u64 = 10;

const PLAYER_HALF_SIZE: f64 = 14.0;
const RUN_SPEED_PER_TICK: f64 = 8.0;
const GRAVITY_PER_TICK: f64 = 1.4;
const FAST_FALL_GRAVITY_PER_TICK: f64 = 2.4;
const JUMP_VELOCITY: f64 = -18.0;
const MAX_FALL_SPEED: f64 = 20.0;
const MAX_FAST_FALL_SPEED: f64 = 28.0;
const DROP_THROUGH_MS: u64 = 220;
const RESPAWN_DELAY_MS: u64 = 3_000;
const TEST_LIVES: u8 = 99;
const BASE_MAX_JUMP_COUNT: u8 = 1;
const PICKUP_HALF_HEIGHT: f64 = 7.0;
const PICKUP_GRAVITY_PER_TICK: f64 = 1.0;
const PICKUP_MAX_FALL_SPEED: f64 = 18.0;
const ITEM_PICKUP_RADIUS: f64 = 30.0;
const MAX_HP: u16 = 100;

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

async fn health() -> impl Responder {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok".to_string(),
        version: SERVER_VERSION.to_string(),
    })
}

#[derive(Deserialize)]
struct UserQuery {
    username: Option<String>,
}

async fn hello(query: web::Query<UserQuery>) -> impl Responder {
    let name = query.username.as_deref().unwrap_or("World");
    HttpResponse::Ok().json(serde_json::json!({
        "message": format!("Hello, {}!", name)
    }))
}

#[derive(Clone)]
struct PickupKinematics {
    velocity_y: f64,
    grounded: bool,
}

#[derive(Clone)]
struct PlayerRuntime {
    snapshot: PlayerSnapshot,
    latest_input: PlayerInputPayload,
    spawn_index: usize,
    external_velocity: Vector2,
    next_attack_at: u64,
    attack_queued: bool,
    attack_was_down: bool,
}

struct RoomState {
    room_id: String,
    server_tick: u64,
    time_remaining_ms: u64,
    players: HashMap<String, PlayerRuntime>,
    weapon_pickups: HashMap<String, WorldWeaponPickup>,
    item_pickups: HashMap<String, WorldItemPickup>,
    next_weapon_pickup_id: u64,
    next_item_pickup_id: u64,
    next_spawn_respawn_at: HashMap<String, u64>,
    next_item_spawn_respawn_at: HashMap<String, u64>,
    sessions: HashMap<String, Recipient<WsText>>,
}

impl RoomState {
    fn new() -> Self {
        let now = now_ms();
        let mut room = Self {
            room_id: room_id().to_string(),
            server_tick: 0,
            time_remaining_ms: DEFAULT_TIME_LIMIT_MS,
            players: HashMap::new(),
            weapon_pickups: HashMap::new(),
            item_pickups: HashMap::new(),
            next_weapon_pickup_id: 1,
            next_item_pickup_id: 1,
            next_spawn_respawn_at: HashMap::new(),
            next_item_spawn_respawn_at: HashMap::new(),
            sessions: HashMap::new(),
        };
        room.spawn_initial_weapons(now);
        room.spawn_initial_items(now);
        room
    }

    fn player_snapshots(&self) -> Vec<PlayerSnapshot> {
        self.players
            .values()
            .map(|player| player.snapshot.clone())
            .collect()
    }

    fn add_player(
        &mut self,
        player_id: String,
        player_name: String,
        recipient: Recipient<WsText>,
    ) -> RoomSnapshotPayload {
        let spawn_index = self.players.len();
        let spawn = spawn_position(spawn_index);
        let player = PlayerSnapshot {
            id: player_id.clone(),
            name: player_name,
            position: spawn,
            velocity: Vector2 { x: 0.0, y: 0.0 },
            direction: Direction::Right,
            hp: 100,
            lives: TEST_LIVES,
            move_speed_rank: 0,
            max_jump_count: BASE_MAX_JUMP_COUNT,
            jump_count_used: 0,
            grounded: false,
            drop_through_until: None,
            respawn_at: None,
            equipped_weapon_id: "paws".to_string(),
            equipped_weapon_resource: None,
            grab_state: None,
            state: PlayerState::Alive,
        };

        self.sessions.insert(player_id.clone(), recipient);
        self.players.insert(
            player_id.clone(),
            PlayerRuntime {
                snapshot: player,
                latest_input: PlayerInputPayload::default(),
                spawn_index,
                external_velocity: Vector2 { x: 0.0, y: 0.0 },
                next_attack_at: 0,
                attack_queued: false,
                attack_was_down: false,
            },
        );

        RoomSnapshotPayload {
            room_id: self.room_id.clone(),
            self_player_id: Some(player_id),
            players: self.player_snapshots(),
            weapon_pickups: self.weapon_pickup_snapshots(),
            item_pickups: self.item_pickup_snapshots(),
            match_state: MatchState::Waiting,
        }
    }

    fn remove_player(&mut self, player_id: &str) -> bool {
        self.sessions.remove(player_id);
        self.players.remove(player_id).is_some()
    }

    fn apply_input(&mut self, player_id: &str, input: PlayerInputPayload) {
        if let Some(player) = self.players.get_mut(player_id) {
            if input.attack_pressed {
                player.attack_queued = true;
            }
            player.attack_was_down = input.attack;
            player.latest_input = input;
        }
    }
}

#[derive(Deserialize)]
struct IncomingEnvelope {
    #[serde(rename = "type")]
    kind: String,
    payload: Value,
}

#[derive(Serialize)]
struct OutgoingEnvelope<T> {
    #[serde(rename = "type")]
    kind: &'static str,
    timestamp: u64,
    payload: T,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JoinRoomPayload {
    room_id: String,
    player_name: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PlayerInputPayload {
    sequence: u64,
    #[serde(rename = "move")]
    movement: Vector2,
    aim: Vector2,
    jump: bool,
    attack: bool,
    attack_pressed: bool,
    pickup_weapon_pressed: bool,
    drop_weapon: bool,
    drop_weapon_pressed: bool,
}

impl PlayerInputPayload {
    fn move_ref(&self) -> &Vector2 {
        &self.movement
    }
}

#[derive(Deserialize, Serialize)]
struct PingPayload {
    nonce: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WelcomePayload {
    connection_id: String,
    server_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomSnapshotPayload {
    room_id: String,
    self_player_id: Option<String>,
    players: Vec<PlayerSnapshot>,
    weapon_pickups: Vec<WorldWeaponPickup>,
    item_pickups: Vec<WorldItemPickup>,
    match_state: MatchState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldSnapshotPayload {
    version: u8,
    room_id: String,
    match_state: MatchState,
    server_tick: u64,
    players: Vec<PlayerSnapshot>,
    projectiles: Vec<Value>,
    weapon_pickups: Vec<WorldWeaponPickup>,
    item_pickups: Vec<WorldItemPickup>,
    time_remaining_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerJoinedPayload {
    player_id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerLeftPayload {
    player_id: String,
}

#[derive(Serialize)]
struct ErrorPayload {
    code: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorldWeaponPickup {
    id: String,
    weapon_id: String,
    position: Vector2,
    source: PickupSource,
    resource_remaining: u32,
    spawn_style: SpawnStyle,
    despawn_style: DespawnStyle,
    spawned_at: u64,
    despawn_at: Option<u64>,
    #[serde(skip_serializing)]
    spawn_id: Option<String>,
    #[serde(skip_serializing)]
    respawn_ms: Option<u64>,
    #[serde(skip_serializing)]
    kinematics: PickupKinematics,
    #[serde(skip_serializing)]
    pickup_blocked_until: Option<u64>,
    #[serde(skip_serializing)]
    pickup_blocked_player_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorldItemPickup {
    id: String,
    item_id: String,
    position: Vector2,
    source: ItemSource,
    spawned_at: u64,
    despawn_at: Option<u64>,
    #[serde(skip_serializing)]
    spawn_id: Option<String>,
    #[serde(skip_serializing)]
    respawn_ms: Option<u64>,
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    spawn_style: SpawnStyle,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlayerSnapshot {
    id: String,
    name: String,
    position: Vector2,
    velocity: Vector2,
    direction: Direction,
    hp: u16,
    lives: u8,
    move_speed_rank: i8,
    max_jump_count: u8,
    jump_count_used: u8,
    grounded: bool,
    drop_through_until: Option<u64>,
    respawn_at: Option<u64>,
    equipped_weapon_id: String,
    equipped_weapon_resource: Option<u32>,
    grab_state: Option<GrabState>,
    state: PlayerState,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GrabState {
    target_player_id: String,
    remaining_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MatchState {
    Waiting,
    Running,
    Finished,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Left,
    Right,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PlayerState {
    Alive,
    Respawning,
    Eliminated,
}

#[allow(dead_code)]
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum PickupSource {
    Spawn,
    Dropped,
    Reward,
}

#[allow(dead_code)]
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum ItemSource {
    Spawn,
    Reward,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum SpawnStyle {
    Airdrop,
    FadeIn,
    Triggered,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum DespawnStyle {
    ShrinkPop,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum HitType {
    Melee,
    Hitscan,
    Projectile,
    Beam,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum FireMode {
    Single,
    Burst,
    Auto,
    Channel,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum ResourceModel {
    Infinite,
    Magazine,
    Capacity,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum WeaponRarity {
    Common,
    Uncommon,
    Rare,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Vector2 {
    x: f64,
    y: f64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_millis() as u64
}

fn serialize_message<T: Serialize>(
    kind: &'static str,
    payload: T,
) -> Result<String, serde_json::Error> {
    serde_json::to_string(&OutgoingEnvelope {
        kind,
        timestamp: now_ms(),
        payload,
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let api_port: u16 = std::env::var("API_PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse()
        .expect("API_PORT must be a number");

    let app_state = web::Data::new(AppState::new());
    start_room_loop(app_state.clone());

    log::info!("Starting Battle Hamsters Server on port {}", api_port);

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .route("/health", web::get().to(health))
            .route("/hello", web::get().to(hello))
            .route("/ws", web::get().to(ws_handler))
    })
    .bind(("0.0.0.0", api_port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as actix_test, App};

    fn test_player(x: f64, y: f64) -> PlayerRuntime {
        PlayerRuntime {
            snapshot: PlayerSnapshot {
                id: "player_test".to_string(),
                name: "hammy".to_string(),
                position: Vector2 { x, y },
                velocity: Vector2 { x: 0.0, y: 0.0 },
                direction: Direction::Right,
                hp: 100,
                lives: TEST_LIVES,
                move_speed_rank: 0,
                max_jump_count: BASE_MAX_JUMP_COUNT,
                jump_count_used: 0,
                grounded: false,
                drop_through_until: None,
                respawn_at: None,
                equipped_weapon_id: "paws".to_string(),
                equipped_weapon_resource: None,
                grab_state: None,
                state: PlayerState::Alive,
            },
            latest_input: PlayerInputPayload::default(),
            spawn_index: 0,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: false,
            attack_was_down: false,
        }
    }

    #[actix_rt::test]
    async fn test_health() {
        let app =
            actix_test::init_service(App::new().route("/health", web::get().to(health))).await;
        let req = actix_test::TestRequest::get().uri("/health").to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[test]
    fn player_lands_on_floor_outside_pit() {
        let mut player = test_player(180.0, ground_top_y() - PLAYER_HALF_SIZE - 2.0);
        player.snapshot.velocity.y = 8.0;

        step_player(&mut player, 0);

        assert!(player.snapshot.grounded);
        assert_eq!(
            player.snapshot.position.y,
            ground_top_y() - PLAYER_HALF_SIZE
        );
        assert_eq!(player.snapshot.velocity.y, 0.0);
    }

    #[test]
    fn player_does_not_land_inside_fall_zone_gap() {
        let mut player = test_player(
            (pit_left_x() + pit_right_x()) / 2.0,
            ground_top_y() - PLAYER_HALF_SIZE - 2.0,
        );
        player.snapshot.velocity.y = 8.0;

        step_player(&mut player, 0);

        assert!(!player.snapshot.grounded);
        assert!(player.snapshot.position.y > ground_top_y() - PLAYER_HALF_SIZE);
        assert_eq!(intersecting_hazard(&player.snapshot), None);

        for _ in 0..24 {
            step_player(&mut player, 0);
            if intersecting_hazard(&player.snapshot) == Some(HazardKind::FallZone) {
                break;
            }
        }

        assert_eq!(
            intersecting_hazard(&player.snapshot),
            Some(HazardKind::FallZone)
        );
    }

    #[test]
    fn player_collides_with_pit_wall_from_inside() {
        let mut player = test_player(pit_left_x() + PLAYER_HALF_SIZE + 2.0, ground_top_y() + 20.0);
        player.latest_input.movement = Vector2 { x: -1.0, y: 0.0 };

        step_player(&mut player, 0);

        assert_eq!(player.snapshot.position.x, pit_left_x() + PLAYER_HALF_SIZE);
        assert_eq!(player.snapshot.velocity.x, 0.0);
    }

    #[test]
    fn player_still_collides_with_extended_pit_wall_below_screen() {
        let mut player = test_player(pit_left_x() + PLAYER_HALF_SIZE + 2.0, world_height() + 40.0);
        player.latest_input.movement = Vector2 { x: -1.0, y: 0.0 };

        step_player(&mut player, 0);

        assert_eq!(player.snapshot.position.x, pit_left_x() + PLAYER_HALF_SIZE);
        assert_eq!(player.snapshot.velocity.x, 0.0);
    }

    #[test]
    fn instant_kill_hazard_is_separate_from_fall_zone() {
        let player_on_spikes = test_player(660.0, ground_top_y() - PLAYER_HALF_SIZE);
        let player_in_pit = test_player(
            (pit_left_x() + pit_right_x()) / 2.0,
            primary_fall_zone().y + PLAYER_HALF_SIZE + 1.0,
        );

        assert_eq!(
            intersecting_hazard(&player_on_spikes.snapshot),
            Some(HazardKind::InstantKillHazard)
        );
        assert_eq!(
            intersecting_hazard(&player_in_pit.snapshot),
            Some(HazardKind::FallZone)
        );
    }

    #[test]
    fn room_starts_with_spawned_weapon_pickup() {
        let room = RoomState::new();
        assert_eq!(room.weapon_pickups.len(), 1);
        let pickup = room
            .weapon_pickups
            .values()
            .next()
            .expect("spawn pickup should exist");
        assert_eq!(pickup.weapon_id, "acorn_blaster");
        assert_eq!(pickup.resource_remaining, 8);
    }

    #[test]
    fn room_starts_with_spawned_item_pickups() {
        let room = RoomState::new();
        assert_eq!(room.item_pickups.len(), 2);
        let item_ids = room
            .item_pickups
            .values()
            .map(|pickup| pickup.item_id.as_str())
            .collect::<Vec<_>>();

        assert!(item_ids.contains(&"jump_boost_small"));
        assert!(item_ids.contains(&"health_pack_small"));
    }

    #[test]
    fn item_pickup_applies_jump_boost_and_respawns() {
        let mut room = RoomState::new();
        let jump_spawn = runtime_map_data()
            .item_spawns
            .iter()
            .find(|spawn| spawn.item_id == "jump_boost_small")
            .expect("jump spawn should exist")
            .clone();

        let mut player = test_player(jump_spawn.position.x, jump_spawn.position.y);
        player.snapshot.max_jump_count = BASE_MAX_JUMP_COUNT;
        room.players.insert("player".to_string(), player);

        room.handle_item_pickup("player", 1000);

        let player_after = room.players.get("player").expect("player should exist");
        assert_eq!(player_after.snapshot.max_jump_count, 2);
        assert!(room
            .item_pickups
            .values()
            .all(|pickup| pickup.item_id != "jump_boost_small"));
        assert_eq!(
            room.next_item_spawn_respawn_at.get(&jump_spawn.id),
            Some(&(1000 + jump_spawn.respawn_ms))
        );

        room.refresh_item_spawns(1000 + jump_spawn.respawn_ms);

        assert!(room
            .item_pickups
            .values()
            .any(|pickup| pickup.item_id == "jump_boost_small"));
    }

    #[test]
    fn item_pickup_heals_and_clamps_hp() {
        let mut room = RoomState::new();
        let health_spawn = runtime_map_data()
            .item_spawns
            .iter()
            .find(|spawn| spawn.item_id == "health_pack_small")
            .expect("health spawn should exist")
            .clone();

        let mut player = test_player(health_spawn.position.x, health_spawn.position.y);
        player.snapshot.hp = 80;
        room.players.insert("player".to_string(), player);

        room.handle_item_pickup("player", 1000);

        let player_after = room.players.get("player").expect("player should exist");
        assert_eq!(player_after.snapshot.hp, MAX_HP);
    }

    #[test]
    fn hitscan_attack_consumes_weapon_and_applies_recoil() {
        let mut room = RoomState::new();

        let shooter = PlayerRuntime {
            snapshot: PlayerSnapshot {
                id: "shooter".to_string(),
                name: "shooter".to_string(),
                position: Vector2 { x: 140.0, y: 120.0 },
                velocity: Vector2 { x: 0.0, y: 0.0 },
                direction: Direction::Right,
                hp: 100,
                lives: TEST_LIVES,
                move_speed_rank: 0,
                max_jump_count: BASE_MAX_JUMP_COUNT,
                jump_count_used: 0,
                grounded: true,
                drop_through_until: None,
                respawn_at: None,
                equipped_weapon_id: "acorn_blaster".to_string(),
                equipped_weapon_resource: Some(1),
                grab_state: None,
                state: PlayerState::Alive,
            },
            latest_input: PlayerInputPayload {
                sequence: 1,
                movement: Vector2 { x: 0.0, y: 0.0 },
                aim: Vector2 { x: 1.0, y: 0.0 },
                jump: false,
                attack: true,
                attack_pressed: true,
                pickup_weapon_pressed: false,
                drop_weapon: false,
                drop_weapon_pressed: false,
            },
            spawn_index: 0,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: true,
            attack_was_down: true,
        };

        let target = PlayerRuntime {
            snapshot: PlayerSnapshot {
                id: "target".to_string(),
                name: "target".to_string(),
                position: Vector2 { x: 240.0, y: 120.0 },
                velocity: Vector2 { x: 0.0, y: 0.0 },
                direction: Direction::Left,
                hp: 100,
                lives: TEST_LIVES,
                move_speed_rank: 0,
                max_jump_count: BASE_MAX_JUMP_COUNT,
                jump_count_used: 0,
                grounded: true,
                drop_through_until: None,
                respawn_at: None,
                equipped_weapon_id: "paws".to_string(),
                equipped_weapon_resource: None,
                grab_state: None,
                state: PlayerState::Alive,
            },
            latest_input: PlayerInputPayload::default(),
            spawn_index: 1,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: false,
            attack_was_down: false,
        };

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths);

        let shooter_after = room.players.get("shooter").expect("shooter should exist");
        let target_after = room.players.get("target").expect("target should exist");

        assert_eq!(shooter_after.snapshot.equipped_weapon_id, "paws");
        assert_eq!(shooter_after.snapshot.equipped_weapon_resource, None);
        assert!(shooter_after.external_velocity.x < 0.0);
        assert!(target_after.external_velocity.x > 0.0);
        assert_eq!(target_after.snapshot.hp, 88);
        assert!(deaths.is_empty());
    }

    #[test]
    fn queued_attack_is_cleared_when_player_only_has_paws() {
        let mut room = RoomState::new();
        let mut player = test_player(140.0, 120.0);
        player.attack_queued = true;
        room.players.insert("player".to_string(), player);

        let mut deaths = Vec::new();
        room.handle_weapon_attack("player", 1000, &mut deaths);

        let player_after = room.players.get("player").expect("player should exist");
        assert!(!player_after.attack_queued);
    }

    #[test]
    fn death_resets_general_combat_state() {
        let mut player = test_player(140.0, 120.0);
        player.snapshot.move_speed_rank = 3;
        player.snapshot.max_jump_count = 3;
        player.snapshot.jump_count_used = 2;
        player.snapshot.equipped_weapon_id = "acorn_blaster".to_string();
        player.snapshot.equipped_weapon_resource = Some(3);
        player.attack_queued = true;
        player.attack_was_down = true;
        player.next_attack_at = 1234;

        trigger_respawn(&mut player, 1000, ground_top_y());

        assert_eq!(player.snapshot.move_speed_rank, 0);
        assert_eq!(player.snapshot.max_jump_count, BASE_MAX_JUMP_COUNT);
        assert_eq!(player.snapshot.jump_count_used, 0);
        assert_eq!(player.snapshot.equipped_weapon_id, "paws");
        assert_eq!(player.snapshot.equipped_weapon_resource, None);
        assert!(!player.attack_queued);
        assert!(!player.attack_was_down);
        assert_eq!(player.next_attack_at, 0);
    }

    #[test]
    fn respawn_keeps_general_state_reset() {
        let mut player = test_player(140.0, 120.0);
        player.snapshot.move_speed_rank = 2;
        player.snapshot.max_jump_count = 3;
        player.snapshot.jump_count_used = 1;
        player.snapshot.equipped_weapon_id = "acorn_blaster".to_string();
        player.snapshot.equipped_weapon_resource = Some(2);

        let respawn_position = spawn_position(player.spawn_index);
        trigger_respawn(&mut player, 1000, ground_top_y());
        respawn_player(&mut player, respawn_position);

        assert_eq!(player.snapshot.state, PlayerState::Alive);
        assert_eq!(player.snapshot.move_speed_rank, 0);
        assert_eq!(player.snapshot.max_jump_count, BASE_MAX_JUMP_COUNT);
        assert_eq!(player.snapshot.jump_count_used, 0);
        assert_eq!(player.snapshot.equipped_weapon_id, "paws");
        assert_eq!(player.snapshot.equipped_weapon_resource, None);
        assert_eq!(player.snapshot.hp, MAX_HP);
    }
}
