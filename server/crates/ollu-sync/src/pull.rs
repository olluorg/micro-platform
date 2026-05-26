use ollu_core::{AppId, Operation, UserId};

use crate::router::SyncState;

pub async fn pull(
    _state: &SyncState,
    _user: &UserId,
    _app: &AppId,
    _cursor: Option<String>,
    _limit: i64,
) -> Result<Vec<Operation>, anyhow::Error> {
    anyhow::bail!("pull: not implemented")
}
