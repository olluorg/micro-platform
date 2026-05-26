use std::sync::Arc;

use ollu_core::{AppId, UserId};
use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
pub struct Hint {
    pub user: UserId,
    #[serde(rename = "appId")]
    pub app: AppId,
}

#[derive(Clone)]
pub struct EventBus {
    inner: Arc<broadcast::Sender<Hint>>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _rx) = broadcast::channel(capacity);
        Self { inner: Arc::new(tx) }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Hint> {
        self.inner.subscribe()
    }

    pub fn publish(&self, hint: Hint) {
        let _ = self.inner.send(hint);
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(1024)
    }
}
