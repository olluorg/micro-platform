use axum::Router;
use ollu_storage::Storage;

#[derive(Clone)]
pub struct SyncState {
    pub storage: Storage,
    pub bus: crate::events::EventBus,
}

pub fn sync_router(_state: SyncState) -> Router {
    Router::new()
}
