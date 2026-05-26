use ollu_core::UserId;
use uuid::Uuid;

use crate::{now_ms, Storage, StorageError};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserRecord {
    pub id: String,
    pub provider: String,
    pub subject: String,
    pub email: Option<String>,
    pub created_at: i64,
}

impl Storage {
    pub async fn upsert_user(
        &self,
        provider: &str,
        subject: &str,
        email: Option<&str>,
    ) -> Result<UserRecord, StorageError> {
        let existing: Option<UserRecord> = sqlx::query_as::<_, UserRecord>(
            "SELECT id, provider, subject, email, created_at FROM users \
             WHERE provider = ? AND subject = ?",
        )
        .bind(provider)
        .bind(subject)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(user) = existing {
            if email.is_some() && email != user.email.as_deref() {
                sqlx::query("UPDATE users SET email = ? WHERE id = ?")
                    .bind(email)
                    .bind(&user.id)
                    .execute(&self.pool)
                    .await?;
            }
            return Ok(user);
        }

        let id = Uuid::new_v4().to_string();
        let created_at = now_ms();
        sqlx::query(
            "INSERT INTO users (id, provider, subject, email, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(provider)
        .bind(subject)
        .bind(email)
        .bind(created_at)
        .execute(&self.pool)
        .await?;

        Ok(UserRecord {
            id,
            provider: provider.to_string(),
            subject: subject.to_string(),
            email: email.map(String::from),
            created_at,
        })
    }

    pub async fn find_user(&self, user_id: &UserId) -> Result<Option<UserRecord>, StorageError> {
        Ok(sqlx::query_as::<_, UserRecord>(
            "SELECT id, provider, subject, email, created_at FROM users WHERE id = ?",
        )
        .bind(&user_id.0)
        .fetch_optional(&self.pool)
        .await?)
    }
}
