mod error;
mod extractors;
mod routes;
mod state;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use ollu_auth::{google::GoogleProvider, AuthProvider};
use ollu_storage::Storage;
use ollu_sync::EventBus;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::state::{AppState, AuthProviders};

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
    storage.migrate().await?;

    let audiences: Vec<String> = std::env::var("GOOGLE_AUDIENCES")
        .unwrap_or_default()
        .split(',')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let providers: Vec<Arc<dyn AuthProvider>> =
        vec![Arc::new(GoogleProvider::new(audiences.clone()))];
    if audiences.is_empty() {
        tracing::warn!(
            "GOOGLE_AUDIENCES is empty: id_token audience validation is disabled. \
             Set it to your Google OAuth client_id(s)."
        );
    }

    let state = AppState {
        storage,
        bus: EventBus::default(),
        providers: AuthProviders(Arc::new(providers)),
    };

    let app = Router::new()
        .merge(routes::root::router())
        .nest("/auth", routes::auth::router())
        .nest("/sync", routes::sync::router())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!(%bind, "ollu-server listening");
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
