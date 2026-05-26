use std::time::Duration;

use async_trait::async_trait;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

use crate::jwks::JwksCache;
use crate::provider::{AuthProvider, VerifiedIdentity, VerifyError};

const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS: &[&str] = &["https://accounts.google.com", "accounts.google.com"];

#[derive(Debug, Deserialize)]
struct GoogleClaims {
    sub: String,
    #[serde(default)]
    email: Option<String>,
}

pub struct GoogleProvider {
    allowed_audiences: Vec<String>,
    jwks: JwksCache,
}

impl GoogleProvider {
    pub fn new(allowed_audiences: Vec<String>) -> Self {
        Self {
            allowed_audiences,
            jwks: JwksCache::new(GOOGLE_JWKS_URL, Duration::from_secs(3600)),
        }
    }
}

#[async_trait]
impl AuthProvider for GoogleProvider {
    fn id(&self) -> &str {
        "google"
    }

    async fn verify_id_token(&self, id_token: &str) -> Result<VerifiedIdentity, VerifyError> {
        let header =
            decode_header(id_token).map_err(|e| VerifyError::InvalidToken(e.to_string()))?;
        let kid = header
            .kid
            .ok_or_else(|| VerifyError::InvalidToken("missing kid in header".into()))?;
        let jwks = self.jwks.get().await?;
        let jwk = jwks
            .find(&kid)
            .ok_or_else(|| VerifyError::InvalidToken(format!("kid {kid} not found")))?;
        let decoding_key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
            .map_err(|e| VerifyError::InvalidToken(e.to_string()))?;
        let mut validation = Validation::new(Algorithm::RS256);
        if !self.allowed_audiences.is_empty() {
            validation.set_audience(&self.allowed_audiences);
        } else {
            validation.validate_aud = false;
        }
        validation.set_issuer(GOOGLE_ISSUERS);
        let data = decode::<GoogleClaims>(id_token, &decoding_key, &validation)
            .map_err(|e| VerifyError::InvalidToken(e.to_string()))?;
        Ok(VerifiedIdentity {
            provider: "google".into(),
            subject: data.claims.sub,
            email: data.claims.email,
        })
    }
}
