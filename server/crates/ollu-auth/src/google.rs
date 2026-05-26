use async_trait::async_trait;

use crate::provider::{AuthProvider, VerifiedIdentity, VerifyError};

pub struct GoogleProvider {
    pub allowed_audiences: Vec<String>,
}

impl GoogleProvider {
    pub fn new(allowed_audiences: Vec<String>) -> Self {
        Self { allowed_audiences }
    }
}

#[async_trait]
impl AuthProvider for GoogleProvider {
    fn id(&self) -> &str {
        "google"
    }

    async fn verify_id_token(&self, _id_token: &str) -> Result<VerifiedIdentity, VerifyError> {
        Err(VerifyError::InvalidToken(
            "GoogleProvider::verify_id_token: not implemented".into(),
        ))
    }
}
