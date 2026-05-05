use std::ffi::OsStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

use serde::{Deserialize, Serialize};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};

#[cfg(windows)]
fn get_foreground_info() -> Option<(u32, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut process_id = 0;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 {
            return None;
        }

        let mut buffer = [0u16; 512];
        let len = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        let title = if len > 0 {
            String::from_utf16_lossy(&buffer[..len as usize])
        } else {
            String::new()
        };

        Some((process_id, title))
    }
}

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
    pub exe: String,
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

            #[cfg(windows)]
            {
                if let Some((fg_pid, fg_title)) = get_foreground_info() {
                    if let Some(process) = sys.process(sysinfo::Pid::from(fg_pid as usize)) {
                        let process_exe_name = process.name();
                        let fg_title_lower = fg_title.to_lowercase();

                        for game in &watch_list {
                            for exe in &game.executables {
                                let exe_path = std::path::Path::new(&exe.name);
                                let exe_filename = exe_path
                                    .file_name()
                                    .unwrap_or_else(|| OsStr::new(&exe.name));

                                if process_exe_name == exe_filename {
                                    let game_name_lower = game.name.to_lowercase();
                                    let exe_lower = exe_filename.to_string_lossy().to_lowercase();
                                    let exe_name_only =
                                        exe_lower.strip_suffix(".exe").unwrap_or(&exe_lower);

                                    // Robust check: window title should match game name or exe name
                                    if fg_title_lower.contains(&game_name_lower)
                                        || fg_title_lower.contains(exe_name_only)
                                    {
                                        detected_name = Some(game.name.clone());
                                        detected_exe =
                                            Some(process_exe_name.to_string_lossy().into_owned());
                                        break;
                                    }
                                }
                            }
                            if detected_name.is_some() {
                                break;
                            }
                        }
                    }
                }
            }

            #[cfg(not(windows))]
            {
                // Fallback to "is running" check for non-Windows platforms
                for game in &watch_list {
                    for exe in &game.executables {
                        // Normalize executable name: handle paths by taking only the filename
                        let exe_path = std::path::Path::new(&exe.name);
                        let exe_filename = exe_path
                            .file_name()
                            .unwrap_or_else(|| OsStr::new(&exe.name));

                        let found = sys.processes_by_name(exe_filename).next().is_some();

                        if found {
                            detected_name = Some(game.name.clone());
                            detected_exe = Some(exe_filename.to_string_lossy().to_string());
                            break;
                        }
                    }
                    if detected_name.is_some() {
                        break;
                    }
                }
            }

            // Only emit on state changes
            match (&previous_game, &detected_name) {
                (None, Some(name)) => {
                    // Game just started
                    let exe_str = detected_exe.as_deref().unwrap_or("unknown");
                    log::info!("[game_scanner] Detected: {} by {}", name, exe_str);
                    let _ = app.emit(
                        "game-activity",
                        GameActivity {
                            name: name.clone(),
                            exe: exe_str.to_string(),
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
                            exe: "".to_string(),
                            is_running: false,
                        },
                    );
                }
                (Some(prev), Some(name)) if prev != name => {
                    // Switched games
                    let exe_str = detected_exe.as_deref().unwrap_or("unknown");
                    log::info!(
                        "[game_scanner] Switched: {} -> {} by {}",
                        prev,
                        name,
                        exe_str
                    );
                    let _ = app.emit(
                        "game-activity",
                        GameActivity {
                            name: name.clone(),
                            exe: exe_str.to_string(),
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
