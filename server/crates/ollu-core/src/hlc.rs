use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Hlc {
    pub physical: u64,
    pub logical: u16,
    pub node_id: [u8; 8],
}

impl Hlc {
    pub fn new(physical: u64, logical: u16, node_id: [u8; 8]) -> Self {
        Self { physical, logical, node_id }
    }
}

impl Ord for Hlc {
    fn cmp(&self, other: &Self) -> Ordering {
        self.physical
            .cmp(&other.physical)
            .then(self.logical.cmp(&other.logical))
            .then(self.node_id.cmp(&other.node_id))
    }
}

impl PartialOrd for Hlc {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Error)]
pub enum HlcParseError {
    #[error("malformed HLC: {0}")]
    Malformed(String),
}

impl fmt::Display for Hlc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:012x}-{:04x}-{}",
            self.physical,
            self.logical,
            hex_encode(&self.node_id)
        )
    }
}

impl FromStr for Hlc {
    type Err = HlcParseError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut parts = s.splitn(3, '-');
        let phys = parts.next().ok_or_else(|| HlcParseError::Malformed(s.into()))?;
        let logi = parts.next().ok_or_else(|| HlcParseError::Malformed(s.into()))?;
        let node = parts.next().ok_or_else(|| HlcParseError::Malformed(s.into()))?;
        let physical = u64::from_str_radix(phys, 16).map_err(|_| HlcParseError::Malformed(s.into()))?;
        let logical = u16::from_str_radix(logi, 16).map_err(|_| HlcParseError::Malformed(s.into()))?;
        let node_id = hex_decode_8(node).ok_or_else(|| HlcParseError::Malformed(s.into()))?;
        Ok(Hlc { physical, logical, node_id })
    }
}

impl Serialize for Hlc {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        ser.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Hlc {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn hex_decode_8(s: &str) -> Option<[u8; 8]> {
    if s.len() != 16 {
        return None;
    }
    let mut out = [0u8; 8];
    for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk).ok()?;
        out[i] = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(out)
}
