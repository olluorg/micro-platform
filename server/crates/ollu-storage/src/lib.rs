use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use thiserror::Error;

pub mod ops;
pub mod sessions;
pub mod users;

pub use sessions::{hash_token, SessionRecord};
pub use users::UserRecord;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("sqlx: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("decode: {0}")]
    Decode(String),
}

#[derive(Clone)]
pub struct Storage {
    pub pool: SqlitePool,
}

impl Storage {
    pub async fn connect(database_url: &str) -> Result<Self, StorageError> {
        let opts = SqliteConnectOptions::from_str(database_url)
            .map_err(|e| StorageError::Decode(e.to_string()))?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(opts)
            .await?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> Result<(), StorageError> {
        sqlx::migrate!("../../migrations")
            .run(&self.pool)
            .await
            .map_err(|e| StorageError::Sqlx(sqlx::Error::Migrate(Box::new(e))))?;
        Ok(())
    }
}

pub(crate) fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
