use actix::{Actor, ActorContext, AsyncContext, Handler, Message, Recipient, StreamHandler};
use actix_web::{web, App, Error, HttpRequest, HttpResponse, HttpServer, Responder};
use actix_web_actors::ws;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SERVER_VERSION: &str = "0.1.0";
const ROOM_ID: &str = "room_alpha";
const DEFAULT_TIME_LIMIT_MS: u64 = 300_000;
const TICK_RATE: u64 = 20;
const TICK_INTERVAL_MS: u64 = 1000 / TICK_RATE;
const PLAYER_SPEED_PER_TICK: f64 = 12.0;
const HEARTBEAT_INTERVAL_SECS: u64 = 5;
const CLIENT_TIMEOUT_SECS: u64 = 10;

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
struct PlayerRuntime {
    snapshot: PlayerSnapshot,
    latest_input: Option<PlayerInputPayload>,
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
            room_id: ROOM_ID.to_string(),
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
        let index = self.players.len() as f64;
        let player = PlayerSnapshot {
            id: player_id.clone(),
            name: player_name,
            position: Vector2 {
                x: 120.0 + (index * 80.0),
                y: 360.0,
            },
            velocity: Vector2 { x: 0.0, y: 0.0 },
            direction: Direction::Right,
            hp: 100,
            lives: 3,
            move_speed_rank: 0,
            max_jump_count: 1,
            equipped_weapon_id: "paws".to_string(),
            equipped_weapon_resource: None,
            grab_state: None,
            state: PlayerState::Alive,
        };

        self.sessions.insert(player_id.clone(), recipient);
        self.players.insert(
            player_id,
            PlayerRuntime {
                snapshot: player,
                latest_input: None,
            },
        );

        RoomSnapshotPayload {
            room_id: self.room_id.clone(),
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
            player.latest_input = Some(input);
        }
    }

    fn tick(&mut self) -> WorldSnapshotPayload {
        self.server_tick += 1;
        self.time_remaining_ms = self.time_remaining_ms.saturating_sub(TICK_INTERVAL_MS);

        for player in self.players.values_mut() {
            if let Some(input) = player.latest_input.clone() {
                let move_x = input.move_ref().x.clamp(-1.0, 1.0);
                let move_y = input.move_ref().y.clamp(-1.0, 1.0);

                player.snapshot.velocity = Vector2 {
                    x: move_x * PLAYER_SPEED_PER_TICK,
                    y: move_y * PLAYER_SPEED_PER_TICK,
                };

                player.snapshot.position.x += player.snapshot.velocity.x;
                player.snapshot.position.y += player.snapshot.velocity.y;

                if move_x < 0.0 {
                    player.snapshot.direction = Direction::Left;
                } else if move_x > 0.0 {
                    player.snapshot.direction = Direction::Right;
                } else if input.aim.x < 0.0 {
                    player.snapshot.direction = Direction::Left;
                } else if input.aim.x > 0.0 {
                    player.snapshot.direction = Direction::Right;
                }
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
        if payload.room_id != ROOM_ID {
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
            let message = serialize_message(
                "player_left",
                PlayerLeftPayload {
                    player_id: player_id.clone(),
                },
            )
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
            Ok(ws::Message::Continuation(_)) => {}
            Ok(ws::Message::Nop) => {}
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
#[derive(Deserialize, Clone)]
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

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Copy)]
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
#[derive(Serialize, Clone, Copy)]
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

#[derive(Serialize, Deserialize, Clone)]
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

            let snapshot_message = {
                let mut room = app_state.room.lock().expect("room mutex poisoned");
                let snapshot = room.tick();
                serialize_message("world_snapshot", snapshot)
                    .expect("world_snapshot should serialize")
            };

            broadcast_to_room(&app_state, &snapshot_message);
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
    use actix_web::{test, App};

    #[actix_rt::test]
    async fn test_health() {
        let app = test::init_service(App::new().route("/health", web::get().to(health))).await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
    }
}
