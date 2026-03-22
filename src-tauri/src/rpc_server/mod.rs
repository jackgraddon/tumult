use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use crate::rpc_server::transport::RpcTransport;

pub mod transport;
pub mod ipc;
pub mod ws;

#[derive(Clone, Debug)]
pub enum RpcEvent {
    Activity(Value),
    Connection(String), // socket_id
    Disconnection(String), // socket_id
}

pub struct RpcServer {
    pub sockets: Arc<Mutex<HashMap<String, Arc<dyn RpcTransport>>>>,
    pub event_tx: broadcast::Sender<RpcEvent>,
    user_info: Arc<Mutex<Value>>,
}

impl RpcServer {
    pub fn new(user_id: String, username: String, avatar: Option<String>) -> Self {
        let (event_tx, _) = broadcast::channel(100);
        let user_info = json!({
            "id": user_id,
            "username": username,
            "discriminator": "0",
            "global_name": username,
            "avatar": avatar.unwrap_or_else(|| "cfefa4d9839fb4bdf030f91c2a13e95c".to_string()),
            "bot": false,
            "flags": 0,
            "premium_type": 0
        });

        Self {
            sockets: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            user_info: Arc::new(Mutex::new(user_info)),
        }
    }

    pub async fn handle_connection(&self, transport: Arc<dyn RpcTransport>) {
        let socket_id = transport.socket_id();
        {
            let mut sockets = self.sockets.lock().await;
            sockets.insert(socket_id.clone(), transport.clone());
        }
        let _ = self.event_tx.send(RpcEvent::Connection(socket_id));
    }

    pub async fn send_ready(&self, transport: Arc<dyn RpcTransport>) {
        let user = self.user_info.lock().await.clone();
        let ready_msg = json!({
            "cmd": "DISPATCH",
            "data": {
                "v": 1,
                "config": {
                    "cdn_host": "cdn.discordapp.com",
                    "api_endpoint": "//discord.com/api",
                    "environment": "production"
                },
                "user": user
            },
            "evt": "READY",
            "nonce": null
        });

        if let Err(e) = transport.send(ready_msg).await {
            log::error!("[rpc-server] Failed to send READY to {}: {}", transport.socket_id(), e);
        }
    }

    pub async fn handle_message(&self, transport: Arc<dyn RpcTransport>, msg: Value) {
        if let Some(cmd) = msg.get("cmd").and_then(|v| v.as_str()) {
            match cmd {
                "SET_ACTIVITY" => {
                    let mut activity = msg.get("args")
                        .and_then(|args| args.get("activity"))
                        .cloned()
                        .unwrap_or(Value::Null);

                    if let Some(act_obj) = activity.as_object_mut() {
                        if let Some(timestamps) = act_obj.get_mut("timestamps") {
                            if let Some(ts_obj) = timestamps.as_object_mut() {
                                for key in ["start", "end"] {
                                    if let Some(ts_val) = ts_obj.get_mut(key) {
                                        if let Some(ts_int) = ts_val.as_u64() {
                                            let ts_str = ts_int.to_string();
                                            let now = std::time::SystemTime::now()
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .unwrap_or_else(|_| std::time::Duration::from_secs(0))
                                                .as_millis()
                                                .to_string();

                                            // 1:1 JS logic: if Date.now().toString().length - timestamps[x].toString().length > 2
                                            if now.len() as i32 - ts_str.len() as i32 > 2 {
                                                // Likely in seconds, but Discord expects milliseconds for some reason in JS?
                                                // Actually Discord usually expects milliseconds in the payload for rich presence start/end.
                                                // If it's too short, it's probably seconds. arRPC doesn't seem to modify it?
                                                // Let's re-read the guide: "replicate the timestamp normalization logic: if Date.now().toString().length - timestamps[x].toString().length > 2"
                                                // In the JS arRPC:
                                                // if (Date.now().toString().length - timestamps[x].toString().length > 2) timestamps[x] = Math.floor(timestamps[x] * 1000);
                                                *ts_val = json!(ts_int * 1000);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let payload = json!({
                        "activity": activity,
                        "application_id": transport.client_id(),
                    });

                    let _ = self.event_tx.send(RpcEvent::Activity(payload));
                }
                "SUBSCRIBE" => {
                   // arRPC doesn't usually do much here but we could track subscriptions
                }
                _ => {
                    log::debug!("[rpc-server] Unhandled cmd: {}", cmd);
                }
            }
        }
    }

    pub async fn handle_disconnection(&self, socket_id: String) {
        {
            let mut sockets = self.sockets.lock().await;
            sockets.remove(&socket_id);
        }
        let _ = self.event_tx.send(RpcEvent::Disconnection(socket_id));
    }

    pub async fn stop(&self) {
        let sockets = {
            let mut sockets = self.sockets.lock().await;
            sockets.drain().collect::<Vec<_>>()
        };

        for (_, transport) in sockets {
            let _ = transport.close().await;
        }
    }
}
