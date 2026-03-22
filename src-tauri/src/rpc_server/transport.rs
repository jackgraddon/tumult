use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;

#[async_trait]
pub trait RpcTransport: Send + Sync {
    async fn send(&self, msg: Value) -> Result<(), Box<dyn std::error::Error>>;
    fn socket_id(&self) -> String;
    fn client_id(&self) -> String;
    fn set_client_id(&self, client_id: String);
    fn set_metadata(&self, key: &str, value: Value);
    fn get_metadata(&self, key: &str) -> Option<Value>;
    async fn close(&self) -> Result<(), Box<dyn std::error::Error>>;
}

pub struct SocketContext {
    pub socket_id: String,
    pub client_id: Mutex<String>,
    pub metadata: Mutex<std::collections::HashMap<String, Value>>,
}

impl SocketContext {
    pub fn new(socket_id: String, client_id: String) -> Self {
        Self {
            socket_id,
            client_id: Mutex::new(client_id),
            metadata: Mutex::new(std::collections::HashMap::new()),
        }
    }
}
