use base64::Engine;
use rand::RngCore;

pub const SESSION_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const REFRESH_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;

pub fn generate_opaque_token() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}
