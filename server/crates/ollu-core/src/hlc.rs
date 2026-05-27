use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Hybrid logical clock value.
///
/// `node_id` is treated as an opaque string by the server (it only matters as
/// a tiebreaker when (physical, logical) are equal across devices). Clients
/// are free to use whatever shape they like — UUIDs, hex, base32 — as long as
/// they don't contain ASCII '<' (used in serialised form below 0-9/a-f and
/// would break ordering).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Hlc {
    pub physical: u64,
    pub logical: u16,
    pub node_id: String,
}

impl Hlc {
    pub fn new(physical: u64, logical: u16, node_id: impl Into<String>) -> Self {
        Self { physical, logical, node_id: node_id.into() }
    }
}

impl Ord for Hlc {
    fn cmp(&self, other: &Self) -> Ordering {
        self.physical
            .cmp(&other.physical)
            .then(self.logical.cmp(&other.logical))
            .then_with(|| self.node_id.cmp(&other.node_id))
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
        write!(f, "{:012x}-{:04x}-{}", self.physical, self.logical, self.node_id)
    }
}

impl FromStr for Hlc {
    type Err = HlcParseError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        // The node_id segment may itself contain '-' (UUIDs do), so splitn(3)
        // greedily takes the rest of the string after the second separator.
        let mut parts = s.splitn(3, '-');
        let phys = parts.next().ok_or_else(|| HlcParseError::Malformed(s.into()))?;
        let logi = parts.next().ok_or_else(|| HlcParseError::Malformed(s.into()))?;
        let node = parts.next().ok_or_else(|| HlcParseError::Malformed(s.into()))?;
        let physical = u64::from_str_radix(phys, 16)
            .map_err(|_| HlcParseError::Malformed(s.into()))?;
        let logical = u16::from_str_radix(logi, 16)
            .map_err(|_| HlcParseError::Malformed(s.into()))?;
        if node.is_empty() {
            return Err(HlcParseError::Malformed(s.into()));
        }
        Ok(Hlc { physical, logical, node_id: node.to_string() })
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
