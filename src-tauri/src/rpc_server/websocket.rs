use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use log::{info, error, debug};
use tokio_util::sync::CancellationToken;
use std::sync::Mutex;

pub async fn start_websocket_server(
    app: AppHandle,
    cancel_token: CancellationToken,
    user_id: String,
    user_name: String,
    avatar: Option<String>,
) {
    for port in 6463..=6472 {
        let addr = format!("127.0.0.1:{}", port);
        match TcpListener::bind(&addr).await {
            Ok(listener) => {
                info!("[rpc-ws] Listening on {}", addr);
                let app_handle = app.clone();
                let cancel_handle = cancel_token.clone();
                let user_id_c = user_id.clone();
                let user_name_c = user_name.clone();
                let avatar_c = avatar.clone();

                tokio::spawn(async move {
                    loop {
                        tokio::select! {
                            _ = cancel_handle.cancelled() => {
                                info!("[rpc-ws] WebSocket server stopping...");
                                break;
                            }
                            result = listener.accept() => {
                                match result {
                                    Ok((stream, addr)) => {
                                        debug!("[rpc-ws] New TCP connection from {}", addr);
                                        let app = app_handle.clone();
                                        let cancel = cancel_handle.clone();
                                        let uid = user_id_c.clone();
                                        let uname = user_name_c.clone();
                                        let av = avatar_c.clone();
                                        tokio::spawn(async move {
                                            handle_ws_connection(stream, app, cancel, uid, uname, av).await;
                                        });
                                    }
                                    Err(e) => {
                                        error!("[rpc-ws] Error: {}", e);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                });
                return;
            }
            Err(_) => continue,
        }
    }
}

async fn handle_ws_connection(
    stream: tokio::net::TcpStream,
    app: AppHandle,
    cancel_token: CancellationToken,
    user_id: String,
    user_name: String,
    avatar: Option<String>,
) {
    let client_id = Arc::new(Mutex::new(String::new()));
    let client_id_capture = client_id.clone();

    // Use accept_hdr_async to capture the client_id from the query parameters
    let callback = move |req: &Request, response: Response| {
        let uri = req.uri();
        debug!("[rpc-ws] Handshake request URI: {}", uri);
        if let Some(query) = uri.query() {
            for pair in query.split('&') {
                let mut parts = pair.split('=');
                if let (Some("client_id"), Some(val)) = (parts.next(), parts.next()) {
                    let mut cid = client_id_capture.lock().unwrap();
                    *cid = val.to_string();
                }
            }
        }
        Ok(response)
    };

    match accept_hdr_async(stream, callback).await {
        Ok(mut ws_stream) => {
            let cid = client_id.lock().unwrap().clone();
            info!("[rpc-ws] New connection (client_id: {})", cid);

            // Immediately send the READY event as arRPC does
            let ready = json!({
                "cmd": "DISPATCH",
                "data": {
                    "v": 1,
                    "config": {
                        "cdn_host": "cdn.discordapp.com",
                        "api_endpoint": "//discord.com/api",
                        "environment": "production"
                    },
                    "user": {
                        "id": user_id,
                        "username": user_name,
                        "discriminator": "0",
                        "global_name": user_name,
                        "avatar": avatar,
                        "bot": false,
                        "flags": 0,
                        "premium_type": 0,
                    }
                },
                "evt": "READY",
                "nonce": null
            });

            if let Err(e) = ws_stream.send(Message::Text(ready.to_string().into())).await {
                error!("[rpc-ws] Failed to send READY: {}", e);
                return;
            }

            loop {
                tokio::select! {
                    _ = cancel_token.cancelled() => {
                        break;
                    }
                    msg = ws_stream.next() => {
                        match msg {
                            Some(Ok(Message::Text(text))) => {
                                debug!("[rpc-ws] Received message: {}", text);
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                    let cmd = value["cmd"].as_str().unwrap_or("");
                                    let nonce = value["nonce"].as_str();

                                    if cmd == "SET_ACTIVITY" {
                                        let args = value["args"].clone();

                                        let _ = app.emit("arrpc-activity", json!({
                                            "activity": args["activity"],
                                            "pid": args["pid"],
                                            "socketId": format!("ws-{}", cid)
                                        }));

                                        let response = json!({
                                            "cmd": "SET_ACTIVITY",
                                            "data": args["activity"],
                                            "evt": null,
                                            "nonce": nonce
                                        });
                                        let _ = ws_stream.send(Message::Text(response.to_string().into())).await;
                                    }
                                }
                            }
                            Some(Ok(Message::Close(_))) => break,
                            Some(Err(e)) => {
                                error!("[rpc-ws] WebSocket error: {}", e);
                                break;
                            }
                            None => break,
                            _ => {}
                        }
                    }
                }
            }
        }
        Err(e) => {
            error!("[rpc-ws] Handshake failed: {}", e);
        }
    }
}
