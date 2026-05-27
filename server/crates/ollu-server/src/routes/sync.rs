use std::convert::Infallible;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream::{SplitSink, StreamExt};
use futures::SinkExt;
use ollu_core::{AppId, Operation, UserId};
use ollu_storage::Storage;
use ollu_sync::{EventBus, Hint};
use serde::{Deserialize, Serialize};
use tokio_stream::wrappers::BroadcastStream;

use crate::error::ApiError;
use crate::extractors::AuthenticatedUser;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/push", post(push))
        .route("/pull", get(pull))
        .route("/events", get(events))
        .route("/socket", get(socket))
}

// ────────────────────────────────────────────────────────────────────────────
// REST: pull / push
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct PullParams {
    #[serde(rename = "appId")]
    app_id: String,
    #[serde(default)]
    cursor: Option<i64>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    1000
}

#[derive(Debug, Serialize)]
struct PullResponse {
    ops: Vec<Operation>,
    #[serde(rename = "nextCursor")]
    next_cursor: Option<i64>,
    #[serde(rename = "hasMore")]
    has_more: bool,
}

async fn pull(
    auth: AuthenticatedUser,
    State(storage): State<Storage>,
    Query(params): Query<PullParams>,
) -> Result<Json<PullResponse>, ApiError> {
    let limit = params.limit.clamp(1, 5000);
    let app = AppId(params.app_id);
    let page = storage
        .ops_since(&auth.user_id, &app, params.cursor, limit)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let has_more = page.ops.len() as i64 == limit;
    Ok(Json(PullResponse {
        ops: page.ops,
        next_cursor: page.next_cursor,
        has_more,
    }))
}

#[derive(Debug, Deserialize)]
struct PushRequest {
    #[serde(rename = "appId")]
    app_id: String,
    ops: Vec<Operation>,
}

#[derive(Debug, Serialize)]
struct PushResponse {
    accepted: usize,
}

async fn push(
    auth: AuthenticatedUser,
    State(storage): State<Storage>,
    State(bus): State<EventBus>,
    Json(req): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    let app = AppId(req.app_id);
    for op in &req.ops {
        if op.app_id != app {
            return Err(ApiError::BadRequest("op.appId mismatches request appId".into()));
        }
    }
    let accepted = storage
        .insert_ops(&auth.user_id, &app, &req.ops)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if accepted > 0 {
        bus.publish(Hint {
            user: auth.user_id.clone(),
            app,
        });
    }
    Ok(Json(PushResponse { accepted }))
}

// ────────────────────────────────────────────────────────────────────────────
// SSE: legacy hint stream (kept for backwards compatibility with older SDK
// builds; new code should prefer /sync/socket which carries ops directly).
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct EventsParams {
    #[serde(rename = "appId")]
    app_id: String,
}

async fn events(
    auth: AuthenticatedUser,
    State(bus): State<EventBus>,
    Query(params): Query<EventsParams>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let want_user = auth.user_id;
    let want_app = AppId(params.app_id);
    let rx = bus.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(move |result| {
        let event = match result {
            Ok(hint) if hint.user == want_user && hint.app == want_app => {
                Event::default().event("hint").json_data(&hint).ok()
            }
            _ => None,
        };
        std::future::ready(event.map(Ok::<_, Infallible>))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ────────────────────────────────────────────────────────────────────────────
// WebSocket: bidirectional ops stream
//
// Browser WebSocket can't send Authorization headers, so the session token
// rides in the `token` query parameter. The current `app_id` is optional in
// the URL — clients usually send a `subscribe` message after connect with
// the appId + last known cursor, which lets the server replay any ops
// missed while the socket was down.
// ────────────────────────────────────────────────────────────────────────────

const SOCKET_BATCH_LIMIT: i64 = 500;

#[derive(Debug, Deserialize)]
struct SocketParams {
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMsg {
    Subscribe {
        #[serde(rename = "appId")]
        app_id: String,
        #[serde(default)]
        since: Option<i64>,
    },
    Push {
        id: String,
        #[serde(rename = "appId")]
        app_id: String,
        ops: Vec<Operation>,
    },
    Ack {
        #[allow(dead_code)]
        cursor: i64,
    },
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ServerMsg {
    Ops {
        ops: Vec<Operation>,
        #[serde(rename = "nextCursor")]
        next_cursor: Option<i64>,
        #[serde(rename = "hasMore")]
        has_more: bool,
    },
    PushAck {
        id: String,
        accepted: usize,
    },
    Error {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        message: String,
    },
    Pong,
}

struct SocketState {
    app_id: Option<AppId>,
    sent_cursor: Option<i64>,
}

async fn socket(
    ws: WebSocketUpgrade,
    Query(params): Query<SocketParams>,
    State(storage): State<Storage>,
    State(bus): State<EventBus>,
) -> Result<Response, ApiError> {
    let session = storage
        .find_session_by_token(&params.token)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::Unauthorized("invalid token".into()))?;
    if session.expires_at < now_ms() {
        return Err(ApiError::Unauthorized("session expired".into()));
    }
    let user_id = UserId(session.user_id);
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, user_id, storage, bus)))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn handle_socket(socket: WebSocket, user_id: UserId, storage: Storage, bus: EventBus) {
    let (mut tx, mut rx) = socket.split();
    let mut bus_rx = bus.subscribe();
    let mut state = SocketState {
        app_id: None,
        sent_cursor: None,
    };
    let mut ping_interval = tokio::time::interval(Duration::from_secs(30));
    ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ping_interval.tick().await; // skip the first immediate tick

    loop {
        tokio::select! {
            biased;
            msg = rx.next() => {
                let Some(msg) = msg else { break };
                let Ok(msg) = msg else { break };
                match msg {
                    Message::Text(text) => {
                        if !handle_client_msg(&text, &mut state, &mut tx, &storage, &bus, &user_id).await {
                            break;
                        }
                    }
                    Message::Binary(_) => {}
                    Message::Ping(payload) => {
                        if tx.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) => break,
                }
            }
            hint = bus_rx.recv() => {
                let Ok(hint) = hint else { continue };
                if hint.user == user_id && Some(&hint.app) == state.app_id.as_ref() {
                    if push_new_ops(&mut tx, &mut state, &storage, &user_id).await.is_err() {
                        break;
                    }
                }
            }
            _ = ping_interval.tick() => {
                if tx.send(Message::Ping(Vec::new())).await.is_err() {
                    break;
                }
            }
        }
    }
}

async fn handle_client_msg(
    text: &str,
    state: &mut SocketState,
    tx: &mut SplitSink<WebSocket, Message>,
    storage: &Storage,
    bus: &EventBus,
    user_id: &UserId,
) -> bool {
    let parsed: Result<ClientMsg, _> = serde_json::from_str(text);
    match parsed {
        Ok(ClientMsg::Subscribe { app_id, since }) => {
            state.app_id = Some(AppId(app_id));
            state.sent_cursor = since;
            // Subscribe must terminate with at least one Ops message so the
            // client knows the initial backlog (possibly empty) is fully
            // delivered and the socket is now in "live" mode.
            replay_for_subscribe(tx, state, storage, user_id).await.is_ok()
        }
        Ok(ClientMsg::Push { id, app_id, ops }) => {
            let app = AppId(app_id);
            for op in &ops {
                if op.app_id != app {
                    return send_msg(
                        tx,
                        &ServerMsg::Error {
                            id: Some(id),
                            message: "op.appId mismatches request appId".into(),
                        },
                    )
                    .await
                    .is_ok();
                }
            }
            match storage.insert_ops(user_id, &app, &ops).await {
                Ok(accepted) => {
                    if accepted > 0 {
                        bus.publish(Hint {
                            user: user_id.clone(),
                            app,
                        });
                    }
                    send_msg(tx, &ServerMsg::PushAck { id, accepted }).await.is_ok()
                }
                Err(e) => send_msg(
                    tx,
                    &ServerMsg::Error {
                        id: Some(id),
                        message: format!("insert failed: {e}"),
                    },
                )
                .await
                .is_ok(),
            }
        }
        Ok(ClientMsg::Ack { .. }) => true,
        Ok(ClientMsg::Ping) => send_msg(tx, &ServerMsg::Pong).await.is_ok(),
        Err(e) => send_msg(
            tx,
            &ServerMsg::Error {
                id: None,
                message: format!("malformed message: {e}"),
            },
        )
        .await
        .is_ok(),
    }
}

async fn send_msg(
    tx: &mut SplitSink<WebSocket, Message>,
    msg: &ServerMsg,
) -> Result<(), axum::Error> {
    let text = serde_json::to_string(msg).map_err(|e| axum::Error::new(e))?;
    tx.send(Message::Text(text)).await
}

/// Called on bus hint: sends an Ops message only when there's actually
/// something new for this connection (avoids empty-message noise).
async fn push_new_ops(
    tx: &mut SplitSink<WebSocket, Message>,
    state: &mut SocketState,
    storage: &Storage,
    user_id: &UserId,
) -> Result<(), axum::Error> {
    let Some(app) = state.app_id.clone() else {
        return Ok(());
    };
    loop {
        let page = storage
            .ops_since(user_id, &app, state.sent_cursor, SOCKET_BATCH_LIMIT)
            .await
            .map_err(|e| axum::Error::new(e))?;
        if page.ops.is_empty() {
            return Ok(());
        }
        let has_more = page.ops.len() as i64 == SOCKET_BATCH_LIMIT;
        let next_cursor = page.next_cursor;
        send_msg(
            tx,
            &ServerMsg::Ops {
                ops: page.ops,
                next_cursor,
                has_more,
            },
        )
        .await?;
        state.sent_cursor = next_cursor;
        if !has_more {
            return Ok(());
        }
    }
}

/// Called from the Subscribe handler: always sends at least one Ops
/// message (possibly empty) so the client knows it's now in live mode.
async fn replay_for_subscribe(
    tx: &mut SplitSink<WebSocket, Message>,
    state: &mut SocketState,
    storage: &Storage,
    user_id: &UserId,
) -> Result<(), axum::Error> {
    let Some(app) = state.app_id.clone() else {
        return Ok(());
    };
    loop {
        let page = storage
            .ops_since(user_id, &app, state.sent_cursor, SOCKET_BATCH_LIMIT)
            .await
            .map_err(|e| axum::Error::new(e))?;
        let has_more = page.ops.len() as i64 == SOCKET_BATCH_LIMIT;
        let next_cursor = page.next_cursor;
        send_msg(
            tx,
            &ServerMsg::Ops {
                ops: page.ops,
                next_cursor,
                has_more,
            },
        )
        .await?;
        if let Some(c) = next_cursor {
            state.sent_cursor = Some(c);
        }
        if !has_more {
            return Ok(());
        }
    }
}
