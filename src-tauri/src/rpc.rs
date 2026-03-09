use interprocess::local_socket::{LocalSocketListener, LocalSocketStream};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn start_rpc_server(app_handle: AppHandle) {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        log::info!("[rpc] RPC server already running");
        return;
    }
    SERVER_RUNNING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        for i in 0..10 {
            let name = if cfg!(windows) {
                format!("\\\\.\\pipe\\discord-ipc-{}", i)
            } else {
                format!("/tmp/discord-ipc-{}", i)
            };

            // On Unix, only remove the socket if it's stale
            #[cfg(unix)]
            {
                use std::os::unix::net::UnixStream;
                if std::path::Path::new(&name).exists() {
                    if UnixStream::connect(&name).is_err() {
                        log::info!("[rpc] Removing stale socket: {}", name);
                        let _ = std::fs::remove_file(&name);
                    } else {
                        log::info!("[rpc] Socket {} is active, trying next", name);
                        continue;
                    }
                }
            }

            match LocalSocketListener::bind(name.clone()) {
                Ok(listener) => {
                    log::info!("[rpc] Bound to {}", name);
                    for stream in listener.incoming().filter_map(|res| {
                        res.map_err(|e| log::error!("[rpc] Connection error: {}", e)).ok()
                    }) {
                        if !SERVER_RUNNING.load(Ordering::SeqCst) {
                            log::info!("[rpc] Server stopping, rejecting new client");
                            break;
                        }
                        let app = app_handle.clone();
                        std::thread::spawn(move || {
                            handle_client(stream, app);
                        });
                    }
                    break;
                }
                Err(e) => {
                    log::warn!("[rpc] Failed to bind to {}: {}", name, e);
                    if i == 9 {
                        SERVER_RUNNING.store(false, Ordering::SeqCst);
                    }
                }
            }
        }
    });
}

fn handle_client(mut stream: LocalSocketStream, app: AppHandle) {
    log::info!("[rpc] New client connected");
    let mut header = [0u8; 8];
    loop {
        if let Err(e) = stream.read_exact(&mut header) {
            log::info!("[rpc] Client disconnected or error: {}", e);
            // Clear activity on disconnect
            let _ = app.emit("grid-rpc-activity", Option::<Value>::None);
            break;
        }

        let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);

        // Limit payload size to 64KB to prevent DoS
        if length > 65536 {
            log::error!("[rpc] Payload too large ({} bytes), disconnecting client", length);
            break;
        }

        let mut payload = vec![0u8; length as usize];
        if let Err(e) = stream.read_exact(&mut payload) {
            log::error!("[rpc] Failed to read payload: {}", e);
            break;
        }

        match opcode {
            0 => { // Handshake
                log::info!("[rpc] Handshake received");
                let response = json!({
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
                            "avatar": null
                        }
                    },
                    "nonce": null
                });
                send_payload(&mut stream, 1, response);
            }
            1 => { // Frame
                if let Ok(json) = serde_json::from_slice::<Value>(&payload) {
                    if json["cmd"] == "SET_ACTIVITY" {
                        log::info!("[rpc] SET_ACTIVITY received");
                        let _ = app.emit("grid-rpc-activity", &json["args"]["activity"]);
                    }
                }
            }
            2 => { // Close
                log::info!("[rpc] Close received");
                break;
            }
            3 => { // Ping
                send_payload(&mut stream, 4, json!({}));
            }
            _ => {
                log::warn!("[rpc] Unknown opcode: {}", opcode);
            }
        }
    }
}

fn send_payload(stream: &mut LocalSocketStream, opcode: u32, payload: Value) {
    let payload_str = payload.to_string();
    let length = payload_str.len() as u32;

    let mut buffer = Vec::with_capacity(8 + payload_str.len());
    buffer.extend_from_slice(&opcode.to_le_bytes());
    buffer.extend_from_slice(&length.to_le_bytes());
    buffer.extend_from_slice(payload_str.as_bytes());

    let _ = stream.write_all(&buffer);
}

#[tauri::command]
pub fn stop_rpc_server() {
    log::info!("[rpc] stop_rpc_server called");
    SERVER_RUNNING.store(false, Ordering::SeqCst);
    // Note: This implementation doesn't forcefully kill existing client threads
    // or the listener loop, but signals that no new clients should be handled.
    // In a production app, we might use a more sophisticated shutdown mechanism.
}
