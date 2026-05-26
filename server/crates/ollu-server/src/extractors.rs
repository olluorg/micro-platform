use async_trait::async_trait;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use ollu_core::UserId;
use ollu_storage::{hash_token, Storage};

use crate::error::ApiError;

pub struct AuthenticatedUser {
    pub user_id: UserId,
    pub token_hash: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthenticatedUser
where
    S: Send + Sync,
    Storage: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let storage = Storage::from_ref(state);
        let token = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| ApiError::Unauthorized("missing Bearer token".into()))?;
        let session = storage
            .find_session_by_token(token)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?
            .ok_or_else(|| ApiError::Unauthorized("session not found".into()))?;
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if session.expires_at < now_ms {
            return Err(ApiError::Unauthorized("session expired".into()));
        }
        Ok(AuthenticatedUser {
            user_id: UserId(session.user_id),
            token_hash: hash_token(token),
        })
    }
}
