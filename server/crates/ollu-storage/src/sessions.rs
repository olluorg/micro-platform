use base64::Engine;
use ollu_core::UserId;
use sha2::{Digest, Sha256};

use crate::{now_ms, Storage, StorageError};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SessionRecord {
    pub token_hash: String,
    pub user_id: String,
    pub refresh_hash: String,
    pub expires_at: i64,
    pub refresh_expires_at: i64,
    pub created_at: i64,
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

impl Storage {
    pub async fn create_session(
        &self,
        user_id: &UserId,
        session_token: &str,
        refresh_token: &str,
        ttl_seconds: i64,
        refresh_ttl_seconds: i64,
    ) -> Result<SessionRecord, StorageError> {
        let token_hash = hash_token(session_token);
        let refresh_hash = hash_token(refresh_token);
        let now = now_ms();
        let expires_at = now + ttl_seconds * 1000;
        let refresh_expires_at = now + refresh_ttl_seconds * 1000;
        sqlx::query(
            "INSERT INTO sessions \
             (token_hash, user_id, refresh_hash, expires_at, refresh_expires_at, created_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&token_hash)
        .bind(&user_id.0)
        .bind(&refresh_hash)
        .bind(expires_at)
        .bind(refresh_expires_at)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(SessionRecord {
            token_hash,
            user_id: user_id.0.clone(),
            refresh_hash,
            expires_at,
            refresh_expires_at,
            created_at: now,
        })
    }

    pub async fn find_session_by_token(
        &self,
        session_token: &str,
    ) -> Result<Option<SessionRecord>, StorageError> {
        let token_hash = hash_token(session_token);
        Ok(sqlx::query_as::<_, SessionRecord>(
            "SELECT token_hash, user_id, refresh_hash, expires_at, refresh_expires_at, created_at \
             FROM sessions WHERE token_hash = ?",
        )
        .bind(&token_hash)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn find_session_by_refresh(
        &self,
        refresh_token: &str,
    ) -> Result<Option<SessionRecord>, StorageError> {
        let refresh_hash = hash_token(refresh_token);
        Ok(sqlx::query_as::<_, SessionRecord>(
            "SELECT token_hash, user_id, refresh_hash, expires_at, refresh_expires_at, created_at \
             FROM sessions WHERE refresh_hash = ?",
        )
        .bind(&refresh_hash)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn delete_session_by_token(&self, session_token: &str) -> Result<(), StorageError> {
        let token_hash = hash_token(session_token);
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
            .bind(&token_hash)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_session_record(&self, token_hash: &str) -> Result<(), StorageError> {
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
            .bind(token_hash)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
