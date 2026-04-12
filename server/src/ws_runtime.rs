use actix::{Actor, ActorContext, AsyncContext, Handler, Message, StreamHandler};
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::{
    serialize_message, ErrorPayload, IncomingEnvelope, JoinRoomPayload, PingPayload,
    PlayerInputPayload, PlayerJoinedPayload, PlayerLeftPayload, RoomState, RoomType,
    WelcomePayload, EMPTY_ROOM_TTL_MS, SERVER_VERSION,
};

pub(crate) struct AppState {
    pub(crate) rooms: Arc<Mutex<HashMap<String, RoomState>>>,
    pub(crate) room_codes: Arc<Mutex<HashMap<String, String>>>, // code → roomId
    next_connection_id: AtomicU64,
    next_player_id: AtomicU64,
    pub(crate) next_room_seq_counter: AtomicU64,
}

impl AppState {
    pub(crate) fn new() -> Self {
        let free_play = RoomState::new_free_play();
        let free_id = free_play.room_id.clone();
        let mut rooms = HashMap::new();
        rooms.insert(free_id, free_play);
        Self {
            rooms: Arc::new(Mutex::new(rooms)),
            room_codes: Arc::new(Mutex::new(HashMap::new())),
            next_connection_id: AtomicU64::new(1),
            next_player_id: AtomicU64::new(1),
            next_room_seq_counter: AtomicU64::new(1),
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

    pub(crate) fn next_room_seq(&self) -> u64 {
        self.next_room_seq_counter.fetch_add(1, Ordering::Relaxed)
    }
}

#[derive(Message)]
#[rtype(result = "()")]
pub(crate) struct WsText(pub String);

pub(crate) struct WsSession {
    connection_id: String,
    player_id: Option<String>,
    room_id: Option<String>,
    app_state: web::Data<AppState>,
    heartbeat_at: Instant,
}

impl WsSession {
    fn new(connection_id: String, app_state: web::Data<AppState>) -> Self {
        Self {
            connection_id,
            player_id: None,
            room_id: None,
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

        // 4자리 숫자 코드로 입장하는 경우 roomId 로 변환
        let resolved_room_id =
            if payload.room_id.len() == 4 && payload.room_id.chars().all(|c| c.is_ascii_digit()) {
                let codes = self.app_state.room_codes.lock().expect("codes poisoned");
                codes
                    .get(&payload.room_id)
                    .cloned()
                    .unwrap_or(payload.room_id.clone())
            } else {
                payload.room_id.clone()
            };

        let room_snapshot = {
            let mut rooms = self.app_state.rooms.lock().expect("rooms poisoned");
            if let Some(room) = rooms.get_mut(&resolved_room_id) {
                Ok(room.add_player(player_id.clone(), payload.player_name.clone(), recipient))
            } else {
                Err(format!("Room '{}' not found", payload.room_id))
            }
        };

        match room_snapshot {
            Ok(snapshot) => {
                self.player_id = Some(player_id.clone());
                self.room_id = Some(resolved_room_id.clone());
                self.send_json(ctx, "room_snapshot", snapshot);
                broadcast_to_room(
                    &self.app_state,
                    &resolved_room_id,
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
            Err(msg) => {
                self.send_json(
                    ctx,
                    "error",
                    ErrorPayload {
                        code: "ROOM_NOT_FOUND".to_string(),
                        message: msg,
                    },
                );
            }
        }
    }

    fn handle_player_input(
        &mut self,
        payload: PlayerInputPayload,
        ctx: &mut ws::WebsocketContext<Self>,
    ) {
        let (Some(player_id), Some(room_id)) = (&self.player_id, &self.room_id) else {
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

        let mut rooms = self.app_state.rooms.lock().expect("rooms poisoned");
        if let Some(room) = rooms.get_mut(room_id) {
            room.apply_input(player_id, payload);
        }
    }

    fn start_heartbeat(&self, ctx: &mut ws::WebsocketContext<Self>) {
        ctx.run_interval(
            Duration::from_secs(crate::HEARTBEAT_INTERVAL_SECS),
            |actor, ctx| {
                if actor.heartbeat_at.elapsed() > Duration::from_secs(crate::CLIENT_TIMEOUT_SECS) {
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
        let (Some(player_id), Some(room_id)) = (self.player_id.take(), self.room_id.take()) else {
            return;
        };

        let (removed, broadcast_text) = {
            let mut rooms = self.app_state.rooms.lock().expect("rooms poisoned");
            if let Some(room) = rooms.get_mut(&room_id) {
                let removed = room.remove_player(&player_id);
                let text = if removed {
                    serialize_message(
                        "player_left",
                        PlayerLeftPayload {
                            player_id: player_id.clone(),
                        },
                    )
                    .ok()
                } else {
                    None
                };
                (removed, text)
            } else {
                (false, None)
            }
        };

        if removed {
            if let Some(text) = broadcast_text {
                broadcast_to_room(&self.app_state, &room_id, &text);
            }
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

pub(crate) fn broadcast_to_room(app_state: &web::Data<AppState>, room_id: &str, text: &str) {
    let recipients = {
        let rooms = app_state.rooms.lock().expect("rooms poisoned");
        rooms
            .get(room_id)
            .map(|r| r.sessions.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default()
    };

    for recipient in recipients {
        let _ = recipient.try_send(WsText(text.to_string()));
    }
}

pub(crate) fn start_room_loop(app_state: web::Data<AppState>) {
    actix_web::rt::spawn(async move {
        let mut ticker =
            actix_web::rt::time::interval(Duration::from_millis(crate::TICK_INTERVAL_MS));

        loop {
            ticker.tick().await;
            let now = crate::now_ms();

            // 모든 룸을 tick하고 수신자 목록을 수집
            let snapshots: Vec<(Vec<actix::Recipient<WsText>>, String)> = {
                let mut rooms = app_state.rooms.lock().expect("rooms poisoned");
                rooms
                    .iter_mut()
                    .filter_map(|(_, room)| {
                        if room.sessions.is_empty() {
                            return None; // 아무도 없으면 tick 스킵
                        }
                        let snapshot = room.tick(now);
                        let msg = serialize_message("world_snapshot", snapshot)
                            .expect("world_snapshot should serialize");
                        let recipients: Vec<actix::Recipient<WsText>> =
                            room.sessions.values().cloned().collect();
                        Some((recipients, msg))
                    })
                    .collect()
            };

            for (recipients, msg) in snapshots {
                for recipient in recipients {
                    let _ = recipient.try_send(WsText(msg.clone()));
                }
            }

            // 비어있는 매치룸 정리
            {
                let rooms_to_remove: Vec<String> = {
                    let rooms = app_state.rooms.lock().expect("rooms poisoned");
                    rooms
                        .values()
                        .filter(|r| {
                            r.room_type == RoomType::Match
                                && r.sessions.is_empty()
                                && r.empty_since_ms
                                    .is_some_and(|t| now.saturating_sub(t) > EMPTY_ROOM_TTL_MS)
                        })
                        .map(|r| r.room_id.clone())
                        .collect()
                };

                if !rooms_to_remove.is_empty() {
                    let mut rooms = app_state.rooms.lock().expect("rooms poisoned");
                    let mut codes = app_state.room_codes.lock().expect("codes poisoned");
                    for id in &rooms_to_remove {
                        if let Some(room) = rooms.remove(id) {
                            if let Some(code) = room.room_code {
                                codes.remove(&code);
                            }
                        }
                    }
                    log::info!("Removed {} empty match room(s)", rooms_to_remove.len());
                }
            }
        }
    });
}

pub(crate) async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    app_state: web::Data<AppState>,
) -> Result<HttpResponse, Error> {
    let connection_id = app_state.next_connection_id();
    ws::start(WsSession::new(connection_id, app_state), &req, stream)
}
