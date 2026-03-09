use interprocess::local_socket::{LocalSocketListener, LocalSocketStream};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use futures_util::{StreamExt, SinkExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn start_rpc_server(app_handle: AppHandle) {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        log::info!("[rpc] RPC server already running");
        return;
    }
    SERVER_RUNNING.store(true, Ordering::SeqCst);

    // 1. Spawn IPC listeners on ALL available ports (0-9)
    for i in 0..10 {
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let name = if cfg!(windows) {
                format!("\\\\.\\pipe\\discord-ipc-{}", i)
            } else {
                let base = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
                format!("{}/discord-ipc-{}", base, i)
            };

            #[cfg(unix)]
            {
                use std::os::unix::net::UnixStream;
                if std::path::Path::new(&name).exists() {
                    if UnixStream::connect(&name).is_err() {
                        log::info!("[rpc] Removing stale socket: {}", name);
                        let _ = std::fs::remove_file(&name);
                    } else {
                        log::info!("[rpc] Socket {} is active, skipping this port", name);
                        return;
                    }
                }
            }

            match LocalSocketListener::bind(name.clone()) {
                Ok(listener) => {
                    log::info!("[rpc] Bound IPC to {}", name);
                    println!("[rpc] Successfully bound to {}", name);
                    for stream in listener.incoming().filter_map(|res| res.ok()) {
                        if !SERVER_RUNNING.load(Ordering::SeqCst) { break; }
                        let app_c = app.clone();
                        std::thread::spawn(move || handle_ipc_client(stream, app_c));
                    }
                }
                Err(e) => log::warn!("[rpc] Failed to bind IPC to {}: {}", name, e),
            }
        });
    }

    // 2. Spawn WebSocket listeners on ports 6463-6472
    for port in 6463..6473 {
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();

            rt.block_on(async {
                let addr = format!("127.0.0.1:{}", port);
                let listener = match TcpListener::bind(&addr).await {
                    Ok(l) => {
                        log::info!("[rpc] Bound WebSocket to {}", addr);
                        println!("[rpc] Successfully bound WebSocket to {}", addr);
                        l
                    },
                    Err(e) => {
                        log::debug!("[rpc] Failed to bind WebSocket to {}: {}", addr, e);
                        return;
                    }
                };

                while let Ok((stream, _)) = listener.accept().await {
                    if !SERVER_RUNNING.load(Ordering::SeqCst) { break; }
                    let app_c = app.clone();
                    tokio::spawn(handle_ws_client(stream, app_c));
                }
            });
        });
    }
}

fn handle_ipc_client(mut stream: LocalSocketStream, app: AppHandle) {
    println!("[rpc] New game client connected via IPC");
    log::info!("[rpc] New game client connected via IPC");
    let mut header = [0u8; 8];
    loop {
        if let Err(e) = stream.read_exact(&mut header) {
            log::debug!("[rpc] IPC connection closed: {}", e);
            let _ = app.emit("grid-rpc-activity", Option::<Value>::None);
            break;
        }

        let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);

        if length > 65536 {
            log::error!("[rpc] Payload too large: {}", length);
            break;
        }

        let mut payload = vec![0u8; length as usize];
        if let Err(e) = stream.read_exact(&mut payload) {
            log::error!("[rpc] Failed to read payload: {}", e);
            break;
        }

        println!("[rpc] IPC Raw Payload (len={}): {:?}", length, String::from_utf8_lossy(&payload));
        if let Ok(json) = serde_json::from_slice::<Value>(&payload) {
            println!("[rpc] IPC JSON Frame: Opcode {}, Command {:?}", opcode, json["cmd"].as_str().unwrap_or("HANDSHAKE"));
            log::debug!("[rpc] IPC Frame: Opcode {}, Payload {}", opcode, json);

            // Ping (3) -> Pong (4)
            if opcode == 3 {
                send_ipc_payload(&mut stream, 4, json);
                continue;
            }

            let (op, resp) = process_rpc_frame(opcode, json, &app);
            if let Some(r) = resp {
                send_ipc_payload(&mut stream, op, r);
            }
            if opcode == 2 { break; } // Close
        }
    }
}

async fn handle_ws_client(stream: TcpStream, app: AppHandle) {
    let callback = |req: &Request, mut res: Response| {
        let origin = req.headers().get("Origin").and_then(|v| v.to_str().ok()).unwrap_or("*");
        res.headers_mut().insert("Access-Control-Allow-Origin", origin.parse().unwrap());
        Ok(res)
    };

    let mut ws_stream = match accept_hdr_async(stream, callback).await {
        Ok(s) => s,
        Err(_) => return,
    };

    println!("[rpc] New game client connected via WebSocket");
    log::info!("[rpc] New WebSocket client connected");

    while let Some(msg) = ws_stream.next().await {
        let msg = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => break,
            _ => continue,
        };

        if let Ok(json) = serde_json::from_str::<Value>(&msg) {
            println!("[rpc] WS Frame: Command {:?}", json["cmd"].as_str().unwrap_or("HANDSHAKE"));
            log::debug!("[rpc] WS Frame: {}", json);
            let (_, resp) = process_rpc_frame(1, json, &app);
            if let Some(r) = resp {
                let _ = ws_stream.send(Message::Text(r.to_string())).await;
            }
        }
    }
    let _ = app.emit("grid-rpc-activity", Option::<Value>::None);
}

fn process_rpc_frame(opcode: u32, json: Value, app: &AppHandle) -> (u32, Option<Value>) {
    let cmd = json["cmd"].as_str().unwrap_or("");
    let nonce = &json["nonce"];

    // Handshake detection (Opcode 0 for IPC, or JSON fields for WS)
    let is_handshake = opcode == 0 || (cmd.is_empty() && (json["v"].is_number() || json["client_id"].is_string()));

    if is_handshake {
        let client_id = json["client_id"].as_str()
            .or_else(|| json["args"]["client_id"].as_str())
            .unwrap_or("unknown");
        log::info!("[rpc] Handshake received. client_id: {}", client_id);
        println!("[rpc] Handshake received from {}. Sending READY...", client_id);
        return (1, Some(json!({
            "cmd": "DISPATCH",
            "evt": "READY",
            "data": {
                "v": 1,
                "config": {
                    "cdn_host": "cdn.discordapp.com",
                    "api_endpoint": "//discord.com/api",
                    "environment": "production"
                },
                "user": {
                    "id": "1043831411200000000",
                    "username": "Tumult",
                    "discriminator": "0000",
                    "avatar": null,
                    "global_name": "Tumult User",
                    "bot": false,
                    "flags": 0,
                    "premium_type": 0
                    },
                    "application": {
                        "id": client_id,
                        "name": "Tumult",
                        "description": "Cross-platform Matrix Client",
                        "icon": null,
                        "summary": ""
                }
            },
            "nonce": nonce
        })));
    }

    match cmd {
        "SUBSCRIBE" => (1, Some(json!({ "cmd": "SUBSCRIBE", "evt": json["evt"], "nonce": nonce, "data": {} }))),
        "UNSUBSCRIBE" => (1, Some(json!({ "cmd": "UNSUBSCRIBE", "evt": json["evt"], "nonce": nonce, "data": {} }))),
        "SET_ACTIVITY" => {
            let activity = &json["args"]["activity"];
            let name = activity["name"].as_str().unwrap_or("Unknown Game");
            log::info!("[rpc] SET_ACTIVITY: {}", name);
            let _ = app.emit("grid-rpc-activity", activity);
            (1, Some(json!({
                "cmd": "SET_ACTIVITY",
                "data": activity,
                "evt": null,
                "nonce": nonce
            })))
        },
        "GET_GUILDS" => (1, Some(json!({ "cmd": "GET_GUILDS", "data": { "guilds": [] }, "evt": null, "nonce": nonce }))),
        "GET_CHANNELS" => (1, Some(json!({ "cmd": "GET_CHANNELS", "data": { "channels": [] }, "evt": null, "nonce": nonce }))),
        "AUTHORIZE" => (1, Some(json!({ "cmd": "AUTHORIZE", "data": { "code": "fake_code" }, "evt": null, "nonce": nonce }))),
        "AUTHENTICATE" => {
            let client_id = json["args"]["client_id"].as_str().unwrap_or("unknown");
            (1, Some(json!({
                "cmd": "AUTHENTICATE",
                "data": {
                    "user": { "id": "1043831411200000000", "username": "Tumult" },
                    "application": { "id": client_id, "name": "Tumult" }
                },
                "evt": null,
                "nonce": nonce
            })))
        },
        "GET_SELECTED_VOICE_CHANNEL" => (1, Some(json!({ "cmd": "GET_SELECTED_VOICE_CHANNEL", "data": null, "evt": null, "nonce": nonce }))),
        "GET_GUILD" => (1, Some(json!({ "cmd": "GET_GUILD", "data": null, "evt": null, "nonce": nonce }))),
        "GET_CHANNEL" => (1, Some(json!({ "cmd": "GET_CHANNEL", "data": null, "evt": null, "nonce": nonce }))),
        "DEEP_LINK" => (1, Some(json!({ "cmd": "DEEP_LINK", "data": null, "evt": null, "nonce": nonce }))),
        "INVITE_BROWSER" => (1, Some(json!({ "cmd": "INVITE_BROWSER", "data": null, "evt": null, "nonce": nonce }))),
        _ => {
            if !cmd.is_empty() {
                log::debug!("[rpc] Unhandled command: {}", cmd);
            }
            (1, None)
        }
    }
}

fn send_ipc_payload(stream: &mut LocalSocketStream, opcode: u32, payload: Value) {
    let payload_str = payload.to_string();
    let length = payload_str.len() as u32;

    let mut buffer = Vec::with_capacity(8 + payload_str.len());
    buffer.extend_from_slice(&opcode.to_le_bytes());
    buffer.extend_from_slice(&length.to_le_bytes());
    buffer.extend_from_slice(payload_str.as_bytes());

    if let Err(e) = stream.write_all(&buffer) {
        log::error!("[rpc] Failed to write IPC payload: {}", e);
    }
}

#[tauri::command]
pub fn stop_rpc_server() {
    log::info!("[rpc] stop_rpc_server called");
    SERVER_RUNNING.store(false, Ordering::SeqCst);
    // Note: This implementation doesn't forcefully kill existing client threads
    // or the listener loop, but signals that no new clients should be handled.
    // In a production app, we might use a more sophisticated shutdown mechanism.
}
