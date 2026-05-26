use serde::{Deserialize, Serialize};

use crate::hlc::Hlc;
use crate::ids::{AppId, OpId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpType {
    Put,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operation {
    pub id: OpId,
    #[serde(rename = "appId")]
    pub app_id: AppId,
    pub store: String,
    pub pk: String,
    #[serde(rename = "type")]
    pub op_type: OpType,
    pub hlc: Hlc,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}
