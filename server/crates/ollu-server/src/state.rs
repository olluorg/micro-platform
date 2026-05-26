use std::sync::Arc;

use axum::extract::FromRef;
use ollu_auth::AuthProvider;
use ollu_storage::Storage;
use ollu_sync::EventBus;

#[derive(Clone)]
pub struct AuthProviders(pub Arc<Vec<Arc<dyn AuthProvider>>>);

#[derive(Clone)]
pub struct AppState {
    pub storage: Storage,
    pub bus: EventBus,
    pub providers: AuthProviders,
}

impl FromRef<AppState> for Storage {
    fn from_ref(state: &AppState) -> Self {
        state.storage.clone()
    }
}

impl FromRef<AppState> for EventBus {
    fn from_ref(state: &AppState) -> Self {
        state.bus.clone()
    }
}

impl FromRef<AppState> for AuthProviders {
    fn from_ref(state: &AppState) -> Self {
        state.providers.clone()
    }
}
