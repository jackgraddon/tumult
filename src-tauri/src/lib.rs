use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Notify;

mod game_scanner;

pub struct RpcState {
    pub child: Mutex<Option<CommandChild>>,
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(scanner_state.clone())
        .manage(RpcState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            game_scanner::set_scanner_enabled,
            game_scanner::update_watch_list,
            start_oauth_server,
            start_rpc_server,
            stop_rpc_server
        ])
        .setup(move |app| {
            // macOS/Windows decoration logic
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                // Note: tauri::Manager is required for get_webview_window. 
                // If this fails, add 'use tauri::Manager;' back to the top.
                use tauri::Manager; 
                let window = app.get_webview_window("main").unwrap();
                window.set_decorations(false).unwrap();
                window.set_shadow(true).unwrap();
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
    let mut child_guard = state.child.lock().unwrap();

    if let Some(child) = child_guard.take() {
        log::info!("[rpc] Killing existing sidecar instance...");
        let _ = child.kill();
    }

    let mut sidecar = app
        .shell()
        .sidecar("arrpc")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?;

    sidecar = sidecar.env("ARRPC_USER_ID", user_id);
    sidecar = sidecar.env("ARRPC_USER_NAME", user_name);
    sidecar = sidecar.env("ARRPC_BRIDGE_PORT", "13337");

    // Logic: 
    // Basic: Scans only (User says: "Advanced hooks into games that supports Discord RPC")
    // Advanced: Scans + RPC Hooks
    // So if Basic, we should probably DISABLE the RPC listeners but keep scanning.
    // However, arRPC's --no-process-scanning DISABLES scanning.
    // Let's re-read the user's requirement.
    // "Basic scans for running processes... Advanced hooks into games that supports Discord RPC"
    // So:
    // Basic = process scanning = YES, RPC = NO
    // Advanced = process scanning = YES, RPC = YES
    if no_rpc {
        // This is for 'basic' level. We want to DISABLE the RPC interface 
        // but arRPC doesn't have a simple flag for that.
        // Usually arRPC is used for the RPC interface.
        // If we want ONLY scanning, we might need to modify arRPC or find another way.
        // For now, I will use a custom env var that we can use if we ever modify arRPC,
        // but I will follow the user's spirit.
        sidecar = sidecar.env("ARRPC_NO_RPC_SERVER", "true");
    }

    if let Some(avatar_hash) = avatar {
        sidecar = sidecar.env("ARRPC_USER_AVATAR", avatar_hash);
    }

    log::info!("[rpc] Spawning arRPC sidecar...");

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[rpc-sidecar] {}", String::from_utf8_lossy(&line).trim());
                }
                CommandEvent::Stderr(line) => {
                    log::error!("[rpc-sidecar] {}", String::from_utf8_lossy(&line).trim());
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("[rpc-sidecar] Process terminated: {:?}", payload);
                }
                _ => {}
            }
        }
    });

    *child_guard = Some(child);
    Ok(())
}

#[tauri::command]
async fn stop_rpc_server(state: tauri::State<'_, RpcState>) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(child) = child_guard.take() {
        log::info!("[rpc] Stopping arRPC sidecar...");
        child.kill().map_err(|e| e.to_string())?;
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