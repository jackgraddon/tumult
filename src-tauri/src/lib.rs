use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Emitter,
};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::sync::Notify;

mod game_scanner;

// ─── State structs ────────────────────────────────────────────────────────────

/// Manages the legacy arRPC sidecar child process (kept for compatibility).
pub struct RpcState {
    pub child: Mutex<Option<CommandChild>>,
}

/// Manages the rsRPC sidecar child process.
pub struct RsRpcState {
    pub child: Mutex<Option<CommandChild>>,
}

pub struct FailoverState {
    pub is_failover: bool,
}

pub struct CliArgs {
    pub minimized: bool,
}

// ─── App entry point ──────────────────────────────────────────────────────────

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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosRegistration::ApplicationItem,
            Some(vec!["--minimized"]),
        ))
        .manage(scanner_state.clone())
        .manage(RpcState {
            child: Mutex::new(None),
        })
        .manage(RsRpcState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            game_scanner::set_scanner_enabled,
            game_scanner::update_watch_list,
            start_oauth_server,
            // Legacy arRPC (kept for any rollback path)
            start_rpc_server,
            stop_rpc_server,
            // rsRPC
            start_rsrpc_server,
            stop_rsrpc_server,
            is_failover,
            get_cli_args
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                window.set_decorations(false).unwrap();
                window.set_shadow(true).unwrap();
            }

            let remote_url = "https://tumult.jackg.cc";
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

            let args: Vec<String> = std::env::args().collect();
            let has_minimized_arg = args.contains(&"--minimized".to_string());
            app.manage(CliArgs { minimized: has_minimized_arg });

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

            game_scanner::start(app.handle().clone(), scanner_state);

            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let check_updates = MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &check_updates, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Tumult")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "check_updates" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("check-updates", ());
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window.hide().unwrap();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit => {
                log::info!("[app] App exiting, cleaning up sidecars...");
                
                // Clean up rsRPC
                if let Ok(mut child_guard) = tauri::Manager::state::<RsRpcState>(app_handle).child.lock() {
                    if let Some(child) = child_guard.take() {
                        let _ = child.kill();
                    }
                }

                // Clean up legacy arRPC
                if let Ok(mut child_guard) = tauri::Manager::state::<RpcState>(app_handle).child.lock() {
                    if let Some(child) = child_guard.take() {
                        let _ = child.kill();
                    }
                }
            }
            _ => {}
        });
}

// ─── rsRPC sidecar ────────────────────────────────────────────────────────────
//
// rsRPC is a self-contained Rust binary. It exposes:
//   - WebSocket on port 1337 (JSON, arRPC-compatible)
//   - WebSocket on port 1338 (MessagePack, optional)
//
// Unlike the arRPC JS sidecar, rsRPC does NOT need a stdout bridge — the
// frontend connects to its WebSocket directly. We just need to manage the
// process lifecycle.

#[tauri::command]
async fn start_rsrpc_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, RsRpcState>,
    bridge_port: Option<u16>,
    no_process_scanning: Option<bool>,
) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();

    // Kill any existing instance cleanly before spawning a new one.
    if let Some(child) = child_guard.take() {
        log::info!("[rsrpc] Killing existing sidecar instance...");
        let _ = child.kill();
        std::thread::sleep(Duration::from_millis(200));
    }

    // Belt-and-suspenders: kill any orphaned rsrpc processes from a previous run.
    // We use "pkill -f" on Unix and "taskkill /IM rsrpc*" on Windows to catch both
    // development (arch-specific) and production (renamed) binary names.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "rsrpc"])
            .output();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "rsrpc*"])
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("pkill")
            .arg("-f")
            .arg("rsrpc")
            .output();
    }

    let port = bridge_port.unwrap_or(1337);
    let scan_disabled = no_process_scanning.unwrap_or(false);

    let mut args = vec![
        "--bridge-port".to_string(),
        port.to_string(),
    ];

    if scan_disabled {
        args.push("--no-process-scanning".to_string());
    }

    log::info!("[rsrpc] Spawning sidecar on port {}...", port);

    let sidecar = app
        .shell()
        .sidecar("rsrpc")
        .map_err(|e| format!("Failed to create rsrpc sidecar: {}", e))?
        .args(&args);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn rsrpc sidecar: {}", e))?;

    log::info!("[rsrpc] Sidecar spawned (PID {:?})", child.pid());

    // Log stdout/stderr from the sidecar
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[rsrpc] {}", String::from_utf8_lossy(&line).trim());
                }
                CommandEvent::Stderr(line) => {
                    log::info!("[rsrpc] {}", String::from_utf8_lossy(&line).trim());
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("[rsrpc] Process terminated: {:?}", payload);
                }
                _ => {}
            }
        }
    });

    // Spawn a Rust-side WebSocket client that connects to rsRPC's bridge
    // and forwards activity messages as Tauri events. This bypasses the
    // browser's Mixed Content restriction (ws:// from https://).
    let bridge_app = app.clone();
    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        use tauri::Emitter;

        let url = format!("ws://127.0.0.1:{}", port);

        // Retry loop: the sidecar needs a moment to start its WS server
        loop {
            // Wait before (re)connecting
            tokio::time::sleep(Duration::from_secs(2)).await;

            log::info!("[rsrpc-bridge] Connecting to {}...", url);

            let ws_stream = match tokio_tungstenite::connect_async(&url).await {
                Ok((stream, _)) => stream,
                Err(e) => {
                    log::warn!("[rsrpc-bridge] Connection failed: {}, retrying...", e);
                    continue;
                }
            };

            log::info!("[rsrpc-bridge] Connected to rsRPC bridge");

            let (_, mut read) = ws_stream.split();

            while let Some(msg) = read.next().await {
                match msg {
                    Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                        match serde_json::from_str::<serde_json::Value>(&text) {
                            Ok(value) => {
                                log::info!("[rsrpc-bridge] Forwarding activity event");
                                let _ = bridge_app.emit("arrpc-activity", value);
                            }
                            Err(e) => {
                                log::warn!("[rsrpc-bridge] Failed to parse JSON: {}", e);
                            }
                        }
                    }
                    Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => {
                        log::info!("[rsrpc-bridge] Server closed connection");
                        break;
                    }
                    Err(e) => {
                        log::warn!("[rsrpc-bridge] WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }

            log::info!("[rsrpc-bridge] Disconnected, will retry...");
        }
    });

    *child_guard = Some(child);
    Ok(())
}

#[tauri::command]
async fn stop_rsrpc_server(state: tauri::State<'_, RsRpcState>) -> Result<(), String> {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(child) = child_guard.take() {
        log::info!("[rsrpc] Stopping rsRPC sidecar...");
        let _ = child.kill();
    }
    Ok(())
}

// ─── Legacy arRPC sidecar (kept for rollback) ─────────────────────────────────

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
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("killall")
            .arg("arrpc-aarch64-apple-darwin")
            .output();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "arrpc.exe"])
            .output();
    }

    let mut sidecar = app
        .shell()
        .sidecar("arrpc")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?;

    sidecar = sidecar.env_clear();
    sidecar = sidecar.env("PATH", std::env::var("PATH").unwrap_or_default());
    sidecar = sidecar.env("ARRPC_USER_ID", user_id);
    sidecar = sidecar.env("ARRPC_USER_NAME", user_name);
    sidecar = sidecar.env("ARRPC_BRIDGE_PORT", "13337");

    if no_rpc {
        sidecar = sidecar.env("ARRPC_NO_RPC_SERVER", "true");
    }
    if let Some(avatar_hash) = avatar {
        sidecar = sidecar.env("ARRPC_USER_AVATAR", avatar_hash);
    }

    log::info!("[rpc] Spawning arRPC sidecar...");

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    let sidecar_app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        use tauri::Emitter;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let trimmed = text.trim();
                    log::info!("[rpc-sidecar] {}", trimmed);

                    if trimmed.starts_with("JSON_BRIDGE_MSG:") {
                        let json = &trimmed["JSON_BRIDGE_MSG:".len()..];
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
                            let _ = sidecar_app.emit("arrpc-activity", value);
                        }
                    }
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
        let _ = child.kill();
    }
    Ok(())
}

// ─── OAuth loopback server ────────────────────────────────────────────────────

#[tauri::command]
fn is_failover(state: tauri::State<'_, FailoverState>) -> bool {
    state.is_failover
}

#[tauri::command]
fn get_cli_args(state: tauri::State<'_, CliArgs>) -> bool {
    state.minimized
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