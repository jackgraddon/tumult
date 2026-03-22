use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tauri::{AppHandle, Emitter};
use log::{info, error, debug};
use serde_json::json;
use tokio_util::sync::CancellationToken;
use super::types::{RpcHandshake, RpcMessage, RpcResponse};

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
    let mut client_id = String::new();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                break;
            }
            read_res = read_ipc_frame(&mut stream) => {
                match read_res {
                    Ok(Some((opcode, body))) => {
                        debug!("[rpc-ipc] Received frame: opcode={}, body={}", opcode, String::from_utf8_lossy(&body));
                        if opcode == 0 { // HANDSHAKE
                            if let Ok(handshake) = serde_json::from_slice::<RpcHandshake>(&body) {
                                client_id = handshake.client_id.clone();
                                info!("[rpc-ipc] Handshake from client_id: {}", client_id);

                                let response_data = json!({
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
                                        "avatar_decoration_data": null,
                                        "bot": false,
                                        "flags": 0,
                                        "premium_type": 0,
                                    }
                                });
                                let response = RpcResponse::new("DISPATCH", Some(response_data), Some("READY".to_string()), None);
                                send_ipc_frame(&mut stream, 1, response).await;
                            }
                        } else if opcode == 1 { // FRAME
                            if let Ok(msg) = serde_json::from_slice::<RpcMessage>(&body) {
                                match msg.cmd.as_str() {
                                    "SET_ACTIVITY" => {
                                        let args = msg.args.clone().unwrap_or(json!({}));

                                        let _ = app.emit("arrpc-activity", json!({
                                            "activity": args["activity"],
                                            "pid": args["pid"],
                                            "socketId": format!("ipc-{}", client_id)
                                        }));

                                        let response_data = json!({
                                            "application_id": client_id,
                                            "name": "",
                                            "type": 0,
                                            "activity": args["activity"]
                                        });
                                        let response = RpcResponse::new("SET_ACTIVITY", Some(response_data), None, msg.nonce);
                                        send_ipc_frame(&mut stream, 1, response).await;
                                    }
                                    _ => {
                                        // Acknowledge other commands with an empty result to avoid hanging
                                        let response = RpcResponse::new(&msg.cmd, Some(json!({})), None, msg.nonce);
                                        send_ipc_frame(&mut stream, 1, response).await;
                                    }
                                }
                            }
                        } else if opcode == 3 { // PING
                            debug!("[rpc-ipc] Received PING, sending PONG");
                            send_ipc_raw_frame(&mut stream, 4, body).await;
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        error!("[rpc-ipc] Error: {}", e);
                        break;
                    }
                }
            }
        }
    }
}

async fn read_ipc_frame(stream: &mut IpcStream) -> Result<Option<(u32, Vec<u8>)>, Box<dyn std::error::Error + Send + Sync>> {
    let mut header = [0u8; 8];
    if stream.read_exact(&mut header).await.is_err() {
        return Ok(None);
    }
    let opcode = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;

    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).await?;

    Ok(Some((opcode, body)))
}

async fn send_ipc_frame(stream: &mut IpcStream, opcode: u32, data: RpcResponse) {
    let json_data = serde_json::to_string(&data).unwrap_or("{}".to_string());
    send_ipc_raw_frame(stream, opcode, json_data.into_bytes()).await;
}

async fn send_ipc_raw_frame(stream: &mut IpcStream, opcode: u32, body: Vec<u8>) {
    let mut full_response = Vec::with_capacity(8 + body.len());
    full_response.extend_from_slice(&opcode.to_le_bytes());
    full_response.extend_from_slice(&(body.len() as u32).to_le_bytes());
    full_response.extend_from_slice(&body);
    let _ = stream.write_all(&full_response).await;
}
