use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{post, get};
use axum::{Json, Router};
use ollu_auth::{generate_opaque_token, REFRESH_TTL_SECONDS, SESSION_TTL_SECONDS};
use ollu_core::UserId;
use ollu_storage::Storage;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::extractors::AuthenticatedUser;
use crate::state::{AppState, AuthProviders};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sessions", post(create_session))
        .route("/sessions/current", get(current_session).delete(delete_current_session))
        .route("/sessions/refresh", post(refresh_session))
}

#[derive(Debug, Deserialize)]
struct CreateSessionRequest {
    provider: String,
    #[serde(rename = "idToken")]
    id_token: String,
}

#[derive(Debug, Serialize)]
struct SessionUser {
    id: String,
    email: String,
}

#[derive(Debug, Serialize)]
struct SessionResponse {
    #[serde(rename = "sessionToken")]
    session_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    user: SessionUser,
    #[serde(rename = "expiresAt")]
    expires_at: i64,
}

async fn create_session(
    State(storage): State<Storage>,
    State(providers): State<AuthProviders>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    let provider = providers
        .0
        .iter()
        .find(|p| p.id() == req.provider)
        .cloned()
        .ok_or_else(|| ApiError::BadRequest(format!("unknown provider: {}", req.provider)))?;
    let identity = provider
        .verify_id_token(&req.id_token)
        .await
        .map_err(|e| ApiError::Unauthorized(format!("id_token verification failed: {e}")))?;
    let user = storage
        .upsert_user(&identity.provider, &identity.subject, identity.email.as_deref())
        .await
        .map_err(|e| ApiError::Internal(format!("upsert_user: {e}")))?;
    let session_token = generate_opaque_token();
    let refresh_token = generate_opaque_token();
    let user_id = UserId(user.id.clone());
    let record = storage
        .create_session(
            &user_id,
            &session_token,
            &refresh_token,
            SESSION_TTL_SECONDS,
            REFRESH_TTL_SECONDS,
        )
        .await
        .map_err(|e| ApiError::Internal(format!("create_session: {e}")))?;
    Ok(Json(SessionResponse {
        session_token,
        refresh_token,
        user: SessionUser {
            id: user.id,
            email: user.email.unwrap_or_default(),
        },
        expires_at: record.expires_at,
    }))
}

#[derive(Debug, Deserialize)]
struct RefreshRequest {
    #[serde(rename = "refreshToken")]
    refresh_token: String,
}

async fn refresh_session(
    State(storage): State<Storage>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    let session = storage
        .find_session_by_refresh(&req.refresh_token)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::Unauthorized("refresh token not found".into()))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if session.refresh_expires_at < now {
        return Err(ApiError::Unauthorized("refresh token expired".into()));
    }
    storage
        .delete_session_record(&session.token_hash)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let user = storage
        .find_user(&UserId(session.user_id.clone()))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::Internal("user not found after refresh".into()))?;
    let new_session_token = generate_opaque_token();
    let new_refresh_token = generate_opaque_token();
    let user_id = UserId(user.id.clone());
    let record = storage
        .create_session(
            &user_id,
            &new_session_token,
            &new_refresh_token,
            SESSION_TTL_SECONDS,
            REFRESH_TTL_SECONDS,
        )
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(SessionResponse {
        session_token: new_session_token,
        refresh_token: new_refresh_token,
        user: SessionUser {
            id: user.id,
            email: user.email.unwrap_or_default(),
        },
        expires_at: record.expires_at,
    }))
}

async fn current_session(
    auth: AuthenticatedUser,
    State(storage): State<Storage>,
) -> Result<Json<SessionUser>, ApiError> {
    let user = storage
        .find_user(&auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("user".into()))?;
    Ok(Json(SessionUser {
        id: user.id,
        email: user.email.unwrap_or_default(),
    }))
}

async fn delete_current_session(
    auth: AuthenticatedUser,
    State(storage): State<Storage>,
) -> Result<StatusCode, ApiError> {
    storage
        .delete_session_record(&auth.token_hash)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
