use ollu_core::{AppId, Operation, UserId};

use crate::router::SyncState;

pub async fn push(
    _state: &SyncState,
    _user: &UserId,
    _app: &AppId,
    _ops: Vec<Operation>,
) -> Result<usize, anyhow::Error> {
    anyhow::bail!("push: not implemented")
}
