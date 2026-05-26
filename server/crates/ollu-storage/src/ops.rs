use ollu_core::hlc::Hlc;
use ollu_core::{AppId, OpId, OpType, Operation, UserId};

use crate::{now_ms, Storage, StorageError};

#[derive(Debug, sqlx::FromRow)]
struct OpRow {
    seq: i64,
    id: String,
    app_id: String,
    store: String,
    pk: String,
    op_type: String,
    hlc: String,
    payload: Option<String>,
}

impl OpRow {
    fn into_operation(self) -> Result<(i64, Operation), StorageError> {
        let hlc: Hlc = self
            .hlc
            .parse()
            .map_err(|e: ollu_core::HlcParseError| StorageError::Decode(e.to_string()))?;
        let op_type = match self.op_type.as_str() {
            "put" => OpType::Put,
            "delete" => OpType::Delete,
            other => return Err(StorageError::Decode(format!("bad op_type: {other}"))),
        };
        let payload = match self.payload {
            Some(s) => Some(
                serde_json::from_str(&s).map_err(|e| StorageError::Decode(e.to_string()))?,
            ),
            None => None,
        };
        Ok((
            self.seq,
            Operation {
                id: OpId(self.id),
                app_id: AppId(self.app_id),
                store: self.store,
                pk: self.pk,
                op_type,
                hlc,
                payload,
            },
        ))
    }
}

pub struct OpsPage {
    pub ops: Vec<Operation>,
    pub next_cursor: Option<i64>,
}

impl Storage {
    pub async fn insert_ops(
        &self,
        user: &UserId,
        app: &AppId,
        ops: &[Operation],
    ) -> Result<usize, StorageError> {
        if ops.is_empty() {
            return Ok(0);
        }
        let now = now_ms();
        let mut tx = self.pool.begin().await?;
        let mut inserted = 0usize;
        for op in ops {
            let op_type_str = match op.op_type {
                OpType::Put => "put",
                OpType::Delete => "delete",
            };
            let payload_str = match &op.payload {
                Some(v) => Some(
                    serde_json::to_string(v).map_err(|e| StorageError::Decode(e.to_string()))?,
                ),
                None => None,
            };
            let res = sqlx::query(
                "INSERT OR IGNORE INTO operations \
                 (id, user_id, app_id, store, pk, op_type, hlc, payload, received_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&op.id.0)
            .bind(&user.0)
            .bind(&app.0)
            .bind(&op.store)
            .bind(&op.pk)
            .bind(op_type_str)
            .bind(op.hlc.to_string())
            .bind(payload_str)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            if res.rows_affected() > 0 {
                inserted += 1;
            }
        }
        tx.commit().await?;
        Ok(inserted)
    }

    pub async fn ops_since(
        &self,
        user: &UserId,
        app: &AppId,
        cursor: Option<i64>,
        limit: i64,
    ) -> Result<OpsPage, StorageError> {
        let rows: Vec<OpRow> = match cursor {
            Some(c) => {
                sqlx::query_as::<_, OpRow>(
                    "SELECT seq, id, app_id, store, pk, op_type, hlc, payload \
                     FROM operations \
                     WHERE user_id = ? AND app_id = ? AND seq > ? \
                     ORDER BY seq ASC LIMIT ?",
                )
                .bind(&user.0)
                .bind(&app.0)
                .bind(c)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query_as::<_, OpRow>(
                    "SELECT seq, id, app_id, store, pk, op_type, hlc, payload \
                     FROM operations \
                     WHERE user_id = ? AND app_id = ? \
                     ORDER BY seq ASC LIMIT ?",
                )
                .bind(&user.0)
                .bind(&app.0)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
        };
        let mut ops = Vec::with_capacity(rows.len());
        let mut next_cursor = cursor;
        for row in rows {
            let (seq, op) = row.into_operation()?;
            next_cursor = Some(seq);
            ops.push(op);
        }
        Ok(OpsPage { ops, next_cursor })
    }
}
