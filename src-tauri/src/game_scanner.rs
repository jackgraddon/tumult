use std::ffi::OsStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

use serde::{Deserialize, Serialize};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

/// A single executable entry from the detectable games list.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GameExecutable {
    pub os: String,
    pub name: String,
}

/// A detectable game entry sent from the frontend (sourced from Discord's API).
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DetectableGame {
    pub id: String,
    pub name: String,
    pub executables: Vec<GameExecutable>,
}

/// Payload emitted to the frontend when activity changes.
#[derive(Clone, Debug, Serialize)]
pub struct GameActivity {
    pub name: String,
    pub is_running: bool,
}

/// Shared state for the scanner's watch list and current detected game.
pub struct ScannerState {
    pub watch_list: Mutex<Vec<DetectableGame>>,
    pub current_game: Mutex<Option<String>>,
    pub is_enabled: Mutex<bool>,
    pub notify: Arc<Notify>,
}

#[tauri::command]
pub fn set_scanner_enabled(state: tauri::State<'_, Arc<ScannerState>>, enabled: bool) {
    let mut is_enabled = state.is_enabled.lock().unwrap();
    if *is_enabled != enabled {
        *is_enabled = enabled;
        log::info!("[game_scanner] Scanner state set to: {}", enabled);
        // Wake up the loop immediately if enabled, or to process disable
        state.notify.notify_one();
    }
}

/// Tauri command: receives the filtered detectable games list from the frontend.
#[tauri::command]
pub fn update_watch_list(state: tauri::State<'_, Arc<ScannerState>>, games: Vec<DetectableGame>) {
    let count = games.len();
    for game in &games {
        let _exe_names: Vec<&str> = game.executables.iter().map(|e| e.name.as_str()).collect();
    }
    let mut list = state.watch_list.lock().unwrap();
    *list = games;
    log::info!("[game_scanner] Watch list updated with {} games", count);
}

/// Starts the background game scanner loop.
pub fn start(app: AppHandle, state: Arc<ScannerState>) {
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new();

        loop {
            // Check enabled state first
            let is_enabled = *state.is_enabled.lock().unwrap();

            if !is_enabled {
                // If disabled, wait indefinitely for a notification (enable command)
                log::info!("[game_scanner] Scanner disabled, waiting...");
                state.notify.notified().await;
                log::info!("[game_scanner] Scanner woke up!");
                continue;
            }

            // If enabled, proceed with scan
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

            let watch_list = state.watch_list.lock().unwrap().clone();
            let previous_game = state.current_game.lock().unwrap().clone();

            let mut detected_name: Option<String> = None;
            let mut detected_exe: Option<String> = None;

            // Check each game in the watch list
            for game in &watch_list {
                for exe in &game.executables {
                    let exe_name = OsStr::new(&exe.name);
                    let found = sys.processes_by_name(exe_name).next().is_some();

                    if found {
                        detected_name = Some(game.name.clone());
                        detected_exe = Some(exe.name.clone());
                        break;
                    }
                }
                if detected_name.is_some() {
                    break;
                }
            }

            // Only emit on state changes
            match (&previous_game, &detected_name) {
                (None, Some(name)) => {
                    // Game just started
                    let exe_str = detected_exe.as_deref().unwrap_or("unknown");
                    log::info!("[game_scanner] Detected: {} (exe: {})", name, exe_str);
                    let _ = app.emit(
                        "game-activity",
                        GameActivity {
                            name: name.clone(),
                            is_running: true,
                        },
                    );
                }
                (Some(prev), None) => {
                    // Game just stopped
                    log::info!("[game_scanner] Stopped: {}", prev);
                    let _ = app.emit(
                        "game-activity",
                        GameActivity {
                            name: prev.clone(),
                            is_running: false,
                        },
                    );
                }
                (Some(prev), Some(name)) if prev != name => {
                    // Switched games
                    let exe_str = detected_exe.as_deref().unwrap_or("unknown");
                    log::info!("[game_scanner] Switched: {} -> {} (exe: {})", prev, name, exe_str);
                    let _ = app.emit(
                        "game-activity",
                        GameActivity {
                            name: name.clone(),
                            is_running: true,
                        },
                    );
                }
                _ => {
                    // No change — don't emit
                }
            }

            // Update current state
            *state.current_game.lock().unwrap() = detected_name;

            // Wait for 15s OR a notification (e.g. disable command or instant re-scan)
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(15)) => {},
                _ = state.notify.notified() => {
                    log::info!("[game_scanner] Scan interrupt received");
                }
            }
        }
    });
}
