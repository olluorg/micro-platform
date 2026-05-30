//! Generic OpenAI-compatible LLM proxy ("serverless function").
//!
//! A thin passthrough to a chat-completions endpoint (OpenRouter by default).
//! Callers bring their own provider API key per request, so the server holds no
//! shared secret and the route can stay open. Ported from bkdojo's
//! `api/evaluate.ts`, generalized from `{system, user, schema}` to a full
//! OpenAI-shaped `messages[]` request whose extra fields are forwarded verbatim.

use std::env;

use serde::Deserialize;
use serde_json::{Map, Value};

const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL: &str = "openai/gpt-4o-mini";
const DEFAULT_TITLE: &str = "ollu";
const DEFAULT_MAX_CHARS: usize = 8000;

/// Server-side configuration for the LLM proxy, read once at startup.
#[derive(Debug, Clone)]
pub struct LlmConfig {
    /// Base URL of an OpenAI-compatible API (trailing slash trimmed on use).
    pub base_url: String,
    /// Full completions URL override; when set it wins over `base_url`.
    pub url_override: Option<String>,
    /// Model used when the request omits one.
    pub default_model: String,
    /// `HTTP-Referer` header for OpenRouter attribution.
    pub referer: Option<String>,
    /// `X-Title` header for OpenRouter attribution.
    pub title: String,
    /// Optional fallback key for self-hosting; only used when `allow_server_key`.
    pub server_key: Option<String>,
    /// Whether a request without a provider key may fall back to `server_key`.
    pub allow_server_key: bool,
    /// Reject requests whose message contents exceed this many chars in total.
    pub max_chars: usize,
}

impl LlmConfig {
    /// Build config from environment (mirrors the env knobs of the original
    /// bkdojo proxy: `OPENROUTER_URL` / `OPENROUTER_BASE_URL` / `OPENROUTER_MODEL`
    /// / `OPENROUTER_REFERER` / `OPENROUTER_TITLE`). The shared key is opt-in via
    /// `LLM_ALLOW_SERVER_KEY` so the BYO endpoint stays abuse-safe by default.
    pub fn from_env() -> Self {
        let non_empty = |k: &str| env::var(k).ok().filter(|s| !s.is_empty());
        LlmConfig {
            base_url: non_empty("OPENROUTER_BASE_URL").unwrap_or_else(|| DEFAULT_BASE_URL.into()),
            url_override: non_empty("OPENROUTER_URL"),
            default_model: non_empty("OPENROUTER_MODEL").unwrap_or_else(|| DEFAULT_MODEL.into()),
            referer: non_empty("OPENROUTER_REFERER"),
            title: non_empty("OPENROUTER_TITLE").unwrap_or_else(|| DEFAULT_TITLE.into()),
            allow_server_key: matches!(non_empty("LLM_ALLOW_SERVER_KEY").as_deref(), Some("1" | "true")),
            server_key: non_empty("OPENROUTER_API_KEY"),
            max_chars: DEFAULT_MAX_CHARS,
        }
    }

    fn completions_url(&self) -> String {
        match &self.url_override {
            Some(url) => url.clone(),
            None => format!("{}/chat/completions", self.base_url.trim_end_matches('/')),
        }
    }
}

/// Incoming chat-completion request. OpenAI-shaped; unknown fields (temperature,
/// max_tokens, response_format, …) are captured in `extra` and forwarded upstream.
#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    #[serde(default)]
    pub model: Option<String>,
    pub messages: Vec<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl ChatRequest {
    fn total_chars(&self) -> usize {
        self.messages
            .iter()
            .map(|m| m.get("content").and_then(Value::as_str).map_or(0, str::len))
            .sum()
    }
}

/// Passthrough result: the upstream HTTP status and raw (JSON) response body.
pub struct LlmOutcome {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("missing provider API key")]
    MissingKey,
    #[error("messages must not be empty")]
    NoMessages,
    #[error("messages too large")]
    TooLarge,
    #[error("upstream request failed: {0}")]
    Upstream(#[from] reqwest::Error),
}

/// Forward a chat-completion request to the upstream provider with the caller's
/// key and return the response verbatim. If `response_format` is present and the
/// upstream call fails (some providers reject json_schema, occasionally as a
/// 5xx), retry once without it — JSON-demanding prompts ask for it in-band too.
pub async fn complete(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    key: &str,
    req: ChatRequest,
) -> Result<LlmOutcome, LlmError> {
    if key.is_empty() {
        return Err(LlmError::MissingKey);
    }
    if req.messages.is_empty() {
        return Err(LlmError::NoMessages);
    }
    if req.total_chars() > cfg.max_chars {
        return Err(LlmError::TooLarge);
    }

    let url = cfg.completions_url();
    let model = req.model.unwrap_or_else(|| cfg.default_model.clone());
    let has_schema = req.extra.contains_key("response_format");

    let mut payload = Map::new();
    payload.insert("model".into(), Value::String(model));
    payload.insert("messages".into(), Value::Array(req.messages));
    for (k, v) in req.extra {
        payload.insert(k, v);
    }

    let send = |body: Map<String, Value>| {
        let mut rb = client.post(&url).bearer_auth(key).header("X-Title", &cfg.title);
        if let Some(referer) = &cfg.referer {
            rb = rb.header("HTTP-Referer", referer);
        }
        rb.json(&Value::Object(body)).send()
    };

    let resp = if has_schema {
        let first = send(payload.clone()).await?;
        if first.status().is_success() {
            first
        } else {
            payload.remove("response_format");
            send(payload).await?
        }
    } else {
        send(payload).await?
    };

    let status = resp.status().as_u16();
    let body = resp.text().await?;
    Ok(LlmOutcome { status, body })
}
