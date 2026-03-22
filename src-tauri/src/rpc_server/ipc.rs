use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tauri::{AppHandle, Emitter};
use log::{info, error};
use serde_json::json;
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

#[cfg(windows)]
use tokio::net::windows::named_pipe::{ServerOptions, NamedPipeServer};

pub async fn start_ipc_server(
    app: AppHandle,
    cancel_token: CancellationToken,
    user_id: String,
    user_name: String,
    avatar: Option<String>,
) {
    #[cfg(unix)]
    {
        for i in 0..10 {
            let path = format!("/tmp/discord-ipc-{}", i);
            let _ = std::fs::remove_file(&path);
            match UnixListener::bind(&path) {
                Ok(listener) => {
                    info!("[rpc-ipc] Listening on {}", path);
                    let app_handle = app.clone();
                    let cancel_handle = cancel_token.clone();
                    let user_id_c = user_id.clone();
                    let user_name_c = user_name.clone();
                    let avatar_c = avatar.clone();

                    tokio::spawn(async move {
                        loop {
                            tokio::select! {
                                _ = cancel_handle.cancelled() => {
                                    info!("[rpc-ipc] IPC server stopping...");
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
                                                handle_ipc_connection(stream, app, cancel, uid, uname, av).await;
                                            });
                                        }
                                        Err(e) => {
                                            error!("[rpc-ipc] Error: {}", e);
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

    #[cfg(windows)]
    {
        for i in 0..10 {
            let pipe_name = format!(r"\\.\pipe\discord-ipc-{}", i);
            let app_handle = app.clone();
            let cancel_handle = cancel_token.clone();
            let user_id_c = user_id.clone();
            let user_name_c = user_name.clone();
            let avatar_c = avatar.clone();

            match ServerOptions::new().first_pipe_instance(true).create(&pipe_name) {
                Ok(mut server) => {
                    info!("[rpc-ipc] Listening on {}", pipe_name);
                    tokio::spawn(async move {
                        loop {
                            tokio::select! {
                                _ = cancel_handle.cancelled() => {
                                    break;
                                }
                                connect_res = server.connect() => {
                                    if connect_res.is_ok() {
                                        let app = app_handle.clone();
                                        let cancel = cancel_handle.clone();
                                        let uid = user_id_c.clone();
                                        let uname = user_name_c.clone();
                                        let av = avatar_c.clone();

                                        tokio::spawn(async move {
                                            handle_ipc_connection(server, app, cancel, uid, uname, av).await;
                                        });

                                        // Create next instance
                                        match ServerOptions::new().create(&pipe_name) {
                                            Ok(next_server) => server = next_server,
                                            Err(_) => break,
                                        }
                                    } else {
                                        break;
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
}

#[cfg(unix)]
type IpcStream = UnixStream;
#[cfg(windows)]
type IpcStream = NamedPipeServer;

async fn handle_ipc_connection(
    mut stream: IpcStream,
    app: AppHandle,
    cancel_token: CancellationToken,
    user_id: String,
    user_name: String,
    avatar: Option<String>,
) {
    info!("[rpc-ipc] New connection");
    let mut buffer = [0u8; 4096];
    let mut client_id = String::new();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                break;
            }
            read_res = stream.read(&mut buffer) => {
                match read_res {
                    Ok(0) => break,
                    Ok(n) => {
                        if n < 8 { continue; }
                        let opcode = u32::from_le_bytes(buffer[0..4].try_into().unwrap());
                        let length = u32::from_le_bytes(buffer[4..8].try_into().unwrap()) as usize;

                        if n < 8 + length { continue; }
                        let data = &buffer[8..8+length];

                        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(data) {
                            let cmd = value["cmd"].as_str().unwrap_or("");

                            if opcode == 0 { // HANDSHAKE
                                client_id = value["client_id"].as_str().unwrap_or("").to_string();
                                info!("[rpc-ipc] Handshake from client_id: {}", client_id);

                                let response = json!({
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
                                });
                                send_ipc_frame(&mut stream, 1, response).await;
                            } else if cmd == "SET_ACTIVITY" {
                                let args = value["args"].clone();
                                let nonce = value["nonce"].as_str();

                                let _ = app.emit("arrpc-activity", json!({
                                    "activity": args["activity"],
                                    "pid": args["pid"],
                                    "socketId": format!("ipc-{}", client_id)
                                }));

                                let response = json!({
                                    "cmd": "SET_ACTIVITY",
                                    "data": args["activity"],
                                    "evt": null,
                                    "nonce": nonce
                                });
                                send_ipc_frame(&mut stream, 1, response).await;
                            }
                        }
                    }
                    Err(e) => {
                        error!("[rpc-ipc] Error: {}", e);
                        break;
                    }
                }
            }
        }
    }
}

async fn send_ipc_frame(stream: &mut IpcStream, opcode: u32, data: serde_json::Value) {
    let response_bytes = data.to_string().into_bytes();
    let mut full_response = Vec::with_capacity(8 + response_bytes.len());
    full_response.extend_from_slice(&opcode.to_le_bytes());
    full_response.extend_from_slice(&(response_bytes.len() as u32).to_le_bytes());
    full_response.extend_from_slice(&response_bytes);
    let _ = stream.write_all(&full_response).await;
}
