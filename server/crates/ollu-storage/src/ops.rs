use ollu_core::{AppId, Operation, UserId};

use crate::{Storage, StorageError};

impl Storage {
    pub async fn insert_ops(
        &self,
        _user: &UserId,
        _app: &AppId,
        _ops: &[Operation],
    ) -> Result<usize, StorageError> {
        Err(StorageError::Sqlx(sqlx::Error::Protocol(
            "Storage::insert_ops: not implemented".into(),
        )))
    }

    pub async fn ops_since(
        &self,
        _user: &UserId,
        _app: &AppId,
        _cursor: Option<&str>,
        _limit: i64,
    ) -> Result<Vec<Operation>, StorageError> {
        Err(StorageError::Sqlx(sqlx::Error::Protocol(
            "Storage::ops_since: not implemented".into(),
        )))
    }
}
