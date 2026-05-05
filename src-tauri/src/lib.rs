use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
#[cfg(target_os = "windows")]
use tauri_plugin_frame::WebviewWindowExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
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

pub struct AppQuit(pub std::sync::atomic::AtomicBool);

/// A generalized window manager to keep strong references to all windows,
/// preventing them from being dropped even if they are hidden.
pub struct WindowMap(pub Mutex<std::collections::HashMap<String, tauri::WebviewWindow>>);

fn show_main_window(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        #[cfg(target_os = "macos")]
        {
            // 1. Force policy to Regular to show Dock icon
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

            // Wait for macOS to actually process the policy switch
            // before we demand the window render, avoiding a state clash
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

            let _ = app.show();
        }

        let window = if let Some(w) = app.get_webview_window("main") {
            w
        } else {
            // RE-CREATE FALLBACK: If the window was destroyed, build it again.
            log::warn!("[window] 'main' window missing, re-creating...");

            let builder = tauri::WebviewWindowBuilder::new(
                &app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Tumult")
            .inner_size(1200.0, 800.0)
            .min_inner_size(1000.0, 500.0)
            .resizable(true);

            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);

            let w = builder.build().unwrap();

            // Re-apply navigation if we are not in failover
            let is_failover = app
                .try_state::<FailoverState>()
                .map(|s| s.is_failover)
                .unwrap_or(false);
            if !is_failover && !cfg!(debug_assertions) {
                let _ = w.navigate("https://tumult.jackg.cc".parse().unwrap());
            }

            w
        };

        // 2. Standard restoration
        let _ = window.unminimize();

        let _ = window.show();
        let _ = window.set_focus();

        #[cfg(target_os = "windows")]
        {
            // Windows-specific: ensure taskbar focus and bring to top
            let _ = window.set_skip_taskbar(false);
            let _ = window.create_overlay_titlebar();
        }

        // 3. THE "KICKSTART": Open DevTools and request attention
        // window.open_devtools();
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));

        // 4. Force a resize nudge by 1 pixel to wake the renderer
        if let Ok(size) = window.inner_size() {
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: size.width + 1,
                height: size.height,
            }));
            let _ = window.set_size(tauri::Size::Physical(size));
        }
    });
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

    let builder = tauri::Builder::default();

    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_frame::init());

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .manage(scanner_state.clone())
        .manage(AppQuit(std::sync::atomic::AtomicBool::new(false)))
        .manage(RpcState {
            child: Mutex::new(None),
        })
        .manage(RsRpcState {
            child: Mutex::new(None),
        })
        .manage(WindowMap(Mutex::new(std::collections::HashMap::new())))
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
            get_cli_args,
            get_os_theme
        ])
        .setup(move |app| {
            // dark_light::subscribe does not exist in the published crate, and
            // dark_light::detect() misses Control Center toggles on macOS because
            // those update NSApplication.effectiveAppearance rather than the
            // AppleInterfaceStyle UserDefaults key. Shelling out to `defaults read`
            // reads the live value and catches all theme change paths.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                fn read_macos_theme() -> &'static str {
                    let is_dark = std::process::Command::new("defaults")
                        .args(["read", "-g", "AppleInterfaceStyle"])
                        .output()
                        .map(|o| String::from_utf8_lossy(&o.stdout).trim().eq_ignore_ascii_case("dark"))
                        .unwrap_or(false);
                    if is_dark { "dark" } else { "light" }
                }

                let mut last_theme = read_macos_theme();
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let theme = read_macos_theme();
                    if theme != last_theme {
                        last_theme = theme;
                        log::info!("[theme] OS theme changed: {}", theme);
                        let _ = app_handle.emit("os-theme-changed", theme);
                    }
                }
            });

            let window = app.get_webview_window("main").unwrap();

            // Register the main window in our generalized manager to ensure longevity
            app.state::<WindowMap>().0.lock().unwrap().insert("main".to_string(), window.clone());

            #[cfg(target_os = "windows")]
            window.create_overlay_titlebar().unwrap();

            #[cfg(target_os = "linux")]
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

            let mut store_minimized = false;
            if let Ok(store) = app.store("preferences.json") {
                if let Some(val) = store.get("matrix_start_minimized") {
                    store_minimized = val.as_bool().unwrap_or(false);
                }
            }

            if has_minimized_arg || store_minimized {
                log::info!("[setup] Starting minimized to tray via hide");
                let _ = window.hide();

                #[cfg(target_os = "macos")]
                {
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
                        let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    });
                }
            }

            if use_remote && !cfg!(debug_assertions) {
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

            let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let check_updates = MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &check_updates, &quit])?;

            let tray_icon = tauri::image::Image::from_path(
                app.path().resource_dir().unwrap().join("icons/tray/32x32.png")
            ).unwrap_or_else(|_| app.default_window_icon().unwrap().clone());

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("Tumult")
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            show_main_window(tray.app_handle());
                        }
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => {
                            show_main_window(tray.app_handle());
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // MUST BE SYNCHRONOUS: Calling prevent_close immediately to halt destruction
                    api.prevent_close();
                    log::info!("[global-window] CloseRequested intercepted, hiding instead of closing...");
                    let _ = window.hide();

                    #[cfg(target_os = "macos")]
                    {
                        let app_handle = window.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                        });
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    if window.is_minimized().unwrap_or(false) {
                        log::info!("[global-window] Minimized intercepted, hiding...");
                        let _ = window.unminimize();
                        let _ = window.hide();

                        #[cfg(target_os = "macos")]
                        {
                            let app_handle = window.app_handle().clone();
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                            });
                        }
                    }
                }
                tauri::WindowEvent::Destroyed { .. } => {
                    log::warn!("[global-window] Window is being DESTROYED! This shouldn't happen!");
                }
                _ => {}
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                log::info!("[menu] Quit requested via menu");
                app.state::<AppQuit>().0.store(true, std::sync::atomic::Ordering::Relaxed);
                app.exit(0);
            }
            "show" => {
                log::info!("[menu] Show requested via menu");
                show_main_window(app);
            }
            "check_updates" => {
                log::info!("[menu] Check updates requested via menu");
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("check-updates", ());
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                let quit = app_handle.state::<AppQuit>();
                if !quit.0.load(std::sync::atomic::Ordering::Relaxed) {
                    // MUST BE SYNCHRONOUS: Calling prevent_exit immediately to stop process termination
                    api.prevent_exit();
                    log::info!("[run-event] ExitRequested blocked - keeping application alive.");
                } else {
                    log::info!("[run-event] ExitRequested allowed - user quitting.");
                }
            }
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                 match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        // MUST BE SYNCHRONOUS: Absolute fail-safe to prevent window destruction
                        api.prevent_close();
                        log::info!("[run-event] Window '{}' CloseRequested - blocking exit as absolute fail-safe", label);
                    }
                    tauri::WindowEvent::Destroyed { .. } => {
                        log::warn!("[run-event] Window '{}' Destroyed!", label);
                    }
                    _ => {}
                 }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                show_main_window(app_handle);
            }
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

    let mut args = vec!["--bridge-port".to_string(), port.to_string()];

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
        use tauri::Emitter;
        use tauri_plugin_shell::process::CommandEvent;
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
fn get_os_theme() -> String {
    let is_dark = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .eq_ignore_ascii_case("dark")
        })
        .unwrap_or(false);
    if is_dark {
        "dark".to_string()
    } else {
        "light".to_string()
    }
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
