use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use tauri::Manager;

mod game_scanner;
mod rpc_server;

use tokio_util::sync::CancellationToken;

pub struct RpcState {
    pub cancel_token: Mutex<Option<CancellationToken>>,
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
            cancel_token: Mutex::new(None),
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
    {
        let mut token_guard = state.cancel_token.lock().unwrap();
        if let Some(token) = token_guard.take() {
            log::info!("[rpc] Stopping existing RPC server...");
            token.cancel();
        }
    }

    // Basic mode: No RPC server, just process scanning (handled by game_scanner)
    if no_rpc {
        log::info!("[rpc] RPC server disabled (Basic mode)");
        return Ok(());
    }

    // Advanced mode: Start the Rust RPC server
    log::info!("[rpc] Starting Rust RPC server (Advanced mode)...");
    let cancel_token = CancellationToken::new();
    let rpc_server = rpc_server::RpcServer::new(app, cancel_token.clone(), user_id, user_name, avatar);
    rpc_server.start().await;

    state.cancel_token.lock().unwrap().replace(cancel_token);
    Ok(())
}

#[tauri::command]
fn is_failover(state: tauri::State<'_, FailoverState>) -> bool {
    state.is_failover
}

#[tauri::command]
async fn stop_rpc_server(state: tauri::State<'_, RpcState>) -> Result<(), String> {
    let mut token_guard = state.cancel_token.lock().unwrap();
    if let Some(token) = token_guard.take() {
        log::info!("[rpc] Stopping Rust RPC server...");
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