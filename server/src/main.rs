use actix::Recipient;
use actix_cors::Cors;
use actix_web::{http::header, web, App, HttpResponse, HttpServer, Responder};
mod game_data;
mod room_combat;
mod room_config;
mod room_pickups;
mod room_projectiles;
mod room_runtime;
mod room_world_events;
mod ws_runtime;
use game_data::{
    ground_top_y, pit_left_x, pit_right_x, primary_fall_zone, primary_instant_kill_hazard, room_id,
    runtime_map_data, weapon_definition, world_height, HazardKind,
};
use room_combat::{respawn_player, trigger_respawn};
use room_config::RoomGameplayConfig;
use room_runtime::{intersecting_hazard, spawn_position, step_player, surface_contains_x};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};
use ws_runtime::{start_room_loop, ws_handler, AppState, WsText};

const SERVER_VERSION: &str = "0.1.0";
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
const PICKUP_CULL_MARGIN: f64 = 64.0;
const LAST_HIT_TTL_MS: u64 = 5_000;
const KILL_FEED_TTL_MS: u64 = 3_500;
const KILL_FEED_MAX_ENTRIES: usize = 16;
const DAMAGE_EVENT_TTL_MS: u64 = 350;
const DAMAGE_EVENT_MAX_ENTRIES: usize = 32;
const FREE_PLAY_ROOM_ID: &str = "free_play";
const EMPTY_ROOM_TTL_MS: u64 = 600_000; // 10분, 빈 매치룸 자동 제거
const MATCH_COUNTDOWN_MS: u64 = 5_000; // 매치 시작 카운트다운
const MATCH_RESULT_DISPLAY_MS: u64 = 5_000; // 결과 화면 유지 시간
const MATCH_MIN_PLAYERS: usize = 2; // 카운트다운 시작 최소 인원

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

// POST /rooms — 매치룸 생성 → { roomId, code }
async fn create_room(app_state: web::Data<AppState>) -> impl Responder {
    use rand::Rng;
    let room_seq = app_state.next_room_seq();
    let room_id_str = format!("match_{}", room_seq);

    let code = {
        let codes = app_state.room_codes.lock().expect("codes poisoned");
        let mut rng = rand::thread_rng();
        loop {
            let candidate = format!("{:04}", rng.gen_range(0..10000u32));
            if !codes.contains_key(&candidate) {
                break candidate;
            }
        }
    };

    let room = RoomState::new_match(room_id_str.clone(), code.clone());
    {
        let mut rooms = app_state.rooms.lock().expect("rooms poisoned");
        rooms.insert(room_id_str.clone(), room);
    }
    {
        let mut codes = app_state.room_codes.lock().expect("codes poisoned");
        codes.insert(code.clone(), room_id_str.clone());
    }

    HttpResponse::Ok().json(serde_json::json!({
        "roomId": room_id_str,
        "code": code,
    }))
}

// GET /rooms — 활성 룸 목록
async fn list_rooms(app_state: web::Data<AppState>) -> impl Responder {
    let rooms = app_state.rooms.lock().expect("rooms poisoned");
    let list: Vec<serde_json::Value> = rooms
        .values()
        .map(|r| {
            serde_json::json!({
                "roomId": r.room_id,
                "type": if r.room_type == RoomType::FreePlay { "free_play" } else { "match" },
                "code": r.room_code,
                "players": r.sessions.len(),
                "matchState": r.match_state,
            })
        })
        .collect();
    HttpResponse::Ok().json(list)
}

// GET /rooms/free — 자유맵 roomId 조회
async fn free_room(app_state: web::Data<AppState>) -> impl Responder {
    let rooms = app_state.rooms.lock().expect("rooms poisoned");
    if let Some(r) = rooms.get(FREE_PLAY_ROOM_ID) {
        HttpResponse::Ok().json(serde_json::json!({ "roomId": r.room_id }))
    } else {
        HttpResponse::InternalServerError().body("free play room not found")
    }
}

#[derive(Clone)]
struct PickupKinematics {
    velocity_y: f64,
    grounded: bool,
    affected_by_gravity: bool,
}

#[derive(Clone)]
struct LastHitInfo {
    killer_id: String,
    weapon_id: String,
    hit_at_ms: u64,
}

/// 서버 내부 번 상태 — 직렬화하지 않음.
#[derive(Clone)]
struct BurnEffect {
    killer_id: Option<String>,
    weapon_id: String,
    expires_at: u64,
    next_tick_at: u64,
    tick_damage: u16,
    tick_interval_ms: u64,
}

/// 서버 내부 잡기 상태 — 직렬화하지 않음.
#[derive(Clone)]
struct GrabEffect {
    weapon_id: String,
    expires_at: u64,
}

/// 서버 내부 스턴 상태 — 직렬화하지 않음.
#[derive(Clone)]
struct StunEffect {
    expires_at: u64,
}

/// 서버 월드 이벤트 (공습 등 지연 발동형 맵 이벤트).
#[derive(Clone)]
struct WorldEventRuntime {
    id: u64,
    kind: WorldEventKind,
    trigger_at_ms: u64,
}

#[derive(Clone)]
enum WorldEventKind {
    Airstrike {
        x: f64,
        column_half_width: f64,
        splash_damage: u16,
        knockback: f64,
        attacker_id: String,
        weapon_id: String,
    },
}

#[derive(Clone)]
struct ProjectileRuntime {
    id: String,
    owner_id: String,
    weapon_id: String,
    position: Vector2,
    velocity: Vector2,
    gravity_per_sec2: f64,
    damage: u16,
    knockback: f64,
    range_remaining: f64,
    special_effect: game_data::RuntimeWeaponSpecialEffect,
    spawned_at: u64,
    /// timed_explode 폭발 예약 시각 (ms). None이면 지연 폭발 없음.
    explode_at: Option<u64>,
}

#[derive(Clone)]
struct PlayerRuntime {
    snapshot: PlayerSnapshot,
    latest_input: PlayerInputPayload,
    spawn_index: usize,
    vertical_velocity: f64,
    external_velocity: Vector2,
    next_attack_at: u64,
    attack_queued: bool,
    attack_was_down: bool,
    last_hit_by: Option<LastHitInfo>,
    active_burn: Option<BurnEffect>,
    active_grab: Option<GrabEffect>,
    active_stun: Option<StunEffect>,
    /// 현재 drop-through 중인 source 플랫폼 ID. 이 ID의 플랫폼만 착지 판정에서 제외한다.
    /// 서버 런타임 전용 — 스냅샷에 포함하지 않는다.
    drop_through_platform_id: Option<String>,
}

#[derive(Clone, PartialEq, Eq)]
enum RoomType {
    FreePlay,
    Match,
}

struct RoomState {
    room_id: String,
    room_type: RoomType,
    room_code: Option<String>,
    empty_since_ms: Option<u64>,
    match_state: MatchState,
    countdown_start_ms: Option<u64>,
    result_display_until_ms: Option<u64>,
    server_tick: u64,
    time_remaining_ms: u64,
    gameplay_config: RoomGameplayConfig,
    players: HashMap<String, PlayerRuntime>,
    projectiles: HashMap<String, ProjectileRuntime>,
    weapon_pickups: HashMap<String, WorldWeaponPickup>,
    item_pickups: HashMap<String, WorldItemPickup>,
    next_projectile_id: u64,
    next_weapon_pickup_id: u64,
    next_item_pickup_id: u64,
    world_events: Vec<WorldEventRuntime>,
    next_world_event_id: u64,
    next_spawn_respawn_at: HashMap<String, u64>,
    next_item_spawn_respawn_at: HashMap<String, u64>,
    sessions: HashMap<String, Recipient<WsText>>,
    kill_feed: VecDeque<KillFeedEntry>,
    next_kill_feed_seq: u64,
    damage_events: VecDeque<DamageAppliedEvent>,
    next_damage_event_seq: u64,
}

impl RoomState {
    /// 테스트 및 내부용 기본 생성자 — Running 상태로 시작해 게임 물리가 바로 동작
    fn new() -> Self {
        Self::with_gameplay_config(RoomGameplayConfig::default())
    }

    fn with_gameplay_config(gameplay_config: RoomGameplayConfig) -> Self {
        let mut room = Self::create(
            room_id().to_string(),
            RoomType::Match,
            None,
            gameplay_config,
        );
        room.match_state = MatchState::Running;
        room
    }

    pub(crate) fn new_free_play() -> Self {
        let config = RoomGameplayConfig {
            start_hp: 100,
            stock_lives: 255, // 사실상 무제한
            base_jump_count: 1,
            max_jump_count_limit: 3,
            time_limit_ms: u64::MAX, // 시간 제한 없음
        };
        Self::create(
            FREE_PLAY_ROOM_ID.to_string(),
            RoomType::FreePlay,
            None,
            config,
        )
    }

    pub(crate) fn new_match(room_id: String, code: String) -> Self {
        Self::create(
            room_id,
            RoomType::Match,
            Some(code),
            RoomGameplayConfig::default(),
        )
    }

    fn create(
        room_id: String,
        room_type: RoomType,
        room_code: Option<String>,
        gameplay_config: RoomGameplayConfig,
    ) -> Self {
        let initial_match_state = if room_type == RoomType::FreePlay {
            MatchState::Running
        } else {
            MatchState::Waiting
        };
        let now = now_ms();
        let mut room = Self {
            room_id,
            room_type,
            room_code,
            empty_since_ms: None,
            match_state: initial_match_state,
            countdown_start_ms: None,
            result_display_until_ms: None,
            server_tick: 0,
            time_remaining_ms: gameplay_config.time_limit_ms,
            gameplay_config,
            players: HashMap::new(),
            projectiles: HashMap::new(),
            weapon_pickups: HashMap::new(),
            item_pickups: HashMap::new(),
            next_projectile_id: 1,
            next_weapon_pickup_id: 1,
            next_item_pickup_id: 1,
            world_events: Vec::new(),
            next_world_event_id: 1,
            next_spawn_respawn_at: HashMap::new(),
            next_item_spawn_respawn_at: HashMap::new(),
            sessions: HashMap::new(),
            kill_feed: VecDeque::new(),
            next_kill_feed_seq: 0,
            damage_events: VecDeque::new(),
            next_damage_event_seq: 0,
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

    fn projectile_snapshots(&self) -> Vec<ProjectileSnapshot> {
        self.projectiles
            .values()
            .map(|projectile| ProjectileSnapshot {
                id: projectile.id.clone(),
                owner_id: projectile.owner_id.clone(),
                weapon_id: projectile.weapon_id.clone(),
                position: projectile.position.clone(),
                velocity: projectile.velocity.clone(),
            })
            .collect()
    }

    fn world_event_snapshots(&self) -> Vec<WorldEventSnapshot> {
        self.world_events
            .iter()
            .filter_map(|e| match &e.kind {
                WorldEventKind::Airstrike {
                    x,
                    column_half_width,
                    ..
                } => Some(WorldEventSnapshot {
                    id: e.id,
                    kind: "airstrike",
                    x: *x,
                    column_half_width: *column_half_width,
                    trigger_at_ms: e.trigger_at_ms,
                }),
            })
            .collect()
    }

    pub(crate) fn push_kill_feed(&mut self, victim_id: String, cause: DeathCause, now_ms: u64) {
        self.next_kill_feed_seq += 1;
        let entry = KillFeedEntry {
            id: format!("kf_{}_{}", self.server_tick, self.next_kill_feed_seq),
            occurred_at: now_ms,
            victim_id,
            cause,
        };
        self.kill_feed.push_back(entry);
        while self.kill_feed.len() > KILL_FEED_MAX_ENTRIES {
            self.kill_feed.pop_front();
        }
    }

    pub(crate) fn cleanup_kill_feed(&mut self, now_ms: u64) {
        while let Some(front) = self.kill_feed.front() {
            if now_ms.saturating_sub(front.occurred_at) > KILL_FEED_TTL_MS {
                self.kill_feed.pop_front();
            } else {
                break;
            }
        }
    }

    fn kill_feed_snapshot(&self) -> Vec<KillFeedEntry> {
        self.kill_feed.iter().cloned().collect()
    }

    pub(crate) fn push_damage_event(
        &mut self,
        victim_id: String,
        attacker_id: String,
        weapon_id: String,
        damage: u16,
        impact_direction: Vector2,
        impact_point: Vector2,
        now_ms: u64,
    ) {
        self.next_damage_event_seq += 1;
        let entry = DamageAppliedEvent {
            id: format!("dmg_{}_{}", self.server_tick, self.next_damage_event_seq),
            occurred_at: now_ms,
            victim_id,
            attacker_id,
            weapon_id,
            damage,
            impact_direction,
            impact_point,
        };
        self.damage_events.push_back(entry);
        while self.damage_events.len() > DAMAGE_EVENT_MAX_ENTRIES {
            self.damage_events.pop_front();
        }
    }

    pub(crate) fn cleanup_damage_events(&mut self, now_ms: u64) {
        while let Some(front) = self.damage_events.front() {
            if now_ms.saturating_sub(front.occurred_at) > DAMAGE_EVENT_TTL_MS {
                self.damage_events.pop_front();
            } else {
                break;
            }
        }
    }

    fn damage_event_snapshot(&self) -> Vec<DamageAppliedEvent> {
        self.damage_events.iter().cloned().collect()
    }

    fn build_player_snapshot(
        &self,
        player_id: String,
        player_name: String,
        spawn_index: usize,
    ) -> PlayerSnapshot {
        let spawn = spawn_position(spawn_index);
        PlayerSnapshot {
            id: player_id,
            name: player_name,
            position: spawn,
            velocity: Vector2 { x: 0.0, y: 0.0 },
            direction: Direction::Right,
            hp: self.gameplay_config.start_hp,
            lives: self.gameplay_config.stock_lives,
            move_speed_rank: 0,
            max_jump_count: self.gameplay_config.base_jump_count,
            jump_count_used: 0,
            grounded: false,
            drop_through_until: None,
            respawn_at: None,
            equipped_weapon_id: "paws".to_string(),
            equipped_weapon_resource: None,
            grab_state: None,
            last_death_cause: None,
            state: PlayerState::Alive,
            kills: 0,
            deaths: 0,
            effects: vec![],
        }
    }

    fn add_player(
        &mut self,
        player_id: String,
        player_name: String,
        recipient: Recipient<WsText>,
    ) -> RoomSnapshotPayload {
        let spawn_index = self.players.len();
        let player = self.build_player_snapshot(player_id.clone(), player_name, spawn_index);

        self.sessions.insert(player_id.clone(), recipient);
        self.players.insert(
            player_id.clone(),
            PlayerRuntime {
                snapshot: player,
                latest_input: PlayerInputPayload::default(),
                spawn_index,
                vertical_velocity: 0.0,
                external_velocity: Vector2 { x: 0.0, y: 0.0 },
                next_attack_at: 0,
                attack_queued: false,
                attack_was_down: false,
                last_hit_by: None,
                active_burn: None,
                active_grab: None,
                active_stun: None,
                drop_through_platform_id: None,
            },
        );

        // 플레이어 합류 시 empty 타이머 취소
        self.empty_since_ms = None;

        RoomSnapshotPayload {
            room_id: self.room_id.clone(),
            self_player_id: Some(player_id),
            players: self.player_snapshots(),
            weapon_pickups: self.weapon_pickup_snapshots(),
            item_pickups: self.item_pickup_snapshots(),
            match_state: self.match_state,
            kill_feed: self.kill_feed_snapshot(),
            damage_events: self.damage_event_snapshot(),
        }
    }

    fn remove_player(&mut self, player_id: &str) -> bool {
        self.sessions.remove(player_id);
        let removed = self.players.remove(player_id).is_some();
        if self.sessions.is_empty() && self.room_type == RoomType::Match {
            self.empty_since_ms = Some(now_ms());
        }
        removed
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
    kill_feed: Vec<KillFeedEntry>,
    damage_events: Vec<DamageAppliedEvent>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldSnapshotPayload {
    version: u8,
    room_id: String,
    match_state: MatchState,
    countdown_ms: Option<u64>,
    server_tick: u64,
    players: Vec<PlayerSnapshot>,
    projectiles: Vec<ProjectileSnapshot>,
    world_events: Vec<WorldEventSnapshot>,
    weapon_pickups: Vec<WorldWeaponPickup>,
    item_pickups: Vec<WorldItemPickup>,
    time_remaining_ms: u64,
    kill_feed: Vec<KillFeedEntry>,
    damage_events: Vec<DamageAppliedEvent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorldEventSnapshot {
    id: u64,
    kind: &'static str,
    x: f64,
    column_half_width: f64,
    trigger_at_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct KillFeedEntry {
    id: String,
    occurred_at: u64,
    victim_id: String,
    cause: DeathCause,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DamageAppliedEvent {
    id: String,
    occurred_at: u64,
    victim_id: String,
    attacker_id: String,
    weapon_id: String,
    damage: u16,
    impact_direction: Vector2,
    impact_point: Vector2,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectileSnapshot {
    id: String,
    owner_id: String,
    weapon_id: String,
    position: Vector2,
    velocity: Vector2,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum DeathCause {
    FallZone,
    InstantKillHazard,
    #[serde(rename_all = "camelCase")]
    Weapon {
        killer_id: String,
        weapon_id: String,
    },
    // `self` variant is reserved for self-inflicted damage (e.g. self-recoil kill).
    // Not emitted yet in v1 hazard feedback, but kept in the contract so the
    // shared TS DeathCause remains in sync with the server.
    #[allow(dead_code)]
    #[serde(rename = "self", rename_all = "camelCase")]
    SelfInflicted {
        weapon_id: String,
    },
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
    spawn_cycle_key: Option<String>,
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
    spawn_style: SpawnStyle,
    #[serde(skip_serializing)]
    spawn_cycle_key: Option<String>,
    #[serde(skip_serializing)]
    respawn_ms: Option<u64>,
    #[serde(skip_serializing)]
    kinematics: PickupKinematics,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEffectSnapshot {
    kind: &'static str,
    killer_id: Option<String>,
    weapon_id: String,
    expires_at: u64,
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
    last_death_cause: Option<DeathCause>,
    state: PlayerState,
    kills: u32,
    deaths: u32,
    effects: Vec<StatusEffectSnapshot>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GrabState {
    target_player_id: String,
    remaining_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
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
    let _ = dotenvy::from_filename(".env");
    let _ = dotenvy::from_filename_override(".env.local");
    let _ = dotenvy::from_filename_override("server/.env");
    let _ = dotenvy::from_filename_override("server/.env.local");

    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let api_host = std::env::var("API_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let api_port: u16 = std::env::var("API_PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse()
        .expect("API_PORT must be a number");

    let app_state = web::Data::new(AppState::new());
    start_room_loop(app_state.clone());

    log::info!(
        "Starting Battle Hamsters Server on {}:{}",
        api_host,
        api_port
    );

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allowed_methods(vec!["GET", "POST", "OPTIONS"])
            .allowed_headers(vec![header::CONTENT_TYPE, header::ACCEPT])
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(app_state.clone())
            .route("/health", web::get().to(health))
            .route("/hello", web::get().to(hello))
            .route("/rooms", web::post().to(create_room))
            .route("/rooms", web::get().to(list_rooms))
            .route("/rooms/free", web::get().to(free_room))
            .route("/ws", web::get().to(ws_handler))
    })
    .bind((api_host.as_str(), api_port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as actix_test, App};
    use crate::room_combat::resolve_weapon_aim_direction;
    use crate::game_data::RuntimeWeaponSpecialEffect;

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
                last_death_cause: None,
                state: PlayerState::Alive,
                kills: 0,
                deaths: 0,
                effects: vec![],
            },
            latest_input: PlayerInputPayload::default(),
            spawn_index: 0,
            vertical_velocity: 0.0,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: false,
            attack_was_down: false,
            last_hit_by: None,
            active_burn: None,
            active_grab: None,
            active_stun: None,
            drop_through_platform_id: None,
        }
    }

    fn assert_approx_eq(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.001,
            "expected {expected}, got {actual}"
        );
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
        player.vertical_velocity = 8.0;

        step_player(&mut player, 0);
        dbg!(
            ground_top_y(),
            primary_fall_zone().y,
            player.snapshot.position.y,
            player.snapshot.position.y + PLAYER_HALF_SIZE,
            intersecting_hazard(&player.snapshot)
        );

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
        player.vertical_velocity = 8.0;

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
    fn external_vertical_knockback_does_not_accumulate_into_base_gravity_velocity() {
        let mut player = test_player(800.0, 300.0);
        player.snapshot.grounded = false;
        player.vertical_velocity = 0.0;
        player.external_velocity.y = -18.0;

        step_player(&mut player, 0);
        assert!((player.vertical_velocity - GRAVITY_PER_TICK).abs() < 0.001);
        assert!(player.snapshot.velocity.y < -16.0);

        step_player(&mut player, 50);
        assert!((player.vertical_velocity - (GRAVITY_PER_TICK * 2.0)).abs() < 0.001);
        assert!(player.snapshot.velocity.y > -14.0);
    }

    #[test]
    fn acorn_blaster_aim_profile_clamps_vertical_extremes_on_server() {
        let weapon = weapon_definition("acorn_blaster");

        let clamped_up = resolve_weapon_aim_direction(
            weapon,
            Vector2 { x: 0.0, y: -1.0 },
            Direction::Right,
        );
        assert_approx_eq(clamped_up.x, 55.0_f64.to_radians().cos());
        assert_approx_eq(clamped_up.y, -55.0_f64.to_radians().sin());

        let clamped_down = resolve_weapon_aim_direction(
            weapon,
            Vector2 { x: 0.0, y: 1.0 },
            Direction::Right,
        );
        assert_approx_eq(clamped_down.x, 40.0_f64.to_radians().cos());
        assert_approx_eq(clamped_down.y, 40.0_f64.to_radians().sin());
    }

    #[test]
    fn paws_aim_profile_clamps_using_left_facing_local_angle() {
        let weapon = weapon_definition("paws");

        let clamped = resolve_weapon_aim_direction(
            weapon,
            Vector2 { x: 0.0, y: -1.0 },
            Direction::Left,
        );
        assert_approx_eq(clamped.x, -30.0_f64.to_radians().cos());
        assert_approx_eq(clamped.y, -30.0_f64.to_radians().sin());
    }

    #[test]
    fn instant_kill_hazard_is_separate_from_fall_zone() {
        let ikh = primary_instant_kill_hazard();
        let player_on_spikes =
            test_player(ikh.x + ikh.width / 2.0, ground_top_y() - PLAYER_HALF_SIZE);
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
        // 좌/우 random 후보 각 1개 + 고정 14개(acorn/walnut/ember/seed/pine_sniper/squirrel_gatling/blueberry_mortar/laser_cutter/grab_spear/acorn_sword/hedgehog_spray/pinecone_grenade/stun_acorn/airstrike_remote) = 16개
        assert_eq!(room.weapon_pickups.len(), 16);

        let pickups: Vec<_> = room.weapon_pickups.values().collect();

        let random_group_pickups = pickups
            .iter()
            .filter(|p| matches!(p.position.x as u32, 550 | 1050))
            .collect::<Vec<_>>();
        assert_eq!(
            random_group_pickups.len(),
            2,
            "좌/우 random 후보군에서 각각 1개씩 스폰되어야 함"
        );
        assert!(random_group_pickups.iter().all(|pickup| {
            pickup.weapon_id == "acorn_blaster" || pickup.weapon_id == "seed_shotgun"
        }));

        let cannon_pickup = pickups
            .iter()
            .find(|p| p.weapon_id == "walnut_cannon" && p.position.x as u32 == 800)
            .expect("walnut_cannon pickup should exist");
        assert_eq!(cannon_pickup.position.x as u32, 800);

        assert!(
            pickups
                .iter()
                .any(|p| p.weapon_id == "acorn_blaster" && p.position.x as u32 == 230)
        );
        assert!(
            pickups
                .iter()
                .any(|p| p.weapon_id == "ember_sprinkler" && p.position.x as u32 == 560)
        );
        assert!(
            pickups
                .iter()
                .any(|p| p.weapon_id == "seed_shotgun" && p.position.x as u32 == 1370)
        );
        assert!(
            pickups
                .iter()
                .any(|p| p.weapon_id == "pine_sniper" && p.position.x as u32 == 1400)
        );
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
        let heal_pickup = room
            .item_pickups
            .values()
            .find(|pickup| pickup.item_id == "health_pack_small")
            .expect("heal pickup should exist");
        assert!(matches!(heal_pickup.position.x, 250.0 | 1350.0));
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
        let health_pickup_position = room
            .item_pickups
            .values()
            .find(|pickup| pickup.item_id == "health_pack_small")
            .map(|pickup| pickup.position.clone())
            .expect("health pickup should exist");

        let mut player = test_player(health_pickup_position.x, health_pickup_position.y);
        player.snapshot.hp = 80;
        room.players.insert("player".to_string(), player);

        room.handle_item_pickup("player", 1000);

        let player_after = room.players.get("player").expect("player should exist");
        assert_eq!(player_after.snapshot.hp, MAX_HP);
    }

    #[test]
    fn fade_in_item_stays_floating() {
        let mut room = RoomState::new();
        let jump_item_id = room
            .item_pickups
            .iter()
            .find(|(_, pickup)| pickup.item_id == "jump_boost_small")
            .map(|(pickup_id, _)| pickup_id.clone())
            .expect("jump item should exist");

        let starting_y = room
            .item_pickups
            .get(&jump_item_id)
            .expect("jump item should exist")
            .position
            .y;

        room.step_item_pickups();

        let after_y = room
            .item_pickups
            .get(&jump_item_id)
            .expect("jump item should exist")
            .position
            .y;

        assert_eq!(starting_y, after_y);
    }

    #[test]
    fn airdrop_item_falls_until_grounded() {
        let mut room = RoomState::new();
        // Find specifically an airdrop-style item (affected_by_gravity = true).
        // random_candidates may select either the airdrop or fade_in health pack
        // variant, so filter by kinematics rather than item_id alone.
        let heal_item_id = room
            .item_pickups
            .iter()
            .find(|(_, pickup)| {
                pickup.item_id == "health_pack_small" && pickup.kinematics.affected_by_gravity
            })
            .map(|(pickup_id, _)| pickup_id.clone())
            .expect("airdrop heal item should exist when the airdrop candidate is selected");

        let starting_y = room
            .item_pickups
            .get(&heal_item_id)
            .expect("heal item should exist")
            .position
            .y;

        for _ in 0..40 {
            room.step_item_pickups();
        }

        let pickup = room
            .item_pickups
            .get(&heal_item_id)
            .expect("heal item should exist");

        assert!(pickup.position.y > starting_y);
        assert!(pickup.kinematics.grounded);
    }

    #[test]
    fn room_gameplay_config_applies_to_new_players() {
        let gameplay_config = RoomGameplayConfig {
            start_hp: 150,
            stock_lives: 7,
            base_jump_count: 2,
            max_jump_count_limit: 3,
            time_limit_ms: 123_000,
        };
        let room = RoomState::with_gameplay_config(gameplay_config);
        let player = room.build_player_snapshot("player_cfg".to_string(), "cfg".to_string(), 0);

        assert_eq!(room.time_remaining_ms, gameplay_config.time_limit_ms);
        assert_eq!(player.hp, gameplay_config.start_hp);
        assert_eq!(player.lives, gameplay_config.stock_lives);
        assert_eq!(player.max_jump_count, gameplay_config.base_jump_count);
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
                last_death_cause: None,
                state: PlayerState::Alive,
                kills: 0,
                deaths: 0,
                effects: vec![],
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
            vertical_velocity: 0.0,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: true,
            attack_was_down: true,
            last_hit_by: None,
            active_burn: None,
            active_grab: None,
            active_stun: None,
            drop_through_platform_id: None,
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
                last_death_cause: None,
                state: PlayerState::Alive,
                kills: 0,
                deaths: 0,
                effects: vec![],
            },
            latest_input: PlayerInputPayload::default(),
            spawn_index: 1,
            vertical_velocity: 0.0,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: false,
            attack_was_down: false,
            last_hit_by: None,
            active_burn: None,
            active_grab: None,
            active_stun: None,
            drop_through_platform_id: None,
        };

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying_this_tick);

        let shooter_after = room.players.get("shooter").expect("shooter should exist");
        let target_after = room.players.get("target").expect("target should exist");

        assert_eq!(shooter_after.snapshot.equipped_weapon_id, "paws");
        assert_eq!(shooter_after.snapshot.equipped_weapon_resource, None);
        assert!(shooter_after.external_velocity.x < 0.0);
        assert!(target_after.external_velocity.x > 0.0);
        assert_eq!(target_after.snapshot.hp, 88);
        assert_eq!(room.damage_events.len(), 1);
        let damage_event = room.damage_events.front().expect("damage event should exist");
        assert_eq!(damage_event.victim_id, "target");
        assert_eq!(damage_event.attacker_id, "shooter");
        assert_eq!(damage_event.weapon_id, "acorn_blaster");
        assert_eq!(damage_event.damage, 12);
        assert!(damage_event.impact_direction.x > 0.0);
        assert!(deaths.is_empty());
    }

    #[test]
    fn projectile_attack_spawns_projectiles_and_consumes_resource() {
        let mut room = RoomState::new();

        let mut shooter = test_player(140.0, 120.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "seed_shotgun".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(4);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.latest_input.attack = true;
        shooter.latest_input.attack_pressed = true;
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        room.players.insert("shooter".to_string(), shooter);

        let mut deaths = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying_this_tick);

        let shooter_after = room.players.get("shooter").expect("shooter should exist");
        assert_eq!(shooter_after.snapshot.equipped_weapon_resource, Some(3));
        assert_eq!(room.projectiles.len(), 10);
        assert!(deaths.is_empty());
    }

    #[test]
    fn projectile_step_hits_target_after_multiple_ticks() {
        let mut room = RoomState::new();
        assert_eq!(weapon_definition("walnut_cannon").damage, 80);

        let mut shooter = test_player(140.0, 120.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "walnut_cannon".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(1);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.latest_input.attack = true;
        shooter.latest_input.attack_pressed = true;
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        let mut target = test_player(240.0, 120.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying_this_tick);
        assert_eq!(room.projectiles.len(), 1);

        room.step_projectiles(1000, &mut deaths, &mut dying_this_tick);
        assert_eq!(room.projectiles.len(), 1);
        assert_eq!(room.players.get("target").unwrap().snapshot.hp, 100);

        room.step_projectiles(1050, &mut deaths, &mut dying_this_tick);

        let target_after = room.players.get("target").expect("target should exist");
        assert_eq!(target_after.snapshot.hp, 20);
        assert!(target_after.external_velocity.x > 0.0);
        assert!(room.projectiles.is_empty());
        assert_eq!(room.damage_events.len(), 1);
        assert_eq!(room.damage_events[0].damage, 80);
        assert!(deaths.is_empty());
    }

    #[test]
    fn projectile_passes_upward_through_one_way_platform() {
        let mut room = RoomState::new();
        room.projectiles.insert(
            "proj_up".to_string(),
            ProjectileRuntime {
                id: "proj_up".to_string(),
                owner_id: "shooter".to_string(),
                weapon_id: "walnut_cannon".to_string(),
                position: Vector2 { x: 800.0, y: 490.0 },
                velocity: Vector2 { x: 0.0, y: -800.0 },
                gravity_per_sec2: 0.0,
                damage: 80,
                knockback: 18.0,
                range_remaining: 200.0,
                special_effect: RuntimeWeaponSpecialEffect::None,
                spawned_at: 0,
                explode_at: None,
            },
        );

        let mut deaths = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        room.step_projectiles(1000, &mut deaths, &mut dying_this_tick);

        let projectile = room
            .projectiles
            .get("proj_up")
            .expect("projectile should remain");
        assert!(projectile.position.y < 460.0);
        assert!(deaths.is_empty());
    }

    #[test]
    fn projectile_blocks_when_descending_onto_one_way_platform() {
        let mut room = RoomState::new();
        room.projectiles.insert(
            "proj_down".to_string(),
            ProjectileRuntime {
                id: "proj_down".to_string(),
                owner_id: "shooter".to_string(),
                weapon_id: "walnut_cannon".to_string(),
                position: Vector2 { x: 800.0, y: 450.0 },
                velocity: Vector2 { x: 0.0, y: 800.0 },
                gravity_per_sec2: 0.0,
                damage: 80,
                knockback: 18.0,
                range_remaining: 200.0,
                special_effect: RuntimeWeaponSpecialEffect::None,
                spawned_at: 0,
                explode_at: None,
            },
        );

        let mut deaths = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        room.step_projectiles(1000, &mut deaths, &mut dying_this_tick);

        assert!(room.projectiles.is_empty());
        assert!(deaths.is_empty());
    }

    #[test]
    fn projectile_gravity_curves_horizontal_shot_downward_over_time() {
        let mut room = RoomState::new();
        room.projectiles.insert(
            "proj_arc".to_string(),
            ProjectileRuntime {
                id: "proj_arc".to_string(),
                owner_id: "shooter".to_string(),
                weapon_id: "seed_shotgun".to_string(),
                position: Vector2 { x: 200.0, y: 200.0 },
                velocity: Vector2 { x: 600.0, y: 0.0 },
                gravity_per_sec2: 520.0,
                damage: 7,
                knockback: 4.0,
                range_remaining: 400.0,
                special_effect: RuntimeWeaponSpecialEffect::None,
                spawned_at: 0,
                explode_at: None,
            },
        );

        let mut deaths = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();

        room.step_projectiles(1000, &mut deaths, &mut dying_this_tick);
        let after_first = room
            .projectiles
            .get("proj_arc")
            .expect("projectile should remain after first step")
            .clone();
        assert!(after_first.position.y > 200.0);
        assert!(after_first.velocity.y > 0.0);

        room.step_projectiles(1050, &mut deaths, &mut dying_this_tick);
        let after_second = room
            .projectiles
            .get("proj_arc")
            .expect("projectile should remain after second step");
        assert!(after_second.position.y > after_first.position.y);
        assert!(after_second.velocity.y > after_first.velocity.y);
        assert!(deaths.is_empty());
    }

    #[test]
    fn queued_attack_is_cleared_when_player_only_has_paws() {
        let mut room = RoomState::new();
        let mut player = test_player(140.0, 120.0);
        player.attack_queued = true;
        room.players.insert("player".to_string(), player);

        let mut deaths = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        room.handle_weapon_attack("player", 1000, &mut deaths, &mut dying_this_tick);

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

        trigger_respawn(
            &mut player,
            1000,
            DeathCause::Weapon {
                killer_id: "enemy".to_string(),
                weapon_id: "acorn_blaster".to_string(),
            },
            &RoomGameplayConfig::default(),
        );

        assert_eq!(player.snapshot.move_speed_rank, 0);
        assert_eq!(player.snapshot.max_jump_count, BASE_MAX_JUMP_COUNT);
        assert_eq!(player.snapshot.jump_count_used, 0);
        assert_eq!(player.snapshot.equipped_weapon_id, "paws");
        assert_eq!(player.snapshot.equipped_weapon_resource, None);
        assert!(!player.attack_queued);
        assert!(!player.attack_was_down);
        assert_eq!(player.next_attack_at, 0);
        assert!(matches!(
            player.snapshot.last_death_cause,
            Some(DeathCause::Weapon { .. })
        ));
        assert_eq!(player.snapshot.position.x, 140.0);
        assert_eq!(player.snapshot.position.y, 120.0);
    }

    #[test]
    fn respawn_keeps_general_state_reset() {
        let mut player = test_player(140.0, 120.0);
        player.snapshot.move_speed_rank = 2;
        player.snapshot.max_jump_count = 3;
        player.snapshot.jump_count_used = 1;
        player.snapshot.equipped_weapon_id = "acorn_blaster".to_string();
        player.snapshot.equipped_weapon_resource = Some(2);

        let gameplay_config = RoomGameplayConfig::default();
        let respawn_position = spawn_position(player.spawn_index);
        trigger_respawn(&mut player, 1000, DeathCause::FallZone, &gameplay_config);
        respawn_player(&mut player, respawn_position, &gameplay_config);

        assert_eq!(player.snapshot.state, PlayerState::Alive);
        assert_eq!(player.snapshot.move_speed_rank, 0);
        assert_eq!(player.snapshot.max_jump_count, BASE_MAX_JUMP_COUNT);
        assert_eq!(player.snapshot.jump_count_used, 0);
        assert_eq!(player.snapshot.equipped_weapon_id, "paws");
        assert_eq!(player.snapshot.equipped_weapon_resource, None);
        assert!(player.snapshot.last_death_cause.is_none());
        assert_eq!(player.snapshot.hp, MAX_HP);
    }

    #[test]
    fn hazard_death_pushes_fall_zone_kill_feed_entry() {
        let mut room = RoomState::new();
        let pit_center_x = (pit_left_x() + pit_right_x()) / 2.0;
        let mut player = test_player(pit_center_x, primary_fall_zone().y + PLAYER_HALF_SIZE + 2.0);
        player.snapshot.id = "player_falls".to_string();
        room.players.insert("player_falls".to_string(), player);

        let snapshot = room.tick(2_000);

        assert_eq!(snapshot.kill_feed.len(), 1);
        let entry = &snapshot.kill_feed[0];
        assert_eq!(entry.victim_id, "player_falls");
        assert!(matches!(entry.cause, DeathCause::FallZone));

        let player_after = room
            .players
            .get("player_falls")
            .expect("player should still exist");
        assert_eq!(player_after.snapshot.state, PlayerState::Respawning);
    }

    #[test]
    fn instant_kill_hazard_pushes_kill_feed_entry() {
        let mut room = RoomState::new();
        let ikh = primary_instant_kill_hazard();
        let mut player = test_player(ikh.x + ikh.width / 2.0, ground_top_y() - PLAYER_HALF_SIZE);
        player.snapshot.id = "player_spikes".to_string();
        room.players.insert("player_spikes".to_string(), player);

        let snapshot = room.tick(2_000);

        assert_eq!(snapshot.kill_feed.len(), 1);
        assert!(matches!(
            snapshot.kill_feed[0].cause,
            DeathCause::InstantKillHazard
        ));
    }

    #[test]
    fn weapon_kill_records_weapon_cause_with_killer_and_weapon_id() {
        let mut room = RoomState::new();
        let mut shooter = test_player(140.0, 120.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.equipped_weapon_id = "acorn_blaster".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(8);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;

        let mut target = test_player(220.0, 120.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.hp = 1;

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths: Vec<(String, DeathCause)> = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1_000, &mut deaths, &mut dying_this_tick);

        assert_eq!(deaths.len(), 1);
        let (victim, cause) = &deaths[0];
        assert_eq!(victim, "target");
        match cause {
            DeathCause::Weapon {
                killer_id,
                weapon_id,
            } => {
                assert_eq!(killer_id, "shooter");
                assert_eq!(weapon_id, "acorn_blaster");
            }
            _ => panic!("expected Weapon cause"),
        }
    }

    #[test]
    fn weapon_attack_skips_target_already_dying_this_tick() {
        let mut room = RoomState::new();
        let mut shooter = test_player(140.0, 120.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.equipped_weapon_id = "acorn_blaster".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(8);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;

        let mut target = test_player(220.0, 120.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.hp = 1;

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths: Vec<(String, DeathCause)> = Vec::new();
        let mut dying_this_tick = std::collections::HashSet::new();
        dying_this_tick.insert("target".to_string());

        room.handle_weapon_attack("shooter", 1_000, &mut deaths, &mut dying_this_tick);

        assert!(deaths.is_empty(), "dying target should not be pushed again");
        let target_after = room.players.get("target").expect("target should exist");
        assert_eq!(
            target_after.snapshot.hp, 1,
            "dying target should not take extra damage"
        );
    }

    #[test]
    fn tick_never_records_same_victim_twice_on_hazard_and_weapon_combo() {
        let mut room = RoomState::new();

        // Shooter equipped with acorn_blaster, aiming at the pit center.
        let mut shooter = test_player(pit_left_x() - 60.0, ground_top_y() - PLAYER_HALF_SIZE - 2.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "acorn_blaster".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(8);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;

        // Victim starts at very low HP, already inside the pit fall_zone.
        let pit_center_x = (pit_left_x() + pit_right_x()) / 2.0;
        let mut victim = test_player(pit_center_x, primary_fall_zone().y + PLAYER_HALF_SIZE + 2.0);
        victim.snapshot.id = "victim".to_string();
        victim.snapshot.hp = 1;

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("victim".to_string(), victim);

        let snapshot = room.tick(2_000);

        let victim_entries = snapshot
            .kill_feed
            .iter()
            .filter(|entry| entry.victim_id == "victim")
            .count();
        assert_eq!(
            victim_entries, 1,
            "the same victim must not appear in the kill feed twice in a single tick",
        );
    }

    #[test]
    fn cull_removes_weapon_pickup_that_entered_fall_zone() {
        let mut room = RoomState::new();
        let pickup_id = room
            .weapon_pickups
            .keys()
            .next()
            .cloned()
            .expect("initial weapon pickup should exist");
        let fall_zone = primary_fall_zone();

        {
            let pickup = room
                .weapon_pickups
                .get_mut(&pickup_id)
                .expect("pickup should exist");
            pickup.position.x = fall_zone.x + fall_zone.width / 2.0;
            pickup.position.y = fall_zone.y + fall_zone.height / 2.0;
        }

        room.cull_out_of_world_pickups(5_000);

        assert!(
            !room.weapon_pickups.contains_key(&pickup_id),
            "pickup that entered fall_zone should be removed",
        );
    }

    #[test]
    fn cull_removes_weapon_pickup_that_fell_below_world() {
        let mut room = RoomState::new();
        let pickup_id = room
            .weapon_pickups
            .keys()
            .next()
            .cloned()
            .expect("initial weapon pickup should exist");

        {
            let pickup = room
                .weapon_pickups
                .get_mut(&pickup_id)
                .expect("pickup should exist");
            pickup.position.y = world_height() + PICKUP_CULL_MARGIN + 1.0;
        }

        room.cull_out_of_world_pickups(5_000);

        assert!(
            !room.weapon_pickups.contains_key(&pickup_id),
            "pickup below the world should be removed",
        );
    }

    #[test]
    fn cull_schedules_respawn_for_spawn_source_pickup() {
        let mut room = RoomState::new();
        let (pickup_id, spawn_cycle_key, respawn_ms) = {
            let (id, pickup) = room
                .weapon_pickups
                .iter()
                .next()
                .expect("initial weapon pickup should exist");
            (
                id.clone(),
                pickup.spawn_cycle_key.clone(),
                pickup.respawn_ms,
            )
        };
        let spawn_cycle_key = spawn_cycle_key.expect("spawn pickup should have a cycle key");
        let respawn_ms = respawn_ms.expect("spawn pickup should have a respawn timer");

        {
            let pickup = room
                .weapon_pickups
                .get_mut(&pickup_id)
                .expect("pickup should exist");
            pickup.position.y = world_height() + PICKUP_CULL_MARGIN + 10.0;
        }

        room.cull_out_of_world_pickups(5_000);

        assert!(!room.weapon_pickups.contains_key(&pickup_id));
        assert_eq!(
            room.next_spawn_respawn_at.get(&spawn_cycle_key),
            Some(&(5_000 + respawn_ms)),
            "culling a spawn-source pickup should schedule its respawn",
        );
    }

    #[test]
    fn cull_leaves_grounded_pickups_alone() {
        let mut room = RoomState::new();
        let pickup_count_before = room.weapon_pickups.len();

        room.cull_out_of_world_pickups(5_000);

        assert_eq!(
            room.weapon_pickups.len(),
            pickup_count_before,
            "pickups resting on valid ground should not be culled",
        );
    }

    #[test]
    fn kill_feed_cleanup_drops_expired_entries() {
        let mut room = RoomState::new();
        room.push_kill_feed("victim_old".to_string(), DeathCause::FallZone, 1_000);
        room.push_kill_feed("victim_new".to_string(), DeathCause::FallZone, 4_000);

        room.cleanup_kill_feed(5_000);

        assert_eq!(room.kill_feed.len(), 1);
        assert_eq!(room.kill_feed.front().unwrap().victim_id, "victim_new");
    }

    #[test]
    fn kill_feed_is_capped_at_max_entries() {
        let mut room = RoomState::new();
        for i in 0..(KILL_FEED_MAX_ENTRIES as u64 + 4) {
            room.push_kill_feed(format!("victim_{}", i), DeathCause::FallZone, 1_000 + i);
        }

        assert_eq!(room.kill_feed.len(), KILL_FEED_MAX_ENTRIES);
        // oldest entries (victim_0..victim_3) should have been dropped
        assert_eq!(room.kill_feed.front().unwrap().victim_id, "victim_4");
    }

    #[test]
    fn respawn_uses_room_gameplay_config_values() {
        let gameplay_config = RoomGameplayConfig {
            start_hp: 150,
            stock_lives: 5,
            base_jump_count: 2,
            max_jump_count_limit: 3,
            time_limit_ms: 90_000,
        };
        let mut player = test_player(140.0, 120.0);
        player.snapshot.max_jump_count = 3;
        player.snapshot.jump_count_used = 2;
        player.snapshot.hp = 1;

        let respawn_position = spawn_position(player.spawn_index);
        trigger_respawn(
            &mut player,
            1000,
            DeathCause::InstantKillHazard,
            &gameplay_config,
        );
        respawn_player(&mut player, respawn_position, &gameplay_config);

        assert_eq!(player.snapshot.hp, gameplay_config.start_hp);
        assert_eq!(
            player.snapshot.max_jump_count,
            gameplay_config.base_jump_count
        );
    }

    #[test]
    fn hazard_death_within_ttl_is_attributed_to_last_shooter() {
        let mut room = RoomState::new();
        let pit_center_x = (pit_left_x() + pit_right_x()) / 2.0;

        // Place victim already in the fall zone with a recent last_hit_by.
        let mut victim = test_player(pit_center_x, primary_fall_zone().y + PLAYER_HALF_SIZE + 2.0);
        victim.snapshot.id = "victim".to_string();
        victim.last_hit_by = Some(crate::LastHitInfo {
            killer_id: "shooter".to_string(),
            weapon_id: "acorn_blaster".to_string(),
            hit_at_ms: 1_000, // 1s before tick time 2_000 → within 5s TTL
        });
        room.players.insert("victim".to_string(), victim);

        let snapshot = room.tick(2_000);

        assert_eq!(snapshot.kill_feed.len(), 1);
        let entry = &snapshot.kill_feed[0];
        assert_eq!(entry.victim_id, "victim");
        match &entry.cause {
            DeathCause::Weapon {
                killer_id,
                weapon_id,
            } => {
                assert_eq!(killer_id, "shooter");
                assert_eq!(weapon_id, "acorn_blaster");
            }
            other => panic!(
                "expected Weapon cause but got {:?}",
                std::mem::discriminant(other)
            ),
        }
    }

    #[test]
    fn hazard_death_after_ttl_falls_back_to_hazard_cause() {
        let mut room = RoomState::new();
        let pit_center_x = (pit_left_x() + pit_right_x()) / 2.0;

        let mut victim = test_player(pit_center_x, primary_fall_zone().y + PLAYER_HALF_SIZE + 2.0);
        victim.snapshot.id = "victim_stale".to_string();
        victim.last_hit_by = Some(crate::LastHitInfo {
            killer_id: "old_shooter".to_string(),
            weapon_id: "acorn_blaster".to_string(),
            hit_at_ms: 0, // 2s before tick time 2_000 — BUT 5s TTL → still within? No: 2000-0=2000 < 5000
                          // Let's use hit_at_ms that exceeds TTL: now_ms 2_000, hit 6_001ms ago → hit_at_ms = MAX or negative won't work
                          // Use a fresh tick time far in the future so TTL is exceeded
        });
        // Override with a hit_at_ms that guarantees expiry: tick at 10_000, hit at 0 → delta 10_000 > 5_000
        room.players.insert("victim_stale".to_string(), victim);

        // Tick at now_ms=10_000 so delta from hit_at_ms=0 is 10_000ms, exceeding LAST_HIT_TTL_MS=5_000
        let snapshot = room.tick(10_000);

        assert_eq!(snapshot.kill_feed.len(), 1);
        assert!(matches!(snapshot.kill_feed[0].cause, DeathCause::FallZone));
    }

    // ── Paws 근접 판정 테스트 ────────────────────────────────────────────

    fn paws_shooter(x: f64, y: f64, aim_x: f64, aim_y: f64) -> PlayerRuntime {
        let mut p = test_player(x, y);
        p.snapshot.equipped_weapon_id = "paws".to_string();
        p.snapshot.equipped_weapon_resource = None;
        p.attack_queued = true;
        p.latest_input.aim = Vector2 { x: aim_x, y: aim_y };
        p.latest_input.attack = true;
        p.latest_input.attack_pressed = true;
        p
    }

    fn paws_target(x: f64, y: f64) -> PlayerRuntime {
        let mut p = test_player(x, y);
        p.snapshot.id = "target".to_string();
        p.snapshot.name = "target".to_string();
        p
    }

    #[test]
    fn paws_hits_target_directly_in_front() {
        // 공격자 x=100, 에임 오른쪽(1,0), 타겟 x=130 — 거리 30px (14~56 범위, 수직 0px)
        let mut room = RoomState::new();
        room.players.insert(
            "shooter".to_string(),
            paws_shooter(100.0, 200.0, 1.0, 0.0),
        );
        let mut target = paws_target(130.0, 200.0);
        target.snapshot.id = "target".to_string();
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let victim = room.players.get("target").unwrap();
        assert_eq!(victim.snapshot.hp, 92); // damage=8
        assert!(victim.external_velocity.x > 0.0); // 오른쪽으로 넉백
        assert_eq!(room.damage_events.len(), 1);
        assert!(deaths.is_empty());
    }

    #[test]
    fn paws_misses_target_behind_attacker() {
        // 공격자 x=100, 에임 오른쪽(1,0), 타겟 x=60 — 뒤쪽, d_forward 음수
        let mut room = RoomState::new();
        room.players.insert(
            "shooter".to_string(),
            paws_shooter(100.0, 200.0, 1.0, 0.0),
        );
        let mut target = paws_target(60.0, 200.0);
        target.snapshot.id = "target".to_string();
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let victim = room.players.get("target").unwrap();
        assert_eq!(victim.snapshot.hp, 100); // 피격 없음
        assert_eq!(room.damage_events.len(), 0);
    }

    #[test]
    fn paws_misses_target_too_far() {
        // 공격자 x=100, 에임 오른쪽, 타겟 x=200 — 거리 100px, 범위(14~56) 초과
        let mut room = RoomState::new();
        room.players.insert(
            "shooter".to_string(),
            paws_shooter(100.0, 200.0, 1.0, 0.0),
        );
        let mut target = paws_target(200.0, 200.0);
        target.snapshot.id = "target".to_string();
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let victim = room.players.get("target").unwrap();
        assert_eq!(victim.snapshot.hp, 100);
        assert_eq!(room.damage_events.len(), 0);
    }

    #[test]
    fn paws_misses_target_too_close_overlapping_body() {
        // 공격자 x=100, 에임 오른쪽, 타겟 x=106 — 거리 6px, hit_start(14px) 미달
        let mut room = RoomState::new();
        room.players.insert(
            "shooter".to_string(),
            paws_shooter(100.0, 200.0, 1.0, 0.0),
        );
        let mut target = paws_target(106.0, 200.0);
        target.snapshot.id = "target".to_string();
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let victim = room.players.get("target").unwrap();
        assert_eq!(victim.snapshot.hp, 100); // 너무 겹쳐있으면 빗나감
        assert_eq!(room.damage_events.len(), 0);
    }

    #[test]
    fn paws_misses_target_outside_cone_perpendicular() {
        // 공격자 x=100, 에임 오른쪽, 타겟 x=135, y=250 — 수직 이탈 50px (원뿔 반폭 초과)
        let mut room = RoomState::new();
        room.players.insert(
            "shooter".to_string(),
            paws_shooter(100.0, 200.0, 1.0, 0.0),
        );
        let mut target = paws_target(135.0, 250.0); // 수직 거리 50px
        target.snapshot.id = "target".to_string();
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let victim = room.players.get("target").unwrap();
        assert_eq!(victim.snapshot.hp, 100); // 원뿔 밖
        assert_eq!(room.damage_events.len(), 0);
    }

    #[test]
    fn paws_respects_cooldown() {
        let mut room = RoomState::new();
        let mut shooter = paws_shooter(100.0, 200.0, 1.0, 0.0);
        shooter.next_attack_at = 2000; // 쿨타임 중
        room.players.insert("shooter".to_string(), shooter);
        let mut target = paws_target(130.0, 200.0);
        target.snapshot.id = "target".to_string();
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying); // now_ms < next_attack_at

        let victim = room.players.get("target").unwrap();
        assert_eq!(victim.snapshot.hp, 100);
    }

    #[test]
    fn paws_kills_low_hp_target() {
        let mut room = RoomState::new();
        room.players.insert(
            "shooter".to_string(),
            paws_shooter(100.0, 200.0, 1.0, 0.0),
        );
        let mut target = paws_target(130.0, 200.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.hp = 5; // damage=8, should kill
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let victim = room.players.get("target").unwrap();
        assert_eq!(victim.snapshot.hp, 0);
        assert_eq!(deaths.len(), 1);
        assert!(matches!(deaths[0].1, DeathCause::Weapon { .. }));
    }

    #[test]
    fn last_hit_by_cleared_on_respawn() {
        let mut player = test_player(200.0, ground_top_y() - PLAYER_HALF_SIZE - 2.0);
        player.last_hit_by = Some(crate::LastHitInfo {
            killer_id: "some_player".to_string(),
            weapon_id: "acorn_blaster".to_string(),
            hit_at_ms: 1_000,
        });

        let gameplay_config = RoomGameplayConfig::default();
        trigger_respawn(&mut player, 2_000, DeathCause::FallZone, &gameplay_config);

        assert!(
            player.last_hit_by.is_none(),
            "last_hit_by must be cleared on respawn"
        );
    }

    // left_bunker_upper: topY=480, x=160-380
    // left_bunker_lower: topY=580, x=120-340
    // x=260 은 두 플랫폼 x 범위 모두에 포함되고, 수직 간격은 100px.
    // 버그 조건: 기존 전역 시간 무시(drop_active)는 lower platform까지 함께 건너뜀 → 두 플랫폼을 한 번에 통과
    // 수정 후: source 플랫폼(left_bunker_upper)만 무시하고 left_bunker_lower에 정상 착지해야 함
    #[test]
    fn drop_through_skips_only_source_platform_not_adjacent_platform_below() {
        let left_bunker_upper_top_y = 480.0;
        let left_bunker_lower_top_y = 580.0;
        let test_x = 260.0;

        let mut player = test_player(test_x, left_bunker_upper_top_y - PLAYER_HALF_SIZE);
        player.snapshot.grounded = true;

        // Tick 0: jump + down → drop-through 트리거
        player.latest_input.jump = true;
        player.latest_input.movement = Vector2 { x: 0.0, y: 1.0 };
        step_player(&mut player, 0);

        assert!(!player.snapshot.grounded, "drop 직후에는 공중이어야 함");
        assert!(
            player.snapshot.drop_through_until.is_some(),
            "drop_through_until이 설정되어 있어야 함"
        );

        // Tick 1~8: down 유지(급강하), jump 해제
        player.latest_input.jump = false;
        for i in 1..=8u64 {
            let now = i * 50;
            step_player(&mut player, now);
            if player.snapshot.grounded {
                break;
            }
        }

        assert!(
            player.snapshot.grounded,
            "left_bunker_lower에 착지해야 함 (두 플랫폼을 한 번에 통과하면 안 됨)"
        );
        assert_approx_eq(
            player.snapshot.position.y,
            left_bunker_lower_top_y - PLAYER_HALF_SIZE,
        );
    }

    // 버튼을 계속 누르고 있을 때 쿨다운이 만료되면 자동으로 재발사되어야 한다.
    // 기존 버그: attack_queued는 attack_pressed(edge trigger)에서만 설정되므로,
    // 버튼을 누르고 있어도 쿨다운 후 자동 재발사가 이루어지지 않았음.
    #[test]
    fn held_attack_auto_requeues_after_cooldown_expires() {
        let mut room = RoomState::new();

        let mut shooter = test_player(140.0, 120.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "seed_shotgun".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(4);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.latest_input.attack = true; // 버튼 누르고 있음 (held)
        shooter.latest_input.attack_pressed = false; // 처음 누른 순간이 아님
        shooter.attack_queued = false; // 이전 발사 후 queued 해제됨
        shooter.attack_was_down = true; // 버튼 계속 누르고 있음
        shooter.next_attack_at = 500; // 쿨다운 만료 (now_ms=1000 > 500)

        room.players.insert("shooter".to_string(), shooter);

        room.tick(1000);

        // auto-requeue로 발사되었어야 함
        assert!(
            !room.projectiles.is_empty(),
            "버튼을 누르고 있는 동안 쿨다운이 만료되면 자동으로 재발사되어야 함"
        );
        let shooter_after = room.players.get("shooter").unwrap();
        assert_eq!(
            shooter_after.snapshot.equipped_weapon_resource,
            Some(3),
            "발사 시 resource가 소비되어야 함"
        );
    }

    // ember_sprinkler: 맞은 대상에게 Burn DoT가 적용되어야 한다.
    // 현재 JSON은 specialEffect: none이므로 이 테스트는 RED 상태.
    #[test]
    fn ember_sprinkler_applies_burn_on_hit() {
        let mut room = RoomState::new();

        let mut shooter = test_player(140.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "ember_sprinkler".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(100);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        // 사정거리(170px) 안쪽에 있는 대상
        let mut target = test_player(250.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.active_burn.is_some(),
            "ember_sprinkler 명중 시 Burn DoT가 적용되어야 함"
        );
    }

    // pine_sniper: 사거리 안쪽의 대상을 hitscan으로 맞혀야 한다.
    // damage=90, range=3000 (pine-sniper.json 기준)
    #[test]
    fn pine_sniper_hits_target_in_range() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "pine_sniper".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(3);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        // 사거리(3000px) 안쪽 700px 거리에 있는 대상
        let mut target = test_player(700.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        let pine_damage = weapon_definition("pine_sniper").damage;

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        let expected_hp = 100u16.saturating_sub(pine_damage);
        assert_eq!(
            target_after.snapshot.hp,
            expected_hp,
            "pine_sniper 피해량은 {}이어야 함 (hp={})",
            pine_damage,
            target_after.snapshot.hp
        );
    }

    // pine_sniper: 발사 시 resource가 1 소비되어야 한다.
    #[test]
    fn pine_sniper_consumes_resource_per_shot() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "pine_sniper".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(3);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        room.players.insert("shooter".to_string(), shooter);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let shooter_after = room.players.get("shooter").unwrap();
        assert_eq!(
            shooter_after.snapshot.equipped_weapon_resource,
            Some(2),
            "pine_sniper 발사 시 resource가 3 → 2로 소비되어야 함"
        );
    }

    // squirrel_gatling: hitscan으로 사거리 안에 있는 대상에게 피해를 줘야 한다.
    #[test]
    fn squirrel_gatling_hits_target_in_range() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "squirrel_gatling".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(30);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        let mut target = test_player(400.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        let expected_hp = 100u16.saturating_sub(weapon_definition("squirrel_gatling").damage);
        assert_eq!(
            target_after.snapshot.hp,
            expected_hp,
            "squirrel_gatling이 사거리 안의 대상을 맞혀야 함"
        );
    }

    // squirrel_gatling: 발사 시 resource가 1 소비되어야 한다.
    #[test]
    fn squirrel_gatling_consumes_resource_per_shot() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "squirrel_gatling".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(30);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        room.players.insert("shooter".to_string(), shooter);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let shooter_after = room.players.get("shooter").unwrap();
        assert_eq!(
            shooter_after.snapshot.equipped_weapon_resource,
            Some(29),
            "squirrel_gatling 발사 시 resource가 30 → 29로 소비되어야 함"
        );
    }

    // ember_sprinkler: 넓은 cone이므로 Paws 범위 밖에 있는 대상도 맞아야 한다.
    #[test]
    fn ember_sprinkler_wider_cone_hits_target_outside_paws_range() {
        let mut room = RoomState::new();

        let mut shooter = test_player(140.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "ember_sprinkler".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(100);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        // 사거리 안쪽(120px)이지만 aim 축에서 35px 옆에 위치 → Paws cone(far_half_w=21)은 빗나감
        // ember_sprinkler cone(far_half_w=60)은 맞아야 함
        let mut target = test_player(260.0, 265.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "ember_sprinkler 넓은 cone으로 인해 옆에 있는 대상도 맞아야 함 (hp={})",
            target_after.snapshot.hp
        );
    }

    // blueberry_mortar: 직격한 대상에게 직접 피해 + 범위 피해가 모두 적용되어야 한다.
    #[test]
    fn blueberry_mortar_direct_hit_applies_direct_and_splash_damage() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "blueberry_mortar".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(5);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        // 직격 대상: 바로 오른쪽에 위치
        let mut direct_target = test_player(150.0, 300.0);
        direct_target.snapshot.id = "direct_target".to_string();
        direct_target.snapshot.name = "direct_target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("direct_target".to_string(), direct_target);

        // 투사체 발사
        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        // 투사체가 대상에 충돌할 때까지 tick
        for tick in 1..=10 {
            room.step_projectiles(1000 + tick * 50, &mut deaths, &mut dying);
            let target = room.players.get("direct_target").unwrap();
            if target.snapshot.hp < 100 {
                break;
            }
        }

        let target_after = room.players.get("direct_target").unwrap();
        // blueberry_mortar: damage + splashDamage 가 모두 적용되어야 함
        let def = weapon_definition("blueberry_mortar");
        let max_expected_hp = 100u16
            .saturating_sub(def.damage)
            .saturating_sub(def.special_effect.splash_damage().unwrap_or(0));
        assert!(
            target_after.snapshot.hp <= max_expected_hp,
            "blueberry_mortar 직격 시 직접 피해 + 범위 피해가 모두 적용되어야 함 (hp={}, expected_max={})",
            target_after.snapshot.hp,
            max_expected_hp
        );
    }

    // blueberry_mortar: 폭발 반경 안에 있는 인근 대상에게 범위 피해를 줘야 한다.
    #[test]
    fn blueberry_mortar_splash_damages_nearby_player() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "blueberry_mortar".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(5);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        // 직격 대상: 바로 오른쪽에 위치 (floor 위)
        let mut direct_target = test_player(150.0, 300.0);
        direct_target.snapshot.id = "direct_target".to_string();
        direct_target.snapshot.name = "direct_target".to_string();

        // 범위 대상: 직격 대상에서 50px 옆 (반경 80px 내부)
        let mut splash_target = test_player(150.0, 350.0);
        splash_target.snapshot.id = "splash_target".to_string();
        splash_target.snapshot.name = "splash_target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("direct_target".to_string(), direct_target);
        room.players.insert("splash_target".to_string(), splash_target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        for tick in 1..=10 {
            room.step_projectiles(1000 + tick * 50, &mut deaths, &mut dying);
            let direct = room.players.get("direct_target").unwrap();
            let splash = room.players.get("splash_target").unwrap();
            if direct.snapshot.hp < 100 || splash.snapshot.hp < 100 {
                break;
            }
        }

        let splash_after = room.players.get("splash_target").unwrap();
        let def = weapon_definition("blueberry_mortar");
        let splash_dmg = def.special_effect.splash_damage().unwrap_or(0);
        let expected_hp = 100u16.saturating_sub(splash_dmg);
        assert!(
            splash_after.snapshot.hp <= expected_hp,
            "blueberry_mortar 폭발 반경 내 대상에게 범위 피해가 적용되어야 함 (hp={}, splash_dmg={})",
            splash_after.snapshot.hp,
            splash_dmg
        );
    }

    // laser_cutter: 빔이 사거리 내 대상에게 피해를 줘야 한다.
    #[test]
    fn laser_cutter_hits_target_in_range() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "laser_cutter".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(600);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        let mut target = test_player(300.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "laser_cutter가 사거리 내 대상을 맞혀야 함"
        );
    }

    // laser_cutter: 발사 시 capacity가 resource_per_second 기반으로 소모되어야 한다.
    #[test]
    fn laser_cutter_drains_capacity_per_tick() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "laser_cutter".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(600);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        room.players.insert("shooter".to_string(), shooter);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let shooter_after = room.players.get("shooter").unwrap();
        let resource_after = shooter_after
            .snapshot
            .equipped_weapon_resource
            .unwrap_or(0);
        // capacity는 resource_per_second * TICK_INTERVAL_MS / 1000 만큼 소모됨
        // resource_per_second가 있는 경우, 최초 600에서 일부 소모
        assert!(
            resource_after < 600,
            "laser_cutter 발사 시 capacity가 소모되어야 함 (resource={})",
            resource_after
        );
    }

    // grab_spear: 적중 시 대상에게 grab 상태가 적용되어야 한다.
    #[test]
    fn grab_spear_applies_grab_on_hit() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "grab_spear".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(3);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        let mut target = test_player(200.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        // 투사체 발사
        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        // 투사체가 대상에 충돌할 때까지 tick
        for tick in 1..=10 {
            room.step_projectiles(1000 + tick * 50, &mut deaths, &mut dying);
            let target = room.players.get("target").unwrap();
            if target.snapshot.hp < 100 {
                break;
            }
        }

        let target_after = room.players.get("target").unwrap();
        // grab이 적용되면 effects에 "grabbed" 또는 플레이어에 active_grab이 있어야 함
        let has_grab_effect = target_after
            .snapshot
            .effects
            .iter()
            .any(|e| e.kind == "grabbed");
        assert!(
            has_grab_effect,
            "grab_spear 적중 시 대상에게 grab 상태가 적용되어야 함"
        );
    }

    // laser_cutter: 빔이 적중 시 Burn DoT가 적용되어야 한다.
    #[test]
    fn laser_cutter_applies_burn_on_hit() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "laser_cutter".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(600);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        let mut target = test_player(300.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.active_burn.is_some(),
            "laser_cutter 명중 시 Burn DoT가 적용되어야 함"
        );
    }

    // laser_cutter: 원웨이 플랫폼이 빔 경로를 차단할 때 대상에게 피해를 주지 않아야 한다.
    // left_bunker_upper: topY=480, leftX=160, rightX=380
    // shooter(160, 450) → 40° 아래 방향(0.766, 0.643) → target(351.5, 610.7)
    // t_platform≈47, t_target≈250: 플랫폼이 중간에 위치
    #[test]
    fn laser_cutter_blocked_by_one_way_platform() {
        let mut room = RoomState::new();

        // aim 40° below horizontal (aimProfile.maxAimDeg=40 경계)
        let aim_x = 40f64.to_radians().cos(); // ≈ 0.766
        let aim_y = 40f64.to_radians().sin(); // ≈ 0.643

        let mut shooter = test_player(160.0, 450.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "laser_cutter".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(600);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: aim_x, y: aim_y };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        // 빔 축 위에 위치 (t=250), 플랫폼(t≈47) 너머에 있음
        let target = test_player(160.0 + aim_x * 250.0, 450.0 + aim_y * 250.0);
        let mut target = target;
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert_eq!(
            target_after.snapshot.hp, 100,
            "원웨이 플랫폼 뒤의 대상에게는 피해를 주지 않아야 함"
        );
    }

    // grab_effect: 그랩 상태인 플레이어는 수평 이동이 불가해야 한다.
    #[test]
    fn grab_effect_freezes_player_movement() {
        let mut player = test_player(400.0, 300.0);
        player.snapshot.grounded = true;
        // 그랩 효과 직접 부여 (1초 지속)
        player.active_grab = Some(GrabEffect {
            weapon_id: "grab_spear".to_string(),
            expires_at: 99999,
        });
        // 오른쪽으로 이동 시도
        player.latest_input.movement = Vector2 { x: 1.0, y: 0.0 };

        let x_before = player.snapshot.position.x;
        step_player(&mut player, 0);

        assert_eq!(
            player.snapshot.position.x, x_before,
            "그랩 상태에서는 수평 이동이 불가해야 함"
        );
    }

    // acorn_sword: 사거리 내 대상에게 근접 피해를 줘야 한다.
    #[test]
    fn acorn_sword_hits_target_in_range() {
        let mut room = RoomState::new();

        let mut shooter = test_player(200.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "acorn_sword".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(8);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        // 40px 거리 — 사거리(50px) 이내
        let mut target = test_player(240.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "acorn_sword 사거리 내 대상에게 피해를 줘야 함 (hp={}/100)",
            target_after.snapshot.hp
        );
    }

    // acorn_sword: 공격 시 resource가 1 소비되어야 한다.
    #[test]
    fn acorn_sword_consumes_resource_per_swing() {
        let mut room = RoomState::new();

        let mut shooter = test_player(200.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "acorn_sword".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(8);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        room.players.insert("shooter".to_string(), shooter);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let shooter_after = room.players.get("shooter").unwrap();
        assert_eq!(
            shooter_after.snapshot.equipped_weapon_resource,
            Some(7),
            "acorn_sword 1회 공격 후 resource 8 → 7이어야 함"
        );
    }

    // hedgehog_spray: pelletCount=3이므로 단일 발사로 최소 1명에게 피해를 줘야 한다.
    #[test]
    fn hedgehog_spray_hits_target_in_range() {
        let mut room = RoomState::new();
        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.equipped_weapon_id = "hedgehog_spray".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(16);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;
        // target at (360, 300) — 260px, range 500px 이내, 속도 680px/s → ~380ms
        let mut target = test_player(360.0, 300.0);
        target.snapshot.hp = 100;
        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);
        // 투사체를 여러 틱 전진시켜 target에 도달
        for i in 1..=10u64 {
            room.step_projectiles(1000 + i * 50, &mut deaths, &mut dying);
        }

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "hedgehog_spray 발사 후 target이 피해를 입어야 함 (hp={}/100)",
            target_after.snapshot.hp
        );
    }

    // hedgehog_spray: 발사 시 resource가 1 소비되어야 한다.
    #[test]
    fn hedgehog_spray_consumes_resource_per_shot() {
        let mut room = RoomState::new();
        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.equipped_weapon_id = "hedgehog_spray".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(16);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;
        room.players.insert("shooter".to_string(), shooter);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let shooter_after = room.players.get("shooter").unwrap();
        assert_eq!(
            shooter_after.snapshot.equipped_weapon_resource,
            Some(15),
            "hedgehog_spray 1회 발사 후 resource 16 → 15이어야 함"
        );
    }

    // pinecone_grenade: 1500ms 지연 후 폭발하여 범위 내 target에게 피해를 줘야 한다.
    #[test]
    fn pinecone_grenade_explodes_after_delay_and_damages_target() {
        let mut room = RoomState::new();
        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.equipped_weapon_id = "pinecone_grenade".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(2);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;
        // target은 2틱 후 수류탄 위치(x≈170) 기준 폭발 반경(120px) 이내
        // 수류탄: x=100+20(spawn_offset)+25*2(2틱)=170, 타겟 x=200 → 거리≈30px < 120px
        let mut target = test_player(200.0, 300.0);
        target.snapshot.hp = 100;
        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        // 1499ms — 아직 폭발 전: target 피해 없음 (1틱만 이동, 직격 범위 밖)
        room.step_projectiles(2499, &mut deaths, &mut dying);
        assert_eq!(
            room.players.get("target").unwrap().snapshot.hp,
            100,
            "1499ms에 target은 아직 피해를 받지 않아야 함"
        );

        // 1500ms 경과 → 폭발 트리거 (2틱 이동 후 위치 기준 광역 피해)
        room.step_projectiles(2500, &mut deaths, &mut dying);
        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "1500ms 후 폭발로 target이 피해를 입어야 함 (hp={}/100)",
            target_after.snapshot.hp
        );
    }

    // pinecone_grenade: 발사 시 resource가 1 소비되어야 한다.
    #[test]
    fn pinecone_grenade_consumes_resource_per_shot() {
        let mut room = RoomState::new();
        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.equipped_weapon_id = "pinecone_grenade".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(2);
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;
        room.players.insert("shooter".to_string(), shooter);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let shooter_after = room.players.get("shooter").unwrap();
        assert_eq!(
            shooter_after.snapshot.equipped_weapon_resource,
            Some(1),
            "pinecone_grenade 1회 발사 후 resource 2 → 1이어야 함"
        );
    }

    // 수류탄: 지형 충돌 시 즉시 폭발하여 범위 내 target에게 피해를 줘야 한다.
    #[test]
    fn pinecone_grenade_explodes_on_terrain_hit() {
        let mut room = RoomState::new();
        // target: 바닥(y=680) 위 20px, 수류탄 x와 동일
        let mut target = test_player(800.0, 660.0);
        target.snapshot.hp = 100;
        room.players.insert("target".to_string(), target);

        // 수류탄 투사체: y=640에서 아래로 빠르게 낙하 → 1틱 내 바닥(680) 충돌
        // explode_at 미래로 설정해 타이머는 발동 안 됨 (지형 충돌이 먼저)
        room.projectiles.insert(
            "grenade".to_string(),
            ProjectileRuntime {
                id: "grenade".to_string(),
                owner_id: "shooter".to_string(),
                weapon_id: "pinecone_grenade".to_string(),
                position: Vector2 { x: 800.0, y: 640.0 },
                velocity: Vector2 { x: 0.0, y: 1000.0 },
                gravity_per_sec2: 0.0,
                damage: 0,
                knockback: 0.0,
                range_remaining: 500.0,
                special_effect: RuntimeWeaponSpecialEffect::TimedExplode {
                    delay_ms: 99999,
                    radius: 120.0,
                    splash_damage: 55,
                },
                spawned_at: 0,
                explode_at: Some(99999999),
            },
        );

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.step_projectiles(1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "지형 충돌 시 즉시 폭발해 target이 피해를 받아야 함 (hp={}/100)",
            target_after.snapshot.hp
        );
    }

    // airstrike_remote: 비콘 투사체가 지형에 충돌하면 WorldEvent가 생성되어야 한다.
    #[test]
    fn airstrike_remote_creates_world_event_on_terrain_hit() {
        let mut room = RoomState::new();

        // 비콘 투사체: x=500, y=640에서 아래로 빠르게 낙하 → 1틱 내 바닥(680) 충돌
        room.projectiles.insert(
            "beacon".to_string(),
            ProjectileRuntime {
                id: "beacon".to_string(),
                owner_id: "shooter".to_string(),
                weapon_id: "airstrike_remote".to_string(),
                position: Vector2 { x: 500.0, y: 640.0 },
                velocity: Vector2 { x: 0.0, y: 1000.0 },
                gravity_per_sec2: 0.0,
                damage: 0,
                knockback: 0.0,
                range_remaining: 500.0,
                special_effect: RuntimeWeaponSpecialEffect::Airstrike {
                    delay_ms: 2500,
                    column_half_width: 60.0,
                    splash_damage: 70,
                    knockback: 25.0,
                },
                spawned_at: 0,
                explode_at: None,
            },
        );

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.step_projectiles(1000, &mut deaths, &mut dying);

        assert_eq!(
            room.world_events.len(),
            1,
            "비콘 지형 충돌 시 WorldEvent가 1개 생성되어야 함"
        );
    }

    // airstrike_remote: WorldEvent가 delayMs 이후 열 내 플레이어에게 피해를 줘야 한다.
    #[test]
    fn airstrike_remote_world_event_damages_player_in_column() {
        let mut room = RoomState::new();
        let def = weapon_definition("airstrike_remote");
        let (delay_ms, column_half_width, splash_damage) =
            if let RuntimeWeaponSpecialEffect::Airstrike {
                delay_ms,
                column_half_width,
                splash_damage,
                ..
            } = def.special_effect
            {
                (delay_ms, column_half_width, splash_damage)
            } else {
                panic!("airstrike_remote은 Airstrike specialEffect를 가져야 함")
            };

        // target: 공습 중심(x=500)에서 30px 거리 — columnHalfWidth(60) 안쪽
        let mut target = test_player(530.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();
        target.snapshot.hp = 100;
        room.players.insert("target".to_string(), target);

        // WorldEvent 직접 삽입: now_ms=0, triggerAt=delay_ms
        room.world_events.push(WorldEventRuntime {
            id: 1,
            kind: WorldEventKind::Airstrike {
                x: 500.0,
                column_half_width,
                splash_damage,
                knockback: 25.0,
                attacker_id: "shooter".to_string(),
                weapon_id: "airstrike_remote".to_string(),
            },
            trigger_at_ms: delay_ms,
        });

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.step_world_events(delay_ms, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "공습 열 내 target이 피해를 받아야 함 (hp={}/100)",
            target_after.snapshot.hp
        );
    }

    // airstrike_remote: WorldEvent 열 밖의 플레이어는 피해를 받지 않아야 한다.
    #[test]
    fn airstrike_remote_world_event_skips_player_outside_column() {
        let mut room = RoomState::new();
        let def = weapon_definition("airstrike_remote");
        let (delay_ms, column_half_width, splash_damage) =
            if let RuntimeWeaponSpecialEffect::Airstrike {
                delay_ms,
                column_half_width,
                splash_damage,
                ..
            } = def.special_effect
            {
                (delay_ms, column_half_width, splash_damage)
            } else {
                panic!("airstrike_remote은 Airstrike specialEffect를 가져야 함")
            };

        // target: 공습 중심(x=500)에서 200px 거리 — columnHalfWidth(60) 바깥
        let mut target = test_player(700.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();
        target.snapshot.hp = 100;
        room.players.insert("target".to_string(), target);

        room.world_events.push(WorldEventRuntime {
            id: 1,
            kind: WorldEventKind::Airstrike {
                x: 500.0,
                column_half_width,
                splash_damage,
                knockback: 25.0,
                attacker_id: "shooter".to_string(),
                weapon_id: "airstrike_remote".to_string(),
            },
            trigger_at_ms: delay_ms,
        });

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.step_world_events(delay_ms, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert_eq!(
            target_after.snapshot.hp,
            100,
            "공습 열 밖 target은 피해를 받지 않아야 함 (hp={}/100)",
            target_after.snapshot.hp
        );
    }

    // stun_acorn: hitscan으로 사거리 안에 있는 대상에게 피해를 줘야 한다.
    #[test]
    fn stun_acorn_hits_target_in_range() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "stun_acorn".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(6);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        let mut target = test_player(400.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();
        target.snapshot.hp = 100;

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.snapshot.hp < 100,
            "stun_acorn이 사거리 안의 대상에게 피해를 줘야 함 (hp={}/100)",
            target_after.snapshot.hp
        );
    }

    // stun_acorn: 명중 시 대상에게 stun(이동 불가)을 적용해야 한다.
    #[test]
    fn stun_acorn_applies_stun_on_hit() {
        let mut room = RoomState::new();

        let mut shooter = test_player(100.0, 300.0);
        shooter.snapshot.id = "shooter".to_string();
        shooter.snapshot.name = "shooter".to_string();
        shooter.snapshot.direction = Direction::Right;
        shooter.snapshot.grounded = true;
        shooter.snapshot.equipped_weapon_id = "stun_acorn".to_string();
        shooter.snapshot.equipped_weapon_resource = Some(6);
        shooter.latest_input.sequence = 1;
        shooter.latest_input.aim = Vector2 { x: 1.0, y: 0.0 };
        shooter.attack_queued = true;
        shooter.attack_was_down = true;

        let mut target = test_player(400.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();
        target.snapshot.hp = 100;

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths, &mut dying);

        let target_after = room.players.get("target").unwrap();
        assert!(
            target_after.active_stun.is_some(),
            "stun_acorn 명중 시 대상에게 active_stun이 적용되어야 함"
        );
    }

    // stun_acorn: stun이 만료되면 active_stun이 해제되어야 한다.
    #[test]
    fn stun_acorn_stun_expires_after_duration() {
        let mut room = RoomState::new();
        let stun_duration_ms = weapon_definition("stun_acorn")
            .special_effect
            .stun_duration_ms()
            .expect("stun_acorn은 stun specialEffect를 가져야 함");

        let mut target = test_player(400.0, 300.0);
        target.snapshot.id = "target".to_string();
        target.snapshot.name = "target".to_string();
        target.active_stun = Some(StunEffect { expires_at: 1000 + stun_duration_ms });
        room.players.insert("target".to_string(), target);

        // 만료 전 → stun 유지
        room.tick_stun_effects(1000 + stun_duration_ms - 1);
        assert!(
            room.players.get("target").unwrap().active_stun.is_some(),
            "만료 전에는 stun이 유지되어야 함"
        );

        // 만료 시각 도달 → stun 해제
        room.tick_stun_effects(1000 + stun_duration_ms);
        assert!(
            room.players.get("target").unwrap().active_stun.is_none(),
            "만료 시각 도달 시 stun이 해제되어야 함"
        );
    }

    // stun_acorn: stun 상태인 플레이어는 수평 이동 입력이 무시되어야 한다.
    #[test]
    fn stun_acorn_stunned_player_cannot_move_horizontally() {
        let mut player = test_player(500.0, 680.0 - PLAYER_HALF_SIZE);
        player.snapshot.grounded = true;
        player.snapshot.id = "target".to_string();
        // stun 적용: 10초 후 만료
        player.active_stun = Some(StunEffect { expires_at: 10000 });
        // 오른쪽 이동 입력
        player.latest_input.movement = Vector2 { x: 1.0, y: 0.0 };
        player.latest_input.jump = false;

        let x_before = player.snapshot.position.x;
        step_player(&mut player, 1000); // stun 만료 전(1000 < 10000)

        assert_eq!(
            player.snapshot.position.x,
            x_before,
            "stun 상태에서 수평 이동 입력이 무시되어야 함 (x={:.1})",
            player.snapshot.position.x
        );
    }

    // 폭발: shooter가 폭발 반경 내에 있으면 자폭 데미지를 받아야 한다.
    #[test]
    fn explosion_damages_shooter_self_damage() {
        let mut room = RoomState::new();
        let mut shooter = test_player(500.0, 300.0);
        shooter.snapshot.hp = 100;
        room.players.insert("shooter".to_string(), shooter);

        // 폭발 중심 = shooter 위치, 반경 120 → shooter가 맞아야 함
        room.projectiles.insert(
            "grenade".to_string(),
            ProjectileRuntime {
                id: "grenade".to_string(),
                owner_id: "shooter".to_string(),
                weapon_id: "pinecone_grenade".to_string(),
                position: Vector2 { x: 500.0, y: 300.0 },
                velocity: Vector2 { x: 0.0, y: 0.0 },
                gravity_per_sec2: 0.0,
                damage: 0,
                knockback: 0.0,
                range_remaining: 100.0,
                special_effect: RuntimeWeaponSpecialEffect::TimedExplode {
                    delay_ms: 0,
                    radius: 120.0,
                    splash_damage: 55,
                },
                spawned_at: 0,
                explode_at: Some(1000), // now_ms=1000에서 폭발
            },
        );

        let mut deaths = Vec::new();
        let mut dying = std::collections::HashSet::new();
        room.step_projectiles(1000, &mut deaths, &mut dying);

        let shooter_after = room.players.get("shooter").unwrap();
        assert!(
            shooter_after.snapshot.hp < 100,
            "폭발 반경 내 shooter가 자폭 데미지를 받아야 함 (hp={}/100)",
            shooter_after.snapshot.hp
        );
    }
}
