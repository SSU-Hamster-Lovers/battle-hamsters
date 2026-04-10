use actix::{Actor, ActorContext, AsyncContext, Handler, Message, Recipient, StreamHandler};
use actix_web::{web, App, Error, HttpRequest, HttpResponse, HttpServer, Responder};
use actix_web_actors::ws;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
const MAX_JUMP_COUNT: u8 = 1;

#[derive(Clone, Copy)]
struct FloorSegment {
    left_x: f64,
    right_x: f64,
    top_y: f64,
}

#[derive(Clone, Copy)]
struct OneWayPlatformSegment {
    left_x: f64,
    right_x: f64,
    top_y: f64,
}

#[derive(Clone, Copy)]
struct SolidWall {
    x: f64,
    top_y: f64,
    bottom_y: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HazardKind {
    FallZone,
    InstantKillHazard,
}

#[derive(Clone)]
struct HazardRect {
    kind: HazardKind,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct RuntimeMapData {
    room_id: String,
    width: f64,
    height: f64,
    spawn_points: Vec<Vector2>,
    floor_segments: Vec<FloorSegment>,
    one_way_platforms: Vec<OneWayPlatformSegment>,
    solid_walls: Vec<SolidWall>,
    hazards: Vec<HazardRect>,
}

static RUNTIME_MAP_DATA: OnceLock<RuntimeMapData> = OnceLock::new();

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

#[derive(Deserialize)]
struct MapSize {
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapSpawnPoint {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MapCollisionPrimitive {
    Floor {
        #[serde(rename = "leftX")]
        left_x: f64,
        #[serde(rename = "rightX")]
        right_x: f64,
        #[serde(rename = "topY")]
        top_y: f64,
    },
    OneWayPlatform {
        #[serde(rename = "leftX")]
        left_x: f64,
        #[serde(rename = "rightX")]
        right_x: f64,
        #[serde(rename = "topY")]
        top_y: f64,
    },
    SolidWall {
        x: f64,
        #[serde(rename = "topY")]
        top_y: f64,
        #[serde(rename = "bottomY")]
        bottom_y: f64,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MapHazard {
    FallZone {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    InstantKillHazard {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeMapDefinition {
    size: MapSize,
    spawn_points: Vec<MapSpawnPoint>,
    collision: Vec<MapCollisionPrimitive>,
    hazards: Vec<MapHazard>,
}

fn runtime_map_data() -> &'static RuntimeMapData {
    RUNTIME_MAP_DATA.get_or_init(|| {
        let raw = include_str!("../../packages/shared/maps/training-arena.json");
        let map_definition: RuntimeMapDefinition =
            serde_json::from_str(raw).expect("training arena JSON should deserialize");

        let mut floor_segments = Vec::new();
        let mut one_way_platforms = Vec::new();
        let mut solid_walls = Vec::new();

        for primitive in map_definition.collision {
            match primitive {
                MapCollisionPrimitive::Floor {
                    left_x,
                    right_x,
                    top_y,
                } => floor_segments.push(FloorSegment {
                    left_x,
                    right_x,
                    top_y,
                }),
                MapCollisionPrimitive::OneWayPlatform {
                    left_x,
                    right_x,
                    top_y,
                } => one_way_platforms.push(OneWayPlatformSegment {
                    left_x,
                    right_x,
                    top_y,
                }),
                MapCollisionPrimitive::SolidWall { x, top_y, bottom_y } => {
                    solid_walls.push(SolidWall { x, top_y, bottom_y })
                }
            }
        }

        let hazards = map_definition
            .hazards
            .into_iter()
            .map(|hazard| match hazard {
                MapHazard::FallZone {
                    x,
                    y,
                    width,
                    height,
                } => HazardRect {
                    kind: HazardKind::FallZone,
                    x,
                    y,
                    width,
                    height,
                },
                MapHazard::InstantKillHazard {
                    x,
                    y,
                    width,
                    height,
                } => HazardRect {
                    kind: HazardKind::InstantKillHazard,
                    x,
                    y,
                    width,
                    height,
                },
            })
            .collect::<Vec<_>>();

        RuntimeMapData {
            room_id: ROOM_ID.to_string(),
            width: map_definition.size.width,
            height: map_definition.size.height,
            spawn_points: map_definition
                .spawn_points
                .into_iter()
                .map(|spawn| Vector2 {
                    x: spawn.x,
                    y: spawn.y,
                })
                .collect(),
            floor_segments,
            one_way_platforms,
            solid_walls,
            hazards,
        }
    })
}

fn world_width() -> f64 {
    runtime_map_data().width
}

fn world_height() -> f64 {
    runtime_map_data().height
}

fn room_id() -> &'static str {
    runtime_map_data().room_id.as_str()
}

fn ground_top_y() -> f64 {
    runtime_map_data()
        .floor_segments
        .iter()
        .map(|segment| segment.top_y)
        .fold(f64::NEG_INFINITY, f64::max)
}

fn primary_fall_zone() -> &'static HazardRect {
    runtime_map_data()
        .hazards
        .iter()
        .find(|hazard| hazard.kind == HazardKind::FallZone)
        .expect("training arena should define a fall zone")
}

fn pit_left_x() -> f64 {
    primary_fall_zone().x
}

fn pit_right_x() -> f64 {
    primary_fall_zone().x + primary_fall_zone().width
}

#[derive(Clone)]
struct PlayerRuntime {
    snapshot: PlayerSnapshot,
    latest_input: PlayerInputPayload,
    spawn_index: usize,
}

struct RoomState {
    room_id: String,
    server_tick: u64,
    time_remaining_ms: u64,
    players: HashMap<String, PlayerRuntime>,
    sessions: HashMap<String, Recipient<WsText>>,
}

impl RoomState {
    fn new() -> Self {
        Self {
            room_id: room_id().to_string(),
            server_tick: 0,
            time_remaining_ms: DEFAULT_TIME_LIMIT_MS,
            players: HashMap::new(),
            sessions: HashMap::new(),
        }
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
            max_jump_count: MAX_JUMP_COUNT,
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
            },
        );

        RoomSnapshotPayload {
            room_id: self.room_id.clone(),
            self_player_id: Some(player_id),
            players: self.player_snapshots(),
            weapon_pickups: vec![],
            item_pickups: vec![],
            match_state: MatchState::Waiting,
        }
    }

    fn remove_player(&mut self, player_id: &str) -> bool {
        self.sessions.remove(player_id);
        self.players.remove(player_id).is_some()
    }

    fn apply_input(&mut self, player_id: &str, input: PlayerInputPayload) {
        if let Some(player) = self.players.get_mut(player_id) {
            player.latest_input = input;
        }
    }

    fn tick(&mut self, now_ms: u64) -> WorldSnapshotPayload {
        self.server_tick += 1;
        self.time_remaining_ms = self.time_remaining_ms.saturating_sub(TICK_INTERVAL_MS);

        let player_ids = self.players.keys().cloned().collect::<Vec<_>>();
        let mut deaths = Vec::new();

        for player_id in player_ids {
            let Some(player) = self.players.get_mut(&player_id) else {
                continue;
            };

            if player.snapshot.state == PlayerState::Respawning {
                if let Some(respawn_at) = player.snapshot.respawn_at {
                    if now_ms >= respawn_at {
                        respawn_player(player);
                    }
                }
                continue;
            }

            step_player(player, now_ms);

            if intersecting_hazard(&player.snapshot).is_some() {
                deaths.push(player_id);
            }
        }

        for player_id in deaths {
            if let Some(player) = self.players.get_mut(&player_id) {
                trigger_respawn(player, now_ms);
            }
        }

        WorldSnapshotPayload {
            version: 1,
            room_id: self.room_id.clone(),
            match_state: MatchState::Running,
            server_tick: self.server_tick,
            players: self.player_snapshots(),
            projectiles: vec![],
            weapon_pickups: vec![],
            item_pickups: vec![],
            time_remaining_ms: self.time_remaining_ms,
        }
    }
}

fn spawn_position(spawn_index: usize) -> Vector2 {
    let spawn_points = &runtime_map_data().spawn_points;
    spawn_points[spawn_index % spawn_points.len()].clone()
}

fn step_player(player: &mut PlayerRuntime, now_ms: u64) {
    let input = player.latest_input.clone();
    let move_x = input.move_ref().x.clamp(-1.0, 1.0);
    let down_pressed = input.move_ref().y > 0.5;

    player.snapshot.velocity.x = move_x * RUN_SPEED_PER_TICK;

    if move_x < 0.0 {
        player.snapshot.direction = Direction::Left;
    } else if move_x > 0.0 {
        player.snapshot.direction = Direction::Right;
    } else if input.aim.x < 0.0 {
        player.snapshot.direction = Direction::Left;
    } else if input.aim.x > 0.0 {
        player.snapshot.direction = Direction::Right;
    }

    let on_one_way_platform = is_on_one_way_platform(&player.snapshot);
    let drop_active = player
        .snapshot
        .drop_through_until
        .is_some_and(|until| until > now_ms);

    if input.jump {
        if player.snapshot.grounded && down_pressed && on_one_way_platform {
            player.snapshot.drop_through_until = Some(now_ms + DROP_THROUGH_MS);
            player.snapshot.grounded = false;
            player.snapshot.position.y += 2.0;
            player.snapshot.velocity.y = 2.0;
        } else if player.snapshot.jump_count_used < player.snapshot.max_jump_count {
            player.snapshot.velocity.y = JUMP_VELOCITY;
            player.snapshot.grounded = false;
            player.snapshot.jump_count_used += 1;
        }
    }

    if !player.snapshot.grounded {
        if down_pressed && player.snapshot.velocity.y < 0.0 {
            player.snapshot.velocity.y = 0.0;
        }

        let gravity = if down_pressed {
            FAST_FALL_GRAVITY_PER_TICK
        } else {
            GRAVITY_PER_TICK
        };
        let max_fall_speed = if down_pressed {
            MAX_FAST_FALL_SPEED
        } else {
            MAX_FALL_SPEED
        };
        player.snapshot.velocity.y = (player.snapshot.velocity.y + gravity).min(max_fall_speed);
    }

    let previous_position = player.snapshot.position.clone();
    player.snapshot.position.x += player.snapshot.velocity.x;
    player.snapshot.position.x = player
        .snapshot
        .position
        .x
        .clamp(PLAYER_HALF_SIZE, world_width() - PLAYER_HALF_SIZE);

    player.snapshot.position.y += player.snapshot.velocity.y;

    player.snapshot.grounded = false;

    resolve_wall_collisions(&mut player.snapshot, &previous_position);

    let previous_bottom = previous_position.y + PLAYER_HALF_SIZE;
    let current_bottom = player.snapshot.position.y + PLAYER_HALF_SIZE;

    for floor in &runtime_map_data().floor_segments {
        if current_bottom >= floor.top_y
            && surface_contains_x(floor.left_x, floor.right_x, player.snapshot.position.x)
        {
            land_on_surface(&mut player.snapshot, floor.top_y);
            return;
        }
    }

    if player.snapshot.velocity.y >= 0.0 && !drop_active {
        for platform in &runtime_map_data().one_way_platforms {
            if previous_bottom <= platform.top_y
                && current_bottom >= platform.top_y
                && surface_contains_x(
                    platform.left_x,
                    platform.right_x,
                    player.snapshot.position.x,
                )
            {
                land_on_surface(&mut player.snapshot, platform.top_y);
                return;
            }
        }
    }
}

fn is_on_one_way_platform(player: &PlayerSnapshot) -> bool {
    player.grounded
        && runtime_map_data().one_way_platforms.iter().any(|platform| {
            (player.position.y + PLAYER_HALF_SIZE - platform.top_y).abs() < 1.0
                && surface_contains_x(platform.left_x, platform.right_x, player.position.x)
        })
}

fn surface_contains_x(left_x: f64, right_x: f64, x: f64) -> bool {
    (left_x..=right_x).contains(&x)
}

fn land_on_surface(player: &mut PlayerSnapshot, top_y: f64) {
    player.position.y = top_y - PLAYER_HALF_SIZE;
    player.velocity.y = 0.0;
    player.grounded = true;
    player.jump_count_used = 0;
}

fn resolve_wall_collisions(player: &mut PlayerSnapshot, previous_position: &Vector2) {
    let current_top = player.position.y - PLAYER_HALF_SIZE;
    let current_bottom = player.position.y + PLAYER_HALF_SIZE;

    for wall in &runtime_map_data().solid_walls {
        if current_bottom <= wall.top_y || current_top >= wall.bottom_y {
            continue;
        }

        let previous_left = previous_position.x - PLAYER_HALF_SIZE;
        let previous_right = previous_position.x + PLAYER_HALF_SIZE;
        let current_left = player.position.x - PLAYER_HALF_SIZE;
        let current_right = player.position.x + PLAYER_HALF_SIZE;

        if previous_left >= wall.x && current_left <= wall.x {
            player.position.x = wall.x + PLAYER_HALF_SIZE;
            player.velocity.x = 0.0;
        } else if previous_right <= wall.x && current_right >= wall.x {
            player.position.x = wall.x - PLAYER_HALF_SIZE;
            player.velocity.x = 0.0;
        }
    }
}

fn intersecting_hazard(player: &PlayerSnapshot) -> Option<HazardKind> {
    let player_left = player.position.x - PLAYER_HALF_SIZE;
    let player_right = player.position.x + PLAYER_HALF_SIZE;
    let player_top = player.position.y - PLAYER_HALF_SIZE;
    let player_bottom = player.position.y + PLAYER_HALF_SIZE;

    runtime_map_data().hazards.iter().find_map(|hazard| {
        let hazard_right = hazard.x + hazard.width;
        let hazard_bottom = hazard.y + hazard.height;
        let overlaps = player_right > hazard.x
            && player_left < hazard_right
            && player_bottom > hazard.y
            && player_top < hazard_bottom;

        overlaps.then_some(hazard.kind)
    })
}

fn trigger_respawn(player: &mut PlayerRuntime, now_ms: u64) {
    if player.snapshot.lives > 0 {
        player.snapshot.lives -= 1;
    }

    player.snapshot.hp = 0;
    player.snapshot.state = PlayerState::Respawning;
    player.snapshot.respawn_at = Some(now_ms + RESPAWN_DELAY_MS);
    player.snapshot.velocity = Vector2 { x: 0.0, y: 0.0 };
    player.snapshot.grounded = false;
    player.snapshot.jump_count_used = 0;
    player.snapshot.drop_through_until = None;
    player.snapshot.position.y = ground_top_y() + 80.0;
}

fn respawn_player(player: &mut PlayerRuntime) {
    player.snapshot.position = spawn_position(player.spawn_index);
    player.snapshot.velocity = Vector2 { x: 0.0, y: 0.0 };
    player.snapshot.hp = 100;
    player.snapshot.grounded = false;
    player.snapshot.jump_count_used = 0;
    player.snapshot.drop_through_until = None;
    player.snapshot.respawn_at = None;
    player.snapshot.state = PlayerState::Alive;
}

struct AppState {
    room: Arc<Mutex<RoomState>>,
    next_connection_id: AtomicU64,
    next_player_id: AtomicU64,
}

impl AppState {
    fn new() -> Self {
        Self {
            room: Arc::new(Mutex::new(RoomState::new())),
            next_connection_id: AtomicU64::new(1),
            next_player_id: AtomicU64::new(1),
        }
    }

    fn next_connection_id(&self) -> String {
        format!(
            "conn_{}",
            self.next_connection_id.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn next_player_id(&self) -> String {
        format!(
            "player_{}",
            self.next_player_id.fetch_add(1, Ordering::Relaxed)
        )
    }
}

#[derive(Message)]
#[rtype(result = "()")]
struct WsText(pub String);

struct WsSession {
    connection_id: String,
    player_id: Option<String>,
    app_state: web::Data<AppState>,
    heartbeat_at: Instant,
}

impl WsSession {
    fn new(connection_id: String, app_state: web::Data<AppState>) -> Self {
        Self {
            connection_id,
            player_id: None,
            app_state,
            heartbeat_at: Instant::now(),
        }
    }

    fn send_json<T>(&self, ctx: &mut ws::WebsocketContext<Self>, kind: &'static str, payload: T)
    where
        T: Serialize,
    {
        if let Ok(text) = serialize_message(kind, payload) {
            ctx.text(text);
        }
    }

    fn handle_join_room(&mut self, payload: JoinRoomPayload, ctx: &mut ws::WebsocketContext<Self>) {
        if payload.room_id != room_id() {
            self.send_json(
                ctx,
                "error",
                ErrorPayload {
                    code: "ROOM_NOT_FOUND".to_string(),
                    message: format!("Requested room '{}' does not exist", payload.room_id),
                },
            );
            return;
        }

        if self.player_id.is_some() {
            self.send_json(
                ctx,
                "error",
                ErrorPayload {
                    code: "ALREADY_JOINED".to_string(),
                    message: "Connection already joined a room".to_string(),
                },
            );
            return;
        }

        let player_id = self.app_state.next_player_id();
        let recipient = ctx.address().recipient::<WsText>();

        let room_snapshot = {
            let mut room = self.app_state.room.lock().expect("room mutex poisoned");
            room.add_player(player_id.clone(), payload.player_name.clone(), recipient)
        };

        self.player_id = Some(player_id.clone());
        self.send_json(ctx, "room_snapshot", room_snapshot);
        broadcast_to_room(
            &self.app_state,
            &serialize_message(
                "player_joined",
                PlayerJoinedPayload {
                    player_id,
                    name: payload.player_name,
                },
            )
            .expect("serialize player_joined"),
        );
    }

    fn handle_player_input(
        &mut self,
        payload: PlayerInputPayload,
        ctx: &mut ws::WebsocketContext<Self>,
    ) {
        let Some(player_id) = self.player_id.as_deref() else {
            self.send_json(
                ctx,
                "error",
                ErrorPayload {
                    code: "NOT_JOINED".to_string(),
                    message: "Join a room before sending input".to_string(),
                },
            );
            return;
        };

        let mut room = self.app_state.room.lock().expect("room mutex poisoned");
        room.apply_input(player_id, payload);
    }

    fn start_heartbeat(&self, ctx: &mut ws::WebsocketContext<Self>) {
        ctx.run_interval(
            Duration::from_secs(HEARTBEAT_INTERVAL_SECS),
            |actor, ctx| {
                if actor.heartbeat_at.elapsed() > Duration::from_secs(CLIENT_TIMEOUT_SECS) {
                    log::warn!("WebSocket client timed out: {}", actor.connection_id);
                    ctx.stop();
                    return;
                }

                ctx.ping(b"ping");
            },
        );
    }
}

impl Actor for WsSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.start_heartbeat(ctx);
        self.send_json(
            ctx,
            "welcome",
            WelcomePayload {
                connection_id: self.connection_id.clone(),
                server_version: SERVER_VERSION.to_string(),
            },
        );
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        let Some(player_id) = self.player_id.take() else {
            return;
        };

        let removed = {
            let mut room = self.app_state.room.lock().expect("room mutex poisoned");
            room.remove_player(&player_id)
        };

        if removed {
            let message = serialize_message("player_left", PlayerLeftPayload { player_id })
                .expect("serialize player_left");
            broadcast_to_room(&self.app_state, &message);
        }
    }
}

impl Handler<WsText> for WsSession {
    type Result = ();

    fn handle(&mut self, msg: WsText, ctx: &mut Self::Context) -> Self::Result {
        ctx.text(msg.0);
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for WsSession {
    fn handle(&mut self, item: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match item {
            Ok(ws::Message::Text(text)) => {
                let envelope = match serde_json::from_str::<IncomingEnvelope>(&text) {
                    Ok(envelope) => envelope,
                    Err(error) => {
                        self.send_json(
                            ctx,
                            "error",
                            ErrorPayload {
                                code: "INVALID_MESSAGE".to_string(),
                                message: error.to_string(),
                            },
                        );
                        return;
                    }
                };

                match envelope.kind.as_str() {
                    "join_room" => {
                        match serde_json::from_value::<JoinRoomPayload>(envelope.payload) {
                            Ok(payload) => self.handle_join_room(payload, ctx),
                            Err(error) => self.send_json(
                                ctx,
                                "error",
                                ErrorPayload {
                                    code: "INVALID_JOIN_ROOM".to_string(),
                                    message: error.to_string(),
                                },
                            ),
                        }
                    }
                    "player_input" => {
                        match serde_json::from_value::<PlayerInputPayload>(envelope.payload) {
                            Ok(payload) => self.handle_player_input(payload, ctx),
                            Err(error) => self.send_json(
                                ctx,
                                "error",
                                ErrorPayload {
                                    code: "INVALID_PLAYER_INPUT".to_string(),
                                    message: error.to_string(),
                                },
                            ),
                        }
                    }
                    "ping" => {
                        if let Ok(payload) = serde_json::from_value::<PingPayload>(envelope.payload)
                        {
                            self.send_json(ctx, "pong", payload);
                        }
                    }
                    _ => {
                        self.send_json(
                            ctx,
                            "error",
                            ErrorPayload {
                                code: "UNKNOWN_MESSAGE_TYPE".to_string(),
                                message: format!("Unsupported message type: {}", envelope.kind),
                            },
                        );
                    }
                }
            }
            Ok(ws::Message::Ping(bytes)) => {
                self.heartbeat_at = Instant::now();
                ctx.pong(&bytes);
            }
            Ok(ws::Message::Pong(_)) => {
                self.heartbeat_at = Instant::now();
            }
            Ok(ws::Message::Close(reason)) => {
                ctx.close(reason);
                ctx.stop();
            }
            Ok(ws::Message::Binary(_)) => {
                self.send_json(
                    ctx,
                    "error",
                    ErrorPayload {
                        code: "BINARY_NOT_SUPPORTED".to_string(),
                        message: "This server currently accepts JSON text messages only"
                            .to_string(),
                    },
                );
            }
            Ok(ws::Message::Continuation(_)) | Ok(ws::Message::Nop) => {}
            Err(error) => {
                log::warn!("WebSocket protocol error: {}", error);
                ctx.stop();
            }
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
    drop_weapon: bool,
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
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
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
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum SpawnStyle {
    Airdrop,
    FadeIn,
    Triggered,
}

#[allow(dead_code)]
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum DespawnStyle {
    ShrinkPop,
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

fn broadcast_to_room(app_state: &web::Data<AppState>, text: &str) {
    let recipients = {
        let room = app_state.room.lock().expect("room mutex poisoned");
        room.sessions.values().cloned().collect::<Vec<_>>()
    };

    for recipient in recipients {
        let _ = recipient.try_send(WsText(text.to_string()));
    }
}

fn start_room_loop(app_state: web::Data<AppState>) {
    actix_web::rt::spawn(async move {
        let mut ticker = actix_web::rt::time::interval(Duration::from_millis(TICK_INTERVAL_MS));

        loop {
            ticker.tick().await;
            let message = {
                let mut room = app_state.room.lock().expect("room mutex poisoned");
                let snapshot = room.tick(now_ms());
                serialize_message("world_snapshot", snapshot)
                    .expect("world_snapshot should serialize")
            };
            broadcast_to_room(&app_state, &message);
        }
    });
}

async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    app_state: web::Data<AppState>,
) -> Result<HttpResponse, Error> {
    let connection_id = app_state.next_connection_id();
    ws::start(WsSession::new(connection_id, app_state), &req, stream)
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
                max_jump_count: MAX_JUMP_COUNT,
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
}
