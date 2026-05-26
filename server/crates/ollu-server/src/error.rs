use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    NotFound(String),
    Internal(String),
}

impl ApiError {
    fn parts(&self) -> (StatusCode, &str) {
        match self {
            Self::BadRequest(m) => (StatusCode::BAD_REQUEST, m.as_str()),
            Self::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m.as_str()),
            Self::NotFound(m) => (StatusCode::NOT_FOUND, m.as_str()),
            Self::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.as_str()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = self.parts();
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = %message, "internal error");
        }
        (status, Json(json!({ "error": message }))).into_response()
    }
}
