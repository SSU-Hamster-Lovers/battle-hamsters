use actix::{Actor, ActorContext, AsyncContext, Handler, Message, StreamHandler};
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::{
    serialize_message, ErrorPayload, IncomingEnvelope, JoinRoomPayload, PingPayload,
    PlayerInputPayload, PlayerJoinedPayload, PlayerLeftPayload, RoomState, WelcomePayload,
    SERVER_VERSION,
};

pub(crate) struct AppState {
    pub(crate) room: Arc<Mutex<RoomState>>,
    next_connection_id: AtomicU64,
    next_player_id: AtomicU64,
}

impl AppState {
    pub(crate) fn new() -> Self {
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
pub(crate) struct WsText(pub String);

pub(crate) struct WsSession {
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
        if payload.room_id != crate::room_id() {
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

pub(crate) fn broadcast_to_room(app_state: &web::Data<AppState>, text: &str) {
    let recipients = {
        let room = app_state.room.lock().expect("room mutex poisoned");
        room.sessions.values().cloned().collect::<Vec<_>>()
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
            let message = {
                let mut room = app_state.room.lock().expect("room mutex poisoned");
                let snapshot = room.tick(crate::now_ms());
                serialize_message("world_snapshot", snapshot)
                    .expect("world_snapshot should serialize")
            };
            broadcast_to_room(&app_state, &message);
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
