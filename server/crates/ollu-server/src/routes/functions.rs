use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use ollu_functions::{complete, ChatRequest, LlmConfig, LlmError};

use crate::error::ApiError;
use crate::state::AppState;

/// Header carrying the caller's own provider API key (BYO). A dedicated header
/// avoids clashing with the platform's session `Authorization` bearer.
const PROVIDER_KEY_HEADER: &str = "x-provider-key";
/// Optional header letting the caller pick the upstream provider's base URL
/// (e.g. OpenAI vs OpenRouter vs a gateway). Validated against the allowlist.
const PROVIDER_BASE_URL_HEADER: &str = "x-provider-base-url";

pub fn router() -> Router<AppState> {
    Router::new().route("/llm", post(llm))
}

/// Open, BYO-key passthrough to an OpenAI-compatible chat-completions endpoint.
/// Returns the upstream status and body verbatim.
async fn llm(
    State(http): State<reqwest::Client>,
    State(cfg): State<Arc<LlmConfig>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let header_key = headers
        .get(PROVIDER_KEY_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let key = match header_key {
        Some(k) => k.to_string(),
        // Optional self-host fallback; off unless LLM_ALLOW_SERVER_KEY is set.
        None if cfg.allow_server_key => cfg
            .server_key
            .clone()
            .ok_or_else(|| ApiError::Unauthorized("missing provider API key".into()))?,
        None => return Err(ApiError::Unauthorized("missing provider API key".into())),
    };

    let base_url = headers
        .get(PROVIDER_BASE_URL_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let req: ChatRequest = serde_json::from_slice(&body)
        .map_err(|e| ApiError::BadRequest(format!("invalid request body: {e}")))?;

    let outcome = complete(&http, &cfg, &key, base_url, req).await.map_err(map_err)?;

    let status = StatusCode::from_u16(outcome.status).unwrap_or(StatusCode::BAD_GATEWAY);
    Ok((status, [(header::CONTENT_TYPE, "application/json")], outcome.body).into_response())
}

fn map_err(e: LlmError) -> ApiError {
    match e {
        LlmError::MissingKey => ApiError::Unauthorized("missing provider API key".into()),
        LlmError::ForbiddenBaseUrl => ApiError::BadRequest("provider base URL is not allowed".into()),
        LlmError::NoMessages => ApiError::BadRequest("messages must not be empty".into()),
        LlmError::TooLarge => ApiError::BadRequest("messages too large".into()),
        LlmError::Upstream(err) => ApiError::Internal(format!("upstream request failed: {err}")),
    }
}
