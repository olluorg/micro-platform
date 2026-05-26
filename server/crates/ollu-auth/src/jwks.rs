use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::RwLock;

use crate::provider::VerifyError;

#[derive(Debug, Clone, Deserialize)]
pub struct Jwk {
    pub kid: String,
    pub n: String,
    pub e: String,
    #[serde(default)]
    pub alg: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwkSet {
    pub keys: Vec<Jwk>,
}

impl JwkSet {
    pub fn find(&self, kid: &str) -> Option<&Jwk> {
        self.keys.iter().find(|k| k.kid == kid)
    }
}

pub struct JwksCache {
    url: String,
    ttl: Duration,
    inner: RwLock<Option<(JwkSet, Instant)>>,
}

impl JwksCache {
    pub fn new(url: impl Into<String>, ttl: Duration) -> Self {
        Self {
            url: url.into(),
            ttl,
            inner: RwLock::new(None),
        }
    }

    pub async fn get(&self) -> Result<JwkSet, VerifyError> {
        {
            let guard = self.inner.read().await;
            if let Some((set, fetched_at)) = guard.as_ref() {
                if fetched_at.elapsed() < self.ttl {
                    return Ok(set.clone());
                }
            }
        }
        let resp = reqwest::get(&self.url)
            .await
            .map_err(|e| VerifyError::Network(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(VerifyError::Network(format!(
                "JWKS fetch failed: {}",
                resp.status()
            )));
        }
        let set: JwkSet = resp
            .json()
            .await
            .map_err(|e| VerifyError::Network(e.to_string()))?;
        let mut guard = self.inner.write().await;
        *guard = Some((set.clone(), Instant::now()));
        Ok(set)
    }
}
