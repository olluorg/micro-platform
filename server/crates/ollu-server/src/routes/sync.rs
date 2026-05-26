use std::convert::Infallible;

use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream::StreamExt;
use ollu_core::{AppId, Operation};
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
}

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
