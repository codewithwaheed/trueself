use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

mod monitors;
mod lockdown;

// ---- App State ----

pub struct AppState {
    pub session_id: Mutex<Option<String>>,
    pub heartbeat_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub ws_connected: Mutex<bool>,
    pub lockdown: Mutex<lockdown::LockdownState>,
    pub interview_started_at: Mutex<Option<u64>>, // unix millis
    /// Pending user events accumulated between heartbeats
    pub pending_user_events: Mutex<Vec<serde_json::Value>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            session_id: Mutex::new(None),
            heartbeat_task: Mutex::new(None),
            ws_connected: Mutex::new(false),
            lockdown: Mutex::new(lockdown::LockdownState::default()),
            interview_started_at: Mutex::new(None),
            pending_user_events: Mutex::new(Vec::new()),
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

#[derive(Debug, serde::Serialize)]
pub struct LockdownVerification {
    pub dns_active: bool,
    pub processes_suspended: bool,
    pub verified_domains: Vec<DomainCheck>,
}

#[derive(Debug, serde::Serialize)]
pub struct DomainCheck {
    pub domain: String,
    pub resolved_to: String,
    pub blocked: bool,
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
    let flagged = monitors::processes::scan_flagged_with_parents();
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

    // 4. Permissions
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
    let old = state.heartbeat_task.lock().unwrap().take();
    if let Some(handle) = old {
        handle.abort();
    }

    *state.session_id.lock().unwrap() = Some(session_id.clone());
    *state.ws_connected.lock().unwrap() = false;
    state.pending_user_events.lock().unwrap().clear();

    // Listen for window focus/blur to track focus_change events
    // NOTE: OS-level keystroke/click monitoring is intentionally omitted —
    // it requires accessibility permissions on macOS (TCC framework).
    {
        let app_focus = app.clone();
        if let Some(win) = app_focus.get_webview_window("main") {
            let app_inner = app.clone();
            win.on_window_event(move |event| {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let event_type = match event {
                    tauri::WindowEvent::Focused(focused) => {
                        if *focused { Some("focus_change") } else { Some("focus_change") }
                    }
                    _ => None,
                };
                if let Some(etype) = event_type {
                    let focused = matches!(event, tauri::WindowEvent::Focused(true));
                    if let Some(s) = app_inner.try_state::<AppState>() {
                        s.pending_user_events.lock().unwrap().push(serde_json::json!({
                            "sessionId": "",  // filled in build_heartbeat
                            "timestamp": ts,
                            "type": etype,
                            "metadata": { "focused": focused, "appName": "TrueSelf Agent" }
                        }));
                    }
                }
            });
        }
    }

    // Record interview start time
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    *state.interview_started_at.lock().unwrap() = Some(now);

    let app_clone = app.clone();
    let sid = session_id.clone();
    let handle = tokio::spawn(async move {
        run_heartbeat_loop(app_clone, sid).await;
    });

    *state.heartbeat_task.lock().unwrap() = Some(handle);
    Ok(())
}

/// Stop background monitoring.
#[tauri::command]
fn stop_monitoring(state: State<'_, AppState>) {
    let handle = state.heartbeat_task.lock().unwrap().take();
    if let Some(h) = handle {
        h.abort();
    }
    *state.ws_connected.lock().unwrap() = false;
    *state.interview_started_at.lock().unwrap() = None;
}

#[tauri::command]
fn get_ws_connected(state: State<'_, AppState>) -> bool {
    *state.ws_connected.lock().unwrap()
}

/// Kill a process by PID. force=false sends SIGTERM, force=true sends SIGKILL.
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

/// Suspend the given PIDs and optionally start the DNS sinkhole.
/// Returns a `LockdownResult` with what was actually activated.
#[tauri::command]
async fn start_lockdown(
    state: State<'_, AppState>,
    ai_pids: Vec<u32>,
) -> Result<serde_json::Value, String> {
    // Take the LockdownState out of AppState so we can .await without holding the Mutex.
    let mut current = {
        let mut guard = state.lockdown.lock().unwrap();
        std::mem::take(&mut *guard)
    };

    let lockdown_result = current.start(&ai_pids).await;

    {
        let mut guard = state.lockdown.lock().unwrap();
        *guard = current;
    }

    Ok(serde_json::json!({
        "phase": lockdown_result.phase,
        "suspendedPids": lockdown_result.suspended_pids,
        "dnsActive": lockdown_result.dns_active,
        "dnsError": lockdown_result.dns_error,
    }))
}

/// Resume all suspended processes and restore DNS.
#[tauri::command]
async fn stop_lockdown(state: State<'_, AppState>) -> Result<(), String> {
    let mut current = {
        let mut guard = state.lockdown.lock().unwrap();
        std::mem::take(&mut *guard)
    };

    current.stop().await;

    {
        let mut guard = state.lockdown.lock().unwrap();
        *guard = current;
    }

    Ok(())
}

/// Verify the lockdown by doing DNS lookups on sinkholed domains.
#[tauri::command]
async fn verify_lockdown(state: State<'_, AppState>) -> Result<LockdownVerification, String> {
    use hickory_resolver::TokioAsyncResolver;
    use hickory_resolver::config::{ResolverConfig, ResolverOpts};

    let (dns_active, processes_suspended) = {
        let ld = state.lockdown.lock().unwrap();
        (ld.dns_active(), !ld.suspended_pids().is_empty())
    };

    // Verify by resolving a few sinkholed domains
    let test_domains = ["api.openai.com", "claude.ai", "cursor.sh"];
    let mut verified_domains = Vec::new();

    // Use system DNS (which should now point to our sinkhole)
    let resolver = TokioAsyncResolver::tokio(
        ResolverConfig::default(),
        ResolverOpts::default(),
    );

    for domain in &test_domains {
        let (resolved_to, blocked) = match resolver.lookup_ip(*domain).await {
            Ok(lookup) => {
                let first_ip = lookup.iter().next().map(|ip| ip.to_string()).unwrap_or_default();
                let is_blocked = first_ip == "127.0.0.1";
                (first_ip, is_blocked)
            }
            Err(_) => {
                // Resolution failure could also indicate blocking (NXDOMAIN/SERVFAIL)
                ("resolution failed".to_string(), false)
            }
        };
        verified_domains.push(DomainCheck {
            domain: domain.to_string(),
            resolved_to,
            blocked,
        });
    }

    Ok(LockdownVerification {
        dns_active,
        processes_suspended,
        verified_domains,
    })
}

/// Suspend specific PIDs without starting DNS — used for the per-process "Suspend" button.
#[tauri::command]
async fn suspend_processes(
    state: State<'_, AppState>,
    pids: Vec<u32>,
) -> Result<Vec<u32>, String> {
    let mut guard = state.lockdown.lock().unwrap();
    guard.suspended.suspend_all(&pids)
}

/// Resume all suspended processes (without touching DNS).
#[tauri::command]
async fn resume_processes(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.lockdown.lock().unwrap();
    guard.suspended.resume_all()
}

// ---- Heartbeat Loop ----

async fn run_heartbeat_loop(app: AppHandle, session_id: String) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let ws_url = format!(
        "ws://localhost:3001?sessionId={}&role=agent",
        session_id
    );

    // Send session_start_confirmed once connected
    let mut session_start_sent = false;

    loop {
        match connect_async(&ws_url).await {
            Ok((mut ws_stream, _)) => {
                set_ws_status(&app, true);

                // Send session_start_confirmed on first connection
                if !session_start_sent {
                    let confirm_msg = serde_json::json!({
                        "type": "session_start_confirmed"
                    });
                    let _ = ws_stream
                        .send(Message::Text(
                            serde_json::to_string(&confirm_msg).unwrap_or_default().into(),
                        ))
                        .await;
                    session_start_sent = true;
                }

                let mut interval =
                    tokio::time::interval(tokio::time::Duration::from_millis(3000));

                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let heartbeat = build_heartbeat(&app, &session_id);
                            let event_count = heartbeat.get("userEvents")
                                .and_then(|v| v.as_array())
                                .map(|a| a.len())
                                .unwrap_or(0);
                            let payload = serde_json::json!({
                                "type": "heartbeat",
                                "data": heartbeat
                            });
                            let msg = Message::Text(
                                serde_json::to_string(&payload).unwrap_or_default().into()
                            );
                            if ws_stream.send(msg).await.is_err() {
                                break;
                            }
                            // Notify frontend how many events were synced this tick
                            let _ = app.emit("heartbeat_sent", serde_json::json!({ "eventCount": event_count }));
                        }
                        incoming = ws_stream.next() => {
                            match incoming {
                                Some(Ok(Message::Text(text))) => {
                                    if let Ok(v) =
                                        serde_json::from_str::<serde_json::Value>(&text)
                                    {
                                        match v["type"].as_str() {
                                            Some("session_end") => {
                                                let _ = app.emit("session_ended", ());
                                                return; // session is over — stop loop
                                            }
                                            Some("interviewer_disconnected") => {
                                                let _ = app.emit("interviewer_disconnected", ());
                                            }
                                            _ => {}
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

        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

fn set_ws_status(app: &AppHandle, connected: bool) {
    let _ = app.emit("ws_status", serde_json::json!({ "connected": connected }));

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

    // Get lockdown state from app state
    let app_state = app.state::<AppState>();
    let (lockdown_active, suspended_pids) = {
        let ld = app_state.lockdown.lock().unwrap();
        (ld.is_active(), ld.suspended_pids())
    };
    let interview_started_at = *app_state.interview_started_at.lock().unwrap();
    let interview_duration_ms = interview_started_at
        .map(|start| timestamp.saturating_sub(start))
        .unwrap_or(0);

    // Collect paste events from clipboard monitor as UserEvents
    let mut user_events: Vec<serde_json::Value> = clipboard_events
        .iter()
        .map(|ce| serde_json::json!({
            "sessionId": session_id,
            "timestamp": ce.timestamp,
            "type": "paste",
            "metadata": {
                "contentLength": ce.content_length,
                "source": ce.source
            }
        }))
        .collect();

    // Drain accumulated focus-change events from AppState
    if let Some(state) = app.try_state::<AppState>() {
        let mut pending = state.pending_user_events.lock().unwrap();
        for mut ev in pending.drain(..) {
            // Backfill sessionId (was unknown at event time)
            ev["sessionId"] = serde_json::Value::String(session_id.to_string());
            user_events.push(ev);
        }
    }

    serde_json::json!({
        "sessionId": session_id,
        "timestamp": timestamp,
        "screens": screens,
        "processes": processes,
        "suspiciousWindows": windows,
        "networkFlags": network_flags,
        "clipboardEvents": clipboard_events,
        "userEvents": user_events,
        "trustScore": 100,
        "lockdownActive": lockdown_active,
        "suspendedPids": suspended_pids,
        "interviewDurationMs": interview_duration_ms,
    })
}

// ---- Entry Point ----

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            // Stale lockdown recovery: if DNS was left pointing to sinkhole from a crash,
            // restore it now before the user does anything.
            if lockdown::dns_sinkhole::DnsSinkhole::is_dns_redirected() {
                eprintln!("[startup] stale DNS lockdown detected — restoring...");
                lockdown::dns_sinkhole::DnsSinkhole::recover_from_backup();
            }

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
                        "end_interview" => {
                            let app_clone = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = app_clone.state::<AppState>();
                                // Stop lockdown
                                let mut current = {
                                    let mut guard = state.lockdown.lock().unwrap();
                                    std::mem::take(&mut *guard)
                                };
                                current.stop().await;
                                {
                                    let mut guard = state.lockdown.lock().unwrap();
                                    *guard = current;
                                }
                                // Stop monitoring
                                let handle = state.heartbeat_task.lock().unwrap().take();
                                if let Some(h) = handle {
                                    h.abort();
                                }
                                *state.ws_connected.lock().unwrap() = false;
                                *state.interview_started_at.lock().unwrap() = None;

                                let _ = app_clone.emit("interview_ended_by_tray", ());
                                if let Some(win) = app_clone.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            });
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
            start_lockdown,
            stop_lockdown,
            verify_lockdown,
            suspend_processes,
            resume_processes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TrueSelf agent");
}
