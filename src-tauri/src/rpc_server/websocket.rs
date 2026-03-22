use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Query, State},
    response::IntoResponse,
    routing::get,
    Router,
    http::{HeaderMap, Request},
};
use tower_http::cors::{Any, CorsLayer};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use log::{info, error, debug, warn};
use tokio_util::sync::CancellationToken;
use futures_util::StreamExt;
use std::collections::HashMap;
use super::types::{RpcMessage, RpcResponse};

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    user_id: String,
    user_name: String,
    avatar: Option<String>,
}

pub async fn start_websocket_server(
    app: AppHandle,
    cancel_token: CancellationToken,
    user_id: String,
    user_name: String,
    avatar: Option<String>,
) {
    let state = AppState {
        app,
        user_id,
        user_name,
        avatar,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app_router = Router::new()
        .route("/", get(handler))
        .fallback(fallback_handler)
        .layer(cors)
        .with_state(state);

    for port in 6463..=6472 {
        let addr = format!("127.0.0.1:{}", port);
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => {
                info!("[rpc-ws] Listening on http/ws://{}", addr);
                let cancel_handle = cancel_token.clone();
                let router = app_router.clone();

                tokio::spawn(async move {
                    if let Err(e) = axum::serve(listener, router)
                        .with_graceful_shutdown(async move {
                            cancel_handle.cancelled().await;
                            info!("[rpc-ws] Axum server on port {} stopping...", port);
                        })
                        .await {
                            error!("[rpc-ws] Server error on port {}: {}", port, e);
                        }
                });
                return;
            }
            Err(_) => continue,
        }
    }
}

async fn handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    params: Option<Query<HashMap<String, String>>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    info!("[rpc-ws] Handshake hit! Params: {:?}", params);

    // Strict Origin Validation (optional but recommended for security parity)
    if let Some(origin) = headers.get("origin") {
        let origin_str = origin.to_str().unwrap_or("");
        if !origin_str.is_empty() &&
           !origin_str.ends_with("discord.com") &&
           !origin_str.starts_with("http://localhost") &&
           !origin_str.starts_with("https://localhost") {
            warn!("[rpc-ws] Disallowed origin: {}", origin_str);
            // We'll allow it for now to avoid blocking legitimate local tools,
            // but log it clearly.
        }
    }

    ws.on_upgrade(move |socket| {
        let query = params.map(|p| p.0).unwrap_or_default();
        let client_id = query.get("client_id").cloned().unwrap_or_else(|| "0".to_string());
        handle_socket(socket, state, client_id)
    })
}

async fn fallback_handler(req: Request<axum::body::Body>) -> impl IntoResponse {
    let method = req.method();
    let uri = req.uri();
    error!("[rpc-ws] 404 Fallback triggered! Method: {}, URI: {}", method, uri);

    axum::response::Json(json!({
        "code": 404,
        "message": format!("Not Found: {} {}", method, uri)
    }))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, client_id: String) {
    // 1. IMMEDIATELY send the READY event
    let ready_data = json!({
        "v": 1,
        "config": {
            "cdn_host": "cdn.discordapp.com",
            "api_endpoint": "//discord.com/api",
            "environment": "production"
        },
        "user": {
            "id": state.user_id,
            "username": state.user_name,
            "discriminator": "0",
            "global_name": state.user_name,
            "avatar": state.avatar.clone().unwrap_or_default(),
            "bot": false,
            "flags": 0,
            "premium_type": 0,
        }
    });
    let ready = RpcResponse::new("DISPATCH", Some(ready_data), Some("READY".to_string()), None);

    if let Err(e) = socket.send(Message::Text(serde_json::to_string(&ready).unwrap().into())).await {
        error!("[rpc-ws] Failed to send READY: {}", e);
        return;
    }
    info!("[rpc-ws] Connection established for client_id: {}", client_id);

    // 2. Main Message Loop
    while let Some(Ok(msg)) = socket.next().await {
        match msg {
            Message::Text(text) => {
                debug!("[rpc-ws] Received message: {}", text);
                if let Ok(msg) = serde_json::from_str::<RpcMessage>(&text) {
                    match msg.cmd.as_str() {
                        "SET_ACTIVITY" => {
                            let args = msg.args.clone().unwrap_or(json!({}));
                            let activity = &args["activity"];

                            let _ = state.app.emit("arrpc-activity", json!({
                                "activity": activity,
                                "pid": args["pid"],
                                "socketId": format!("ws-{}", client_id)
                            }));

                            // BUILD THE CORRECT RESPONSE: Flatten the activity fields
                            let mut response_data = json!({
                                "application_id": client_id,
                                "name": "",
                                "type": 0
                            });

                            if let Some(act_obj) = activity.as_object() {
                                for (k, v) in act_obj {
                                    response_data[k] = v.clone();
                                }
                            }

                            let frame = RpcResponse::new("SET_ACTIVITY", Some(response_data), None, msg.nonce);
                            let _ = socket.send(Message::Text(serde_json::to_string(&frame).unwrap().into())).await;
                        }
                        _ => {
                            let frame = RpcResponse::new(&msg.cmd, Some(json!({})), None, msg.nonce);
                            let _ = socket.send(Message::Text(serde_json::to_string(&frame).unwrap().into())).await;
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}

impl ToString for RpcResponse {
    fn to_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}
