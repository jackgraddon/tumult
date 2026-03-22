use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;
use tauri::Manager;

mod game_scanner;
mod rpc_server;

pub struct RpcState {
    pub cancellation_token: Mutex<Option<CancellationToken>>,
}

pub struct FailoverState {
    pub is_failover: bool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let scanner_state = Arc::new(game_scanner::ScannerState {
        watch_list: Mutex::new(Vec::new()),
        current_game: Mutex::new(None),
        is_enabled: Mutex::new(false),
        notify: Arc::new(Notify::new()),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(scanner_state.clone())
        .manage(RpcState {
            cancellation_token: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            game_scanner::set_scanner_enabled,
            game_scanner::update_watch_list,
            start_oauth_server,
            start_rpc_server,
            stop_rpc_server,
            is_failover
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            // macOS/Windows decoration logic
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                window.set_decorations(false).unwrap();
                window.set_shadow(true).unwrap();
            }

            let remote_url = "https://tumult.jackg.cc";
            // Use option_env! to bake the value into the binary at build time.
            let forced_offline = option_env!("BUILD_FOR_OFFLINE").is_some();
            let mut use_remote = !forced_offline;

            if use_remote {
                log::info!("Checking connection to {}...", remote_url);
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(3))
                    .build()
                    .unwrap();
                
                match client.head(remote_url).send() {
                    Ok(res) if res.status().is_success() => {
                        log::info!("Remote server is reachable.");
                    }
                    _ => {
                        log::warn!("Remote server unreachable, falling back to local assets.");
                        use_remote = false;
                    }
                }
            }

            let is_failover_mode = !use_remote && !forced_offline;
            app.manage(FailoverState { is_failover: is_failover_mode });

            if use_remote {
                log::info!("Navigating to remote: {}", remote_url);
                window.navigate(remote_url.parse().unwrap()).unwrap();
            } else if is_failover_mode {
                log::warn!("Failover mode: Remote server unreachable, using local assets.");
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start game scanner loop
            game_scanner::start(app.handle().clone(), scanner_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn start_rpc_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, RpcState>,
    user_id: String,
    user_name: String,
    avatar: Option<String>,
    no_rpc: bool,
) -> Result<(), String> {
    let mut token_guard = state.cancellation_token.lock().unwrap();

    if let Some(token) = token_guard.take() {
        log::info!("[rpc] Stopping existing native RPC server...");
        token.cancel();
    }

    if no_rpc {
        log::info!("[rpc] RPC server disabled (Basic mode), only process scanning active.");
        return Ok(());
    }

    let token = CancellationToken::new();
    *token_guard = Some(token.clone());

    let server = Arc::new(rpc_server::RpcServer::new(user_id, user_name, avatar));
    let server_ipc = server.clone();
    let server_ws = server.clone();
    let server_events = server.clone();
    let app_handle = app.clone();

    // Spawn IPC server
    let token_ipc = token.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = rpc_server::ipc::run_ipc_server(server_ipc) => {},
            _ = token_ipc.cancelled() => {
                log::info!("[rpc] IPC server cancelled");
            }
        }
    });

    // Spawn WS server
    let token_ws = token.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = rpc_server::ws::run_ws_server(server_ws) => {},
            _ = token_ws.cancelled() => {
                log::info!("[rpc] WS server cancelled");
            }
        }
    });

    // Event bridge
    tokio::spawn(async move {
        use rpc_server::RpcEvent;
        use tauri::Emitter;
        let mut rx = server_events.event_tx.subscribe();
        loop {
            tokio::select! {
                Ok(event) = rx.recv() => {
                    match event {
                        RpcEvent::Activity(payload) => {
                            let _ = app_handle.emit("arrpc-activity", payload);
                        }
                        _ => {}
                    }
                }
                _ = token.cancelled() => {
                    server_events.stop().await;
                    break;
                }
            }
        }
    });

    log::info!("[rpc] Native arRPC server started.");
    Ok(())
}

#[tauri::command]
fn is_failover(state: tauri::State<'_, FailoverState>) -> bool {
    state.is_failover
}

#[tauri::command]
async fn stop_rpc_server(state: tauri::State<'_, RpcState>) -> Result<(), String> {
    let mut token_guard = state.cancellation_token.lock().unwrap();
    if let Some(token) = token_guard.take() {
        log::info!("[rpc] Stopping native RPC server...");
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
async fn start_oauth_server() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let listener = TcpListener::bind("127.0.0.1:1420").map_err(|e| e.to_string())?;
        let start_time = std::time::Instant::now();
        let timeout = Duration::from_secs(300);

        for stream in listener.incoming() {
            if start_time.elapsed() >= timeout {
                return Err("OAuth server timed out after 5 minutes.".to_string());
            }
            match stream {
                Ok(mut stream) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                    let mut buffer = [0; 4096];
                    if let Ok(bytes_read) = stream.read(&mut buffer) {
                        let request = String::from_utf8_lossy(&buffer[..bytes_read]);

                        if request.contains("GET /favicon.ico") {
                            let _ = stream.write_all(b"HTTP/1.1 404 NOT FOUND\r\n\r\n");
                            continue;
                        }

                        if request.starts_with("GET /") {
                            let first_line = request.lines().next().unwrap_or("");
                            let parts: Vec<&str> = first_line.split_whitespace().collect();

                            if parts.len() >= 2 {
                                let path = parts[1];
                                if path.contains("code=") || path.contains("error=") {
                                    let html = "<html><body style=\"background: #0f1115; color: #fff; font-family: system-ui, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0;\"><h2>Authentication Successful</h2><p style=\"color: #888;\">You can close this tab and return to Tumult.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>";
                                    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}", html.len(), html);
                                    let _ = stream.write_all(response.as_bytes());
                                    let _ = stream.flush();
                                    return Ok(format!("http://localhost:1420{}", path));
                                }
                            }
                        }
                        let _ = stream.write_all(b"HTTP/1.1 404 NOT FOUND\r\n\r\n");
                    }
                }
                Err(_) => return Err("OAuth server timed out after 5 minutes.".to_string()),
            }
        }
        Err("Listener closed unexpectedly.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}