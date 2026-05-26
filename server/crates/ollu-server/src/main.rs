use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use ollu_auth::{auth_router, google::GoogleProvider, router::AuthState, AuthProvider};
use ollu_functions::functions_router;
use ollu_storage::Storage;
use ollu_sync::{router::SyncState, sync_router, events::EventBus};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite::memory:".into());
    let bind: SocketAddr = std::env::var("BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".into())
        .parse()?;

    let storage = Storage::connect(&database_url).await?;
    let bus = EventBus::default();

    let providers: Vec<Arc<dyn AuthProvider>> = vec![
        Arc::new(GoogleProvider::new(
            std::env::var("GOOGLE_AUDIENCES")
                .unwrap_or_default()
                .split(',')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect(),
        )),
    ];

    let sync_state = SyncState { storage: storage.clone(), bus };
    let auth_state = AuthState { storage, providers: Arc::new(providers) };

    let app = Router::new()
        .nest("/auth", auth_router(auth_state))
        .nest("/sync", sync_router(sync_state))
        .nest("/functions", functions_router())
        .layer(TraceLayer::new_for_http());

    tracing::info!(%bind, "ollu-server listening");
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
