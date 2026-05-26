use std::sync::Arc;

use axum::Router;
use ollu_storage::Storage;

use crate::provider::AuthProvider;

#[derive(Clone)]
pub struct AuthState {
    pub storage: Storage,
    pub providers: Arc<Vec<Arc<dyn AuthProvider>>>,
}

pub fn auth_router(_state: AuthState) -> Router {
    Router::new()
}
