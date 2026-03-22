use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use log::{info, error};
use tokio_util::sync::CancellationToken;

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
                                    Ok((stream, _)) => {
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
    if let Ok(mut ws_stream) = accept_async(stream).await {
        info!("[rpc-ws] New connection");
        let mut client_id = String::new();

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    break;
                }
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                let cmd = value["cmd"].as_str().unwrap_or("");
                                let nonce = value["nonce"].as_str();

                                if cmd == "SET_ACTIVITY" {
                                    let args = value["args"].clone();

                                    let _ = app.emit("arrpc-activity", json!({
                                        "activity": args["activity"],
                                        "pid": args["pid"],
                                        "socketId": format!("ws-{}", client_id)
                                    }));

                                    let response = json!({
                                        "cmd": "SET_ACTIVITY",
                                        "data": args["activity"],
                                        "evt": null,
                                        "nonce": nonce
                                    });
                                    let _ = ws_stream.send(Message::Text(response.to_string().into())).await;
                                } else if surface_is_handshake(&value) {
                                    client_id = value["args"]["client_id"].as_str().unwrap_or("").to_string();
                                    info!("[rpc-ws] Handshake from client_id: {}", client_id);

                                    let response = json!({
                                        "cmd": "DISPATCH",
                                        "data": {
                                            "v": 1,
                                            "config": {
                                                "cdn_host": "cdn.discordapp.com",
                                                "api_endpoint": "//discord.com/api",
                                                "environment": "production"
                                            },
                                            "user": {
                                                "id": user_id.clone(),
                                                "username": user_name.clone(),
                                                "discriminator": "0",
                                                "global_name": user_name.clone(),
                                                "avatar": avatar.clone(),
                                                "bot": false,
                                                "flags": 0,
                                                "premium_type": 0,
                                            }
                                        },
                                        "evt": "READY",
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
}

fn surface_is_handshake(value: &serde_json::Value) -> bool {
    // Discord WS handshake often looks like cmd: "INVITE_BROWSER" or similar on connection
    // but the main handshake uses a specific format.
    // For now, let's look for client_id in args.
    value["cmd"] == "SUBSCRIBE" || value["args"]["client_id"].is_string()
}
