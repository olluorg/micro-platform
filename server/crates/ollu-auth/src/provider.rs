use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct VerifiedIdentity {
    pub provider: String,
    pub subject: String,
    pub email: Option<String>,
}

#[derive(Debug, Error)]
pub enum VerifyError {
    #[error("invalid token: {0}")]
    InvalidToken(String),
    #[error("network: {0}")]
    Network(String),
}

#[async_trait]
pub trait AuthProvider: Send + Sync {
    fn id(&self) -> &str;
    async fn verify_id_token(&self, id_token: &str) -> Result<VerifiedIdentity, VerifyError>;
}
