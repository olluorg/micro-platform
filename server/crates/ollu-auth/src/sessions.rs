use ollu_core::UserId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_token: String,
    pub refresh_token: String,
    pub user_id: UserId,
    pub expires_at: i64,
}

pub fn issue_session(_user: &UserId) -> Session {
    unimplemented!("issue_session: not implemented")
}
