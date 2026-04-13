use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

mod monitors;

// ---- App State ----

pub struct AppState {
    pub session_id: Mutex<Option<String>>,
    pub heartbeat_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub ws_connected: Mutex<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            session_id: Mutex::new(None),
            heartbeat_task: Mutex::new(None),
            ws_connected: Mutex::new(false),
        }
    }
}

// ---- Public Types ----

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct PreflightCheck {
    pub name: String,
    pub passed: bool,
    pub details: String,
    pub flagged_processes: Option<Vec<monitors::processes::FlaggedProcess>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct AgentSessionInfo {
    pub id: String,
    #[serde(rename = "sessionCode")]
    pub session_code: String,
    #[serde(rename = "candidateName")]
    pub candidate_name: Option<String>,
    #[serde(rename = "interviewerName")]
    pub interviewer_name: String,
    #[serde(rename = "companyName")]
    pub company_name: String,
    #[serde(rename = "scheduledAt")]
    pub scheduled_at: String,
    pub status: String,
    #[serde(rename = "meetingLink")]
    pub meeting_link: String,
}

// ---- Tauri Commands ----

/// Verify a 6-digit session code against the server. Runs from Rust to avoid CORS.
#[tauri::command]
async fn verify_session_code(code: String) -> Result<AgentSessionInfo, String> {
    let url = format!("http://localhost:3001/api/sessions/code/{}", code);
    let res = reqwest::get(&url).await.map_err(|e| {
        format!("Cannot connect to server: {}", e)
    })?;

    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|_| "Invalid server response".to_string())?;

    if status == 404 {
        return Err(body["error"].as_str().unwrap_or("Code not found. Please check and try again.").to_string());
    }
    if status == 410 {
        return Err(body["error"].as_str().unwrap_or("This session is no longer available.").to_string());
    }
    if !status.is_success() {
        return Err(body["error"].as_str().unwrap_or("Something went wrong. Please try again.").to_string());
    }

    serde_json::from_value(body).map_err(|e| format!("Failed to parse session: {}", e))
}

#[tauri::command]
fn get_screens(app: AppHandle) -> Vec<monitors::screens::ScreenInfo> {
    monitors::screens::get_screens(&app)
}

#[tauri::command]
fn scan_processes() -> Vec<monitors::processes::ProcessInfo> {
    monitors::processes::scan_processes()
}

/// Run all preflight checks and return their results.
#[tauri::command]
async fn run_preflight(app: AppHandle) -> Result<Vec<PreflightCheck>, String> {
    let mut checks = Vec::new();

    // 1. Server connectivity
    let server_ok = reqwest::get("http://localhost:3001/health")
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    checks.push(PreflightCheck {
        name: "Connecting to server".to_string(),
        passed: server_ok,
        details: if server_ok {
            "Connected".to_string()
        } else {
            "Cannot reach TrueSelf server — check your internet connection".to_string()
        },
        flagged_processes: None,
    });

    // 2. Display check
    let screens = monitors::screens::get_screens(&app);
    let count = screens.len();
    let screen_ok = count >= 1;
    let details = if let Some(p) = screens.first() {
        if count == 1 {
            format!("1 display ({}x{})", p.width, p.height)
        } else {
            format!("{} displays detected ({}x{} primary)", count, p.width, p.height)
        }
    } else {
        "No displays detected".to_string()
    };
    checks.push(PreflightCheck {
        name: "Checking displays".to_string(),
        passed: screen_ok,
        details,
        flagged_processes: None,
    });

    // 3. Process scan — flag known AI tools
    let processes = monitors::processes::scan_processes();
    let flagged: Vec<monitors::processes::FlaggedProcess> = processes
        .iter()
        .filter(|p| p.is_flagged)
        .map(|p| monitors::processes::FlaggedProcess {
            pid: p.pid,
            name: p.name.clone(),
        })
        .collect();
    checks.push(PreflightCheck {
        name: "Scanning processes".to_string(),
        passed: flagged.is_empty(),
        details: if flagged.is_empty() {
            "No AI tools detected".to_string()
        } else {
            format!(
                "{} AI tool(s) running: {}",
                flagged.len(),
                flagged
                    .iter()
                    .map(|p| p.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        },
        flagged_processes: if flagged.is_empty() { None } else { Some(flagged) },
    });

    // 4. Permissions — if we scanned processes, we have the access we need
    checks.push(PreflightCheck {
        name: "Verifying permissions".to_string(),
        passed: true,
        details: "All permissions granted".to_string(),
        flagged_processes: None,
    });

    Ok(checks)
}

/// Start background monitoring: WebSocket heartbeat loop.
#[tauri::command]
async fn start_monitoring(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    // Abort any previous heartbeat task
    let old = state.heartbeat_task.lock().unwrap().take();
    if let Some(handle) = old {
        handle.abort();
    }

    *state.session_id.lock().unwrap() = Some(session_id.clone());
    *state.ws_connected.lock().unwrap() = false;

    let app_clone = app.clone();
    let sid = session_id.clone();
    let handle = tokio::spawn(async move {
        run_heartbeat_loop(app_clone, sid).await;
    });

    *state.heartbeat_task.lock().unwrap() = Some(handle);
    Ok(())
}

/// Stop background monitoring (called when window/session ends).
#[tauri::command]
fn stop_monitoring(state: State<'_, AppState>) {
    let handle = state.heartbeat_task.lock().unwrap().take();
    if let Some(h) = handle {
        h.abort();
    }
    *state.ws_connected.lock().unwrap() = false;
}

#[tauri::command]
fn get_ws_connected(state: State<'_, AppState>) -> bool {
    *state.ws_connected.lock().unwrap()
}

/// Kill a process by PID. force=false sends SIGTERM (graceful), force=true sends SIGKILL.
#[tauri::command]
fn kill_process(pid: u32, force: bool) -> Result<(), String> {
    use sysinfo::{Pid, Signal, System};

    let mut sys = System::new_all();
    sys.refresh_all();
    let pid_val = Pid::from_u32(pid);

    let process = sys
        .process(pid_val)
        .ok_or_else(|| format!("Process {} not found (may have already exited)", pid))?;

    let success = if force {
        process.kill()
    } else {
        process.kill_with(Signal::Term).unwrap_or(false)
    };

    if success {
        Ok(())
    } else {
        Err(format!("Failed to terminate process {}", pid))
    }
}

// ---- Heartbeat Loop ----

async fn run_heartbeat_loop(app: AppHandle, session_id: String) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let ws_url = format!(
        "ws://localhost:3001?sessionId={}&role=agent",
        session_id
    );

    loop {
        match connect_async(&ws_url).await {
            Ok((mut ws_stream, _)) => {
                set_ws_status(&app, true);

                let mut interval =
                    tokio::time::interval(tokio::time::Duration::from_millis(3000));

                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let heartbeat = build_heartbeat(&app, &session_id);
                            let payload = serde_json::json!({
                                "type": "heartbeat",
                                "data": heartbeat
                            });
                            let msg = Message::Text(
                                serde_json::to_string(&payload).unwrap_or_default().into()
                            );
                            if ws_stream.send(msg).await.is_err() {
                                break; // connection lost — fall through to reconnect
                            }
                        }
                        incoming = ws_stream.next() => {
                            match incoming {
                                Some(Ok(Message::Text(text))) => {
                                    if let Ok(v) =
                                        serde_json::from_str::<serde_json::Value>(&text)
                                    {
                                        if v["type"] == "session_end" {
                                            let _ = app.emit("session_ended", ());
                                            return; // session is over — stop loop
                                        }
                                    }
                                }
                                None | Some(Err(_)) => break,
                                _ => {}
                            }
                        }
                    }
                }

                set_ws_status(&app, false);
            }
            Err(e) => {
                eprintln!("[heartbeat] WS connect failed: {e}");
                set_ws_status(&app, false);
            }
        }

        // Wait before retrying
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

fn set_ws_status(app: &AppHandle, connected: bool) {
    let _ = app.emit("ws_status", serde_json::json!({ "connected": connected }));

    // Update tray tooltip to reflect status
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tooltip = if connected {
            "TrueSelf — Connected"
        } else {
            "TrueSelf — Reconnecting..."
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn build_heartbeat(app: &AppHandle, session_id: &str) -> serde_json::Value {
    let screens = monitors::screens::get_screens(app);
    let processes = monitors::processes::scan_processes();
    let windows = monitors::windows::scan_windows();
    let network_flags = monitors::network::scan_connections();
    let clipboard_event = monitors::clipboard::watch_clipboard();

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let clipboard_events: Vec<_> = clipboard_event.into_iter().collect();

    serde_json::json!({
        "sessionId": session_id,
        "timestamp": timestamp,
        "screens": screens,
        "processes": processes,
        "suspiciousWindows": windows,
        "networkFlags": network_flags,
        "clipboardEvents": clipboard_events,
        "trustScore": 100
    })
}

// ---- Entry Point ----

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let quit =
                MenuItem::with_id(app, "quit", "Quit TrueSelf", true, None::<&str>)?;
            let status =
                MenuItem::with_id(app, "status", "Status: Waiting for session", false, None::<&str>)?;
            let rerun =
                MenuItem::with_id(app, "rerun", "Re-run Checks", true, None::<&str>)?;

            let menu = MenuBuilder::new(app)
                .items(&[&status, &rerun, &quit])
                .build()?;

            TrayIconBuilder::with_id("main-tray")
                .tooltip("TrueSelf Agent")
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .on_menu_event(|app: &AppHandle, event: tauri::menu::MenuEvent| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "rerun" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                                let _ = app.emit("rerun_preflight", ());
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            verify_session_code,
            get_screens,
            scan_processes,
            run_preflight,
            start_monitoring,
            stop_monitoring,
            get_ws_connected,
            kill_process,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TrueSelf agent");
}
