mod game_scanner;
mod crypto;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use argon2::{Argon2, Algorithm, Version, Params};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create the shared scanner state
    let scanner_state = Arc::new(game_scanner::ScannerState {
        watch_list: Mutex::new(Vec::new()),
        current_game: Mutex::new(None),
        is_enabled: Mutex::new(false),
        notify: Arc::new(Notify::new()),
    });

    let scanner_state_for_setup = scanner_state.clone();

    let crypto_state = Arc::new(crypto::CryptoState {
        calls: Mutex::new(HashMap::new()),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
.plugin(tauri_plugin_stronghold::Builder::new(|password| {
    let params = Params::new(
        65536, // m_cost (memory in KiB)
        2,     // t_cost (iterations)
        4,     // p_cost (parallelism)
        None   // output length (None = default 32 bytes)
    ).expect("Invalid Argon2 params");

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let salt = b"ruby_chat_salt_v1";
    let mut key = vec![0u8; 32];

    argon2
        .hash_password_into(password.as_ref(), salt, &mut key)
        .expect("Failed to derive key");

    key
}).build())
        .manage(scanner_state)
        .manage(crypto_state)
        .invoke_handler(tauri::generate_handler![
            game_scanner::update_watch_list,
            game_scanner::set_scanner_enabled,
            start_oauth_server,
            crypto::initialize_call_encryption,
            crypto::encrypt_media_frame,
            crypto::decrypt_media_frame,
            crypto::encrypt_attachment,
            crypto::decrypt_attachment
        ])
        .setup(move |app| {
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri::Manager;
                let window = app.get_webview_window("main").unwrap();
                // 1. Strip the clunky default OS title bar
                window.set_decorations(false).unwrap();
                // 2. Force the OS to redraw the native drop shadow and rounded corners!
                window.set_shadow(true).unwrap();
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start the background game scanner
            game_scanner::start(app.handle().clone(), scanner_state_for_setup);

            Ok(())
        })

        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn start_oauth_server() -> Result<String, String> {
    // Run in a blocking thread to keep the Tauri UI completely responsive
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
                    // Set a read timeout on the stream itself
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                    let mut buffer = [0; 4096];
                    if let Ok(bytes_read) = stream.read(&mut buffer) {
                        let request = String::from_utf8_lossy(&buffer[..bytes_read]);

                        // 1. The Greedy Trap: Ignore favicons and keep the server alive!
                        if request.contains("GET /favicon.ico") {
                            let _ = stream.write_all(b"HTTP/1.1 404 NOT FOUND\r\n\r\n");
                            continue;
                        }

                        // 2. Look for the actual GET request
                        if request.starts_with("GET /") {
                            let first_line = request.lines().next().unwrap_or("");
                            let parts: Vec<&str> = first_line.split_whitespace().collect();

                            if parts.len() >= 2 {
                                let path = parts[1]; // Extracts "/callback?code=..."

                                // 3. ONLY terminate the server if MAS actually sent the OAuth payload
                                if path.contains("code=") || path.contains("error=") {
                                    // A sleek, dark-mode success screen!
                                    let html = "<html><body style=\"background: #0f1115; color: #fff; font-family: system-ui, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0;\"><h2>Authentication Successful</h2><p style=\"color: #888;\">You can close this tab and return to Ruby Chat.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>";
                                    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}", html.len(), html);

                                    let _ = stream.write_all(response.as_bytes());
                                    let _ = stream.flush();

                                    // Break the loop and hand the URL back to Vue
                                    return Ok(format!("http://localhost:1420{}", path));
                                }
                            }
                        }
                        // Default response for any other random browser pings
                        let _ = stream.write_all(b"HTTP/1.1 404 NOT FOUND\r\n\r\n");
                    }
                }
                Err(_) => {
                    return Err("OAuth server timed out after 5 minutes.".to_string());
                }
            }
        }
        Err("Listener closed unexpectedly.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}