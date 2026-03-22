use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcHandshake {
    pub v: i32,
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcMessage {
    pub cmd: String,
    pub args: Option<serde_json::Value>,
    pub nonce: Option<String>,
    pub evt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub cmd: String,
    pub data: Option<serde_json::Value>,
    pub evt: Option<String>,
    pub nonce: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityUpdate {
    pub activity: Option<serde_json::Value>,
    pub pid: Option<i32>,
    pub socket_id: String,
}

impl RpcResponse {
    pub fn new(cmd: &str, data: Option<serde_json::Value>, evt: Option<String>, nonce: Option<String>) -> Self {
        Self {
            cmd: cmd.to_string(),
            data,
            evt,
            nonce,
        }
    }
}
