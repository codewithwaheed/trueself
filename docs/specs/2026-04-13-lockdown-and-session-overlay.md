# Technical Architecture: AI Process Suspension + DNS Sinkhole Lockdown & Session Overlay

**Date:** 2026-04-13
**Status:** Draft
**Scope:** Feature 1 (Lockdown) + Feature 2 (Session Overlay / Interview In-Progress Flow)

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [Feature 1: AI Process Suspension + DNS Sinkhole](#2-feature-1-ai-process-suspension--dns-sinkhole)
3. [Feature 2: Session Overlay + Interview In-Progress Flow](#3-feature-2-session-overlay--interview-in-progress-flow)
4. [Shared Type Additions](#4-shared-type-additions)
5. [Database Schema Changes](#5-database-schema-changes)
6. [WebSocket Protocol Changes](#6-websocket-protocol-changes)
7. [Server-Side Changes](#7-server-side-changes)
8. [Agent Frontend Changes](#8-agent-frontend-changes)
9. [Dashboard Frontend Changes](#9-dashboard-frontend-changes)
10. [Trust Score Integration](#10-trust-score-integration)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Risks and Trade-offs](#12-risks-and-trade-offs)

---

## 1. Current State Summary

### What Exists

**Agent (Rust + TS frontend):**
- `lib.rs`: AppState with `session_id`, `heartbeat_task`, `ws_connected` (all `Mutex`-wrapped)
- Tauri commands: `verify_session_code`, `get_screens`, `scan_processes`, `run_preflight`, `start_monitoring`, `stop_monitoring`, `get_ws_connected`, `kill_process`
- 5 monitors: `processes.rs` (scan + flagged detection), `screens.rs`, `windows.rs` (stub), `network.rs` (stub), `clipboard.rs` (stub)
- `kill_process` command uses `sysinfo` to send SIGTERM/SIGKILL
- Preflight flow: 4 checks (server connectivity, displays, process scan, permissions)
- Heartbeat loop: connects WS, sends heartbeat every 3s with screens/processes/windows/network/clipboard data
- System tray with "Quit TrueSelf", "Re-run Checks", "Status: Waiting for session" items
- 3 UI screens: Welcome (code entry), Preflight (checklist + process close UI), Ready (monitoring active)

**Server:**
- WebSocket: tracks `sessions` Map with `{ agent?: WebSocket, dashboards: Set<WebSocket> }`
- Forwards raw agent messages to all dashboard viewers
- Persists `alert` type messages as `TrustEvent` rows
- No server-side trust score computation yet (agent sends hardcoded `trustScore: 100`)
- No heartbeat gap detection or reconnect logic

**Shared Types (`packages/shared-types`):**
- `AgentHeartbeat`, `ScreenInfo`, `ProcessInfo`, `WindowInfo`, `NetworkFlag`, `ClipboardEvent`
- `TrustReport`, `TrustEvent` (severity: info/warning/critical)
- `WSMessageFromAgent` (heartbeat | alert | preflight_result)
- `WSMessageToAgent` (session_start | session_end | config_update)
- `AgentConfig` with heartbeat interval, flagged processes/domains, monitor toggles

**Database:**
- `InterviewSession` with status enum (PENDING/ACTIVE/COMPLETED/CANCELLED), `startedAt`, `endedAt`
- `TrustEvent` model with type, severity, message, data (JSON), timestamp

### What Does NOT Exist

- Process suspension (only kill exists)
- DNS sinkhole or any network-level blocking
- Privilege escalation handling
- Lockdown state management
- Server-side trust score computation
- Heartbeat gap detection / agent disconnect alerting
- Dashboard live monitoring view (only session list page exists)
- Session timer or interview-in-progress UI on agent side
- Alert sound/visual system on dashboard

---

## 2. Feature 1: AI Process Suspension + DNS Sinkhole

### 2.1 New Rust Modules

#### `apps/agent/src-tauri/src/lockdown/mod.rs`

Top-level lockdown module. Exports `start_lockdown` and `stop_lockdown`.

```
apps/agent/src-tauri/src/monitors/   (existing)
apps/agent/src-tauri/src/lockdown/   (NEW)
  mod.rs           -- LockdownState, start_lockdown(), stop_lockdown()
  suspend.rs       -- process suspension per-platform
  dns_sinkhole.rs  -- DNS server + system DNS redirection
  privilege.rs     -- privilege escalation helpers
```

Register in `lib.rs`: `mod lockdown;`

#### `lockdown/suspend.rs` -- Process Suspension

```rust
use sysinfo::{Pid, System};
use std::collections::HashSet;

/// Suspended process tracking
#[derive(Debug, Default)]
pub struct SuspendedProcesses {
    pids: HashSet<u32>,
}

impl SuspendedProcesses {
    /// Suspend a list of PIDs. Returns the set that was actually suspended.
    pub fn suspend_all(&mut self, pids: &[u32]) -> Result<Vec<u32>, String> {
        let mut suspended = Vec::new();
        for &pid in pids {
            self.suspend_one(pid)?;
            self.pids.insert(pid);
            suspended.push(pid);
        }
        Ok(suspended)
    }

    /// Resume all previously suspended processes.
    pub fn resume_all(&mut self) -> Result<(), String> {
        let pids: Vec<u32> = self.pids.drain().collect();
        for pid in pids {
            if let Err(e) = self.resume_one(pid) {
                eprintln!("[lockdown] failed to resume PID {}: {}", pid, e);
                // Continue resuming others -- best-effort cleanup
            }
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn suspend_one(&self, pid: u32) -> Result<(), String> {
        // nix::sys::signal::kill(Pid::from_raw(pid as i32), Signal::SIGSTOP)
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGSTOP)
            .map_err(|e| format!("SIGSTOP failed for {}: {}", pid, e))
    }

    #[cfg(target_os = "macos")]
    fn resume_one(&self, pid: u32) -> Result<(), String> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGCONT)
            .map_err(|e| format!("SIGCONT failed for {}: {}", pid, e))
    }

    #[cfg(target_os = "windows")]
    fn suspend_one(&self, pid: u32) -> Result<(), String> {
        // Use ntapi crate: NtSuspendProcess via handle from OpenProcess
        use ntapi::ntpsapi::NtSuspendProcess;
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::winnt::PROCESS_SUSPEND_RESUME;
        use winapi::um::handleapi::CloseHandle;
        unsafe {
            let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
            if handle.is_null() {
                return Err(format!("OpenProcess failed for {}", pid));
            }
            let status = NtSuspendProcess(handle);
            CloseHandle(handle);
            if status != 0 {
                return Err(format!("NtSuspendProcess failed: 0x{:x}", status));
            }
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn resume_one(&self, pid: u32) -> Result<(), String> {
        use ntapi::ntpsapi::NtResumeProcess;
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::winnt::PROCESS_SUSPEND_RESUME;
        use winapi::um::handleapi::CloseHandle;
        unsafe {
            let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
            if handle.is_null() {
                return Err(format!("OpenProcess failed for {}", pid));
            }
            let status = NtResumeProcess(handle);
            CloseHandle(handle);
            if status != 0 {
                return Err(format!("NtResumeProcess failed: 0x{:x}", status));
            }
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn suspend_one(&self, pid: u32) -> Result<(), String> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGSTOP)
            .map_err(|e| format!("SIGSTOP failed for {}: {}", pid, e))
    }

    #[cfg(target_os = "linux")]
    fn resume_one(&self, pid: u32) -> Result<(), String> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGCONT)
            .map_err(|e| format!("SIGCONT failed for {}: {}", pid, e))
    }
}
```

**Key design decision:** SIGSTOP on macOS/Linux does not require elevated privileges for processes owned by the same user. Most AI tools (Cursor, VS Code, ChatGPT desktop) run as the current user. This means we do NOT need sudo for process suspension in the common case.

On Windows, `NtSuspendProcess` requires `PROCESS_SUSPEND_RESUME` access, which works for same-user processes without elevation.

#### `lockdown/dns_sinkhole.rs` -- DNS Sinkhole

```rust
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Domains to sinkhole (resolve to 127.0.0.1)
const SINKHOLED_DOMAINS: &[&str] = &[
    "openai.com",
    "chatgpt.com",
    "claude.ai",
    "anthropic.com",
    "api.github.com",      // Copilot endpoint
    "copilot.github.com",
    "cursor.sh",
    "codeium.com",
    "tabnine.com",
    "sourcegraph.com",
    "api.together.xyz",
    "api.groq.com",
    "api.mistral.ai",
    "api.cohere.ai",
    "generativelanguage.googleapis.com",
];

pub struct DnsSinkhole {
    shutdown_tx: Option<oneshot::Sender<()>>,
    original_dns: Vec<String>,       // original system DNS servers
    original_interface: String,       // network interface name
}

impl DnsSinkhole {
    pub async fn start() -> Result<Self, String> { /* ... */ }
    pub async fn stop(&mut self) -> Result<(), String> { /* ... */ }
    async fn run_dns_server(shutdown_rx: oneshot::Receiver<()>) { /* ... */ }
    fn get_original_dns() -> Result<(String, Vec<String>), String> { /* ... */ }
    fn apply_system_dns(interface: &str, dns: &str) -> Result<(), String> { /* ... */ }
    fn restore_system_dns(interface: &str, servers: &[String]) -> Result<(), String> { /* ... */ }
    fn matches_sinkhole(domain: &str) -> bool { /* ... */ }
}
```

**DNS server approach:** Use `hickory-server` (the maintained successor to `trust-dns-server`). Bind to `127.0.0.1:53`. For each query:
1. Check if query domain matches any entry in `SINKHOLED_DOMAINS` (including subdomains via suffix matching)
2. If match: respond with A record pointing to `127.0.0.1`
3. If no match: forward to the original upstream DNS and relay the response

**System DNS redirection per platform:**

| Platform | Read current DNS | Set DNS to 127.0.0.1 | Restore |
|----------|-----------------|----------------------|---------|
| macOS | `networksetup -getdnsservers <service>` | `networksetup -setdnsservers <service> 127.0.0.1` | `networksetup -setdnsservers <service> <original...>` |
| Windows | `netsh interface ip show dnsservers` | `netsh interface ip set dnsservers "Ethernet" static 127.0.0.1` | Restore saved values via netsh |
| Linux | Read `/etc/resolv.conf` | Write `/etc/resolv.conf` with `nameserver 127.0.0.1` | Restore original file content |

**macOS network service detection:** Run `networksetup -listallnetworkservices` and filter for Wi-Fi or Ethernet. On modern macOS, the primary active service can be detected via `route get default | grep interface` then `networksetup -listnetworkserviceorder`.

#### `lockdown/privilege.rs` -- Privilege Escalation

```rust
/// Check if we can bind to port 53 (requires root/admin on most systems)
pub fn needs_elevation() -> bool {
    // Port 53 requires root on macOS/Linux
    // On Windows, binding to 53 does not require elevation
    cfg!(not(target_os = "windows"))
}

#[cfg(target_os = "macos")]
pub fn request_elevation(reason: &str) -> Result<(), String> {
    // Use osascript to prompt:
    // osascript -e 'do shell script "..." with administrator privileges'
    // This shows the native macOS auth dialog
}

#[cfg(target_os = "windows")]
pub fn request_elevation(_reason: &str) -> Result<(), String> {
    // DNS binding doesn't need elevation on Windows.
    // If needed for netsh, use runas or manifest-based UAC.
    Ok(())
}
```

**Critical design decision on privilege escalation:**

The DNS sinkhole requires binding to port 53, which needs root on macOS/Linux. There are two strategies:

**Option A (Recommended): Use a non-privileged port + loopback resolver**
- Bind the DNS server to `127.0.0.1:5553` (unprivileged)
- Use `dnsmasq` style: configure system to use `127.0.0.1` as DNS but redirect port 53 traffic to 5553
- On macOS: `networksetup -setdnsservers ... 127.0.0.1` + a `pfctl` rule to redirect port 53 to 5553
- This still requires a one-time privilege escalation for pfctl or networksetup

**Option B: Bind to port 53 with privilege escalation**
- Request admin/root access upfront
- Bind directly to `127.0.0.1:53`
- Simpler code, but requires elevation on every session start

**Recommendation: Option B.** The DNS sinkhole is a "during interview only" feature. Requesting elevation once per interview session is acceptable UX. The `networksetup` command on macOS already requires admin for `-setdnsservers`, so we need elevation regardless. On Windows, `netsh` requires admin too, so we need UAC there as well. No point trying to avoid elevation when we need it for the DNS redirect anyway.

#### `lockdown/mod.rs` -- Orchestrator

```rust
use std::sync::Mutex;
use crate::lockdown::suspend::SuspendedProcesses;
use crate::lockdown::dns_sinkhole::DnsSinkhole;

pub mod suspend;
pub mod dns_sinkhole;
pub mod privilege;

#[derive(Debug)]
pub enum LockdownPhase {
    Inactive,
    ProcessesSuspended,
    DnsActive,
    FullyLocked,     // both active
    CleaningUp,
}

pub struct LockdownState {
    pub phase: LockdownPhase,
    pub suspended: SuspendedProcesses,
    pub sinkhole: Option<DnsSinkhole>,
}

impl Default for LockdownState {
    fn default() -> Self {
        Self {
            phase: LockdownPhase::Inactive,
            suspended: SuspendedProcesses::default(),
            sinkhole: None,
        }
    }
}

impl Drop for LockdownState {
    fn drop(&mut self) {
        // Atomic cleanup: resume processes + restore DNS on panic/exit
        let _ = self.suspended.resume_all();
        if let Some(ref mut sinkhole) = self.sinkhole {
            // Note: we're in a Drop, so we can't await.
            // DNS restore is synchronous (command execution).
            // The async server shutdown is best-effort.
            let _ = sinkhole.stop_sync();
        }
    }
}
```

### 2.2 New Tauri Commands

Add to `lib.rs`:

```rust
use lockdown::LockdownState;

// Add to AppState:
pub struct AppState {
    pub session_id: Mutex<Option<String>>,
    pub heartbeat_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub ws_connected: Mutex<bool>,
    pub lockdown: Mutex<LockdownState>,  // NEW
}

/// Suspend AI processes + activate DNS sinkhole.
/// Returns verification results.
#[tauri::command]
async fn start_lockdown(
    state: State<'_, AppState>,
    ai_pids: Vec<u32>,
) -> Result<LockdownVerification, String> {
    // 1. Suspend processes
    // 2. Start DNS sinkhole
    // 3. Redirect system DNS
    // 4. Verify lockdown (ping sinkholed domains)
    // 5. Return verification results
}

/// Resume all suspended processes + restore DNS.
#[tauri::command]
async fn stop_lockdown(
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Restore system DNS
    // 2. Stop DNS server
    // 3. Resume all suspended processes
    // 4. Set phase to Inactive
}

/// Verify that the lockdown is working.
/// Performs DNS lookups on sinkholed domains and checks they resolve to 127.0.0.1.
#[tauri::command]
async fn verify_lockdown() -> Result<LockdownVerification, String> {
    // DNS resolve api.openai.com, claude.ai, etc.
    // Check each resolves to 127.0.0.1
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
```

Register in `invoke_handler`: `start_lockdown`, `stop_lockdown`, `verify_lockdown`.

### 2.3 New Cargo Dependencies

Add to `apps/agent/src-tauri/Cargo.toml`:

```toml
[dependencies]
# Process suspension (macOS/Linux)
nix = { version = "0.29", features = ["signal", "process"] }

# DNS server
hickory-server = "0.25"
hickory-resolver = "0.25"

# Windows process suspension (conditional)
[target.'cfg(target_os = "windows")'.dependencies]
ntapi = "0.4"
winapi = { version = "0.3", features = ["processthreadsapi", "winnt", "handleapi"] }
```

**Version rationale:**
- `nix 0.29`: Latest stable, provides `kill()` with SIGSTOP/SIGCONT. Minimal dep for what we need.
- `hickory-server 0.25`: Current stable release of the trust-dns successor. Includes `ServerFuture` for running a DNS server.
- `hickory-resolver 0.25`: For verification DNS lookups (resolve domain and check result).
- `ntapi 0.4` / `winapi 0.3`: Standard Windows API bindings for NtSuspendProcess/NtResumeProcess.

### 2.4 Preflight Flow Extension

The current preflight has 4 phases. Extend to 6:

| # | Name | Description | Status |
|---|------|-------------|--------|
| 1 | Connecting to server | Existing | **EXISTS** |
| 2 | Checking displays | Existing | **EXISTS** |
| 3 | Scanning processes | Existing (flag AI tools) | **EXISTS** |
| 4 | Verifying permissions | Existing | **EXISTS** |
| 5 | Applying network lock | NEW: start DNS sinkhole, redirect system DNS | **NEW** |
| 6 | Verifying lockdown | NEW: DNS resolve check on sinkholed domains | **NEW** |

The process scan (phase 3) UI changes:
- Current: "Quit" and "Force Quit" buttons per flagged process
- New: Add **"Suspend"** button (between Quit and Force Quit)
- Suspend calls `start_lockdown` with just the process PIDs (DNS comes in phase 5)
- If user chooses Suspend, the process row shows "Suspended" state instead of "Closed"

The "Minimize to Tray" button (currently shown after all checks pass) becomes **"Start Interview"** button. It only enables when:
1. All 6 checks pass, OR
2. All flagged processes are suspended AND network lock is verified

### 2.5 Lockdown State in Heartbeat

Add lockdown status to the heartbeat so the server knows the lockdown is active:

```rust
// In build_heartbeat():
serde_json::json!({
    "sessionId": session_id,
    "timestamp": timestamp,
    "screens": screens,
    "processes": processes,
    "suspiciousWindows": windows,
    "networkFlags": network_flags,
    "clipboardEvents": clipboard_events,
    "trustScore": 100,
    "lockdownActive": true,            // NEW
    "suspendedPids": [1234, 5678],     // NEW
})
```

### 2.6 Cleanup Guarantees

The agent must clean up lockdown state in ALL exit paths:

1. **Normal exit:** `stop_lockdown` called by "End Interview" or `session_end` WS message
2. **Window close:** Tauri `on_window_event` CloseRequested handler calls `stop_lockdown`
3. **Crash / panic:** `Drop` trait on `LockdownState` restores DNS and resumes processes
4. **System shutdown:** OS sends SIGTERM to Tauri process -> Tauri cleanup -> Drop runs
5. **Kill -9:** Cannot handle. This is documented as a known risk. Mitigation: on next agent launch, check if DNS is still redirected to 127.0.0.1 and fix it.

Add a "stale lockdown recovery" check at app startup:

```rust
// In tauri::Builder::setup():
// Check if system DNS is pointing to 127.0.0.1 (stale from crash)
if lockdown::dns_sinkhole::is_dns_redirected() {
    lockdown::dns_sinkhole::restore_dns_from_backup()?;
}
```

The backup of original DNS settings should be persisted to a file (`~/.trueself/dns_backup.json`) so it survives crashes.

---

## 3. Feature 2: Session Overlay + Interview In-Progress Flow

### 3.1 Agent-Side: Interview In-Progress

**New agent UI screen (Screen 4: "Interview Active"):**

Replace the current minimal "Screen 3: Ready" with a richer in-progress view:

```
+----------------------------------+
|  TrueSelf                        |
|                                  |
|  [green dot] Interview Active    |
|                                  |
|  Session Timer:  00:42:15        |
|  Connection:     Connected       |
|  Lockdown:       Active          |
|                                  |
|  [Minimize to Tray]              |
|  [End Interview]                 |
+----------------------------------+
```

**System tray updates during interview:**
- Tray tooltip: "TrueSelf -- Interview Active (00:42:15)"
- Tray menu items update:
  - "Status: Interview Active" (disabled, informational)
  - "Show Window" (brings up the in-progress screen)
  - "End Interview" (prompts confirmation, calls stop_lockdown + stop_monitoring)
  - "Quit TrueSelf" (warns that interview is active, requires confirmation)

**Session timer:** Pure frontend timer. The agent tracks `interviewStartedAt` timestamp (set when "Start Interview" is clicked). The TS frontend computes elapsed time on an interval. The timestamp is also stored in `AppState` so heartbeats can include `interviewDurationMs`.

**"Start Interview" flow (what happens when candidate clicks the button):**

1. Frontend calls `invoke("start_monitoring", { sessionId })` (existing)
2. Frontend calls `invoke("start_lockdown", { aiPids })` if not already locked (idempotent)
3. Agent sends a special `{ type: "session_start_confirmed" }` message over WS
4. Server receives this, sets session status to ACTIVE, records `startedAt`
5. Server broadcasts `{ type: "session_started", timestamp }` to dashboard viewers
6. Agent transitions to Screen 4 (Interview Active)
7. Agent minimizes to tray

### 3.2 Server-Side: Trust Score Computation

The server currently does NOT compute trust scores -- it forwards raw heartbeats. This must change.

**New module: `apps/server/src/ws/trust-engine.ts`**

```typescript
interface TrustScoreResult {
  overallScore: number;  // 0-100
  breakdown: {
    screenCount:  { score: number; weight: number; details: string };
    aiTools:      { score: number; weight: number; details: string };
    overlays:     { score: number; weight: number; details: string };
    network:      { score: number; weight: number; details: string };
    clipboard:    { score: number; weight: number; details: string };
    connectivity: { score: number; weight: number; details: string };
  };
  events: TrustEvent[];  // new events generated this tick
}

function computeTrustScore(
  heartbeat: AgentHeartbeat,
  sessionState: SessionRuntimeState
): TrustScoreResult;
```

**SessionRuntimeState** -- in-memory per-session state on the server:

```typescript
interface SessionRuntimeState {
  sessionId: string;
  startedAt: number;
  lastHeartbeatAt: number;
  currentScore: number;
  scoreHistory: Array<{ timestamp: number; score: number }>;
  disconnectCount: number;
  lastDisconnectAt: number | null;
  flaggedProcessHistory: Set<string>;  // process names seen as flagged
  lockdownActive: boolean;
  events: TrustEvent[];
}
```

### 3.3 Server-Side: Heartbeat Gap Detection

In the WebSocket handler, track timing per agent connection:

```typescript
// Per-session interval that fires every 5s
const heartbeatWatchdog = setInterval(() => {
  const state = sessionStates.get(sessionId);
  if (!state) return;

  const gap = Date.now() - state.lastHeartbeatAt;

  if (gap > 10_000 && !state.disconnectWarningActive) {
    // Agent missed heartbeats -- emit warning
    state.disconnectWarningActive = true;
    state.lastDisconnectAt = Date.now();
    state.disconnectCount++;

    const event: TrustEvent = {
      timestamp: Date.now(),
      type: "agent_disconnected",
      severity: "warning",
      message: "Agent heartbeat not received for 10+ seconds",
    };
    broadcastToDashboards(sessionId, { type: "alert", data: event });
    persistEvent(sessionId, event);
  }
}, 5_000);
```

**Reconnect logic:**
- When a heartbeat arrives after a gap, compute gap duration
- Gap < 30s: clear the "disconnected" warning, partial score recovery (+5 points back)
- Gap >= 30s: warning persists in timeline, score does not recover, flagged in final report

### 3.4 Server-Side: Alert Forwarding

When the trust engine detects a new event (from heartbeat analysis), the server must:

1. Create the `TrustEvent` in the DB
2. Send it to all dashboard WebSocket connections for this session
3. Include a `severity` field so the dashboard knows how to render it

Alert message to dashboard:

```json
{
  "type": "trust_update",
  "data": {
    "overallScore": 72,
    "breakdown": { ... },
    "newEvents": [
      {
        "timestamp": 1713012345678,
        "type": "ai_tool_detected",
        "severity": "critical",
        "message": "ChatGPT process detected (pid 4521)"
      }
    ]
  }
}
```

---

## 4. Shared Type Additions

Add to `packages/shared-types/src/index.ts`:

```typescript
// ---- Lockdown Types ----

export interface LockdownStatus {
  active: boolean;
  phase: "inactive" | "processes_suspended" | "dns_active" | "fully_locked" | "cleaning_up";
  suspendedPids: number[];
  dnsRedirected: boolean;
}

export interface DomainCheck {
  domain: string;
  resolvedTo: string;
  blocked: boolean;
}

export interface LockdownVerification {
  dnsActive: boolean;
  processesSuspended: boolean;
  verifiedDomains: DomainCheck[];
}

// ---- Extended Heartbeat ----

// Update AgentHeartbeat to add:
export interface AgentHeartbeat {
  sessionId: string;
  timestamp: number;
  screens: ScreenInfo[];
  processes: ProcessInfo[];
  suspiciousWindows: WindowInfo[];
  networkFlags: NetworkFlag[];
  clipboardEvents: ClipboardEvent[];
  trustScore: number;
  lockdownActive: boolean;           // NEW
  suspendedPids: number[];           // NEW
  interviewDurationMs: number;       // NEW
}

// ---- Trust Score (server-computed, sent to dashboard) ----

export interface TrustScoreUpdate {
  overallScore: number;
  breakdown: TrustBreakdown;
  newEvents: TrustEvent[];
}

export interface TrustBreakdown {
  screenCount:  TrustSignal;
  aiTools:      TrustSignal;
  overlays:     TrustSignal;
  network:      TrustSignal;
  clipboard:    TrustSignal;
  connectivity: TrustSignal;
}

export interface TrustSignal {
  score: number;       // 0-100 for this signal
  weight: number;      // 0.0-1.0
  details: string;
}

// ---- Extended WebSocket Messages ----

export type WSMessageFromAgent =
  | { type: "heartbeat"; data: AgentHeartbeat }
  | { type: "alert"; data: TrustEvent }
  | { type: "preflight_result"; data: PreflightResult }
  | { type: "session_start_confirmed" }               // NEW
  | { type: "lockdown_status"; data: LockdownStatus } // NEW

export type WSMessageToAgent =
  | { type: "session_start"; sessionId: string }
  | { type: "session_end" }
  | { type: "config_update"; config: AgentConfig }

export type WSMessageToDashboard =
  | { type: "heartbeat"; data: AgentHeartbeat }       // forwarded
  | { type: "trust_update"; data: TrustScoreUpdate }  // NEW: server-computed
  | { type: "alert"; data: TrustEvent }
  | { type: "agent_status"; connected: boolean }
  | { type: "session_started"; timestamp: number }    // NEW
  | { type: "lockdown_status"; data: LockdownStatus } // NEW

// ---- Alert Severity Levels (for dashboard rendering) ----

export type AlertSeverity = "info" | "warning" | "critical";

export interface DashboardAlert {
  id: string;
  event: TrustEvent;
  dismissed: boolean;
  playSound: boolean;  // critical events trigger audio
}
```

---

## 5. Database Schema Changes

### New Model: `Heartbeat`

Currently heartbeats are forwarded but not persisted. For the reconnect/gap detection feature, we need to at minimum track heartbeat timing. Full heartbeat storage is optional (expensive).

```prisma
model HeartbeatLog {
  id        String   @id @default(cuid())
  sessionId String
  session   InterviewSession @relation(fields: [sessionId], references: [id])
  timestamp DateTime
  score     Int              // trust score at this point
  data      Json?            // optional: full heartbeat payload (for replay)

  @@index([sessionId, timestamp])
}
```

### Update `InterviewSession`

Add fields to track lockdown state:

```prisma
model InterviewSession {
  // ... existing fields ...
  lockdownActive  Boolean   @default(false)
  heartbeatLogs   HeartbeatLog[]
}
```

### Migration Strategy

This is purely additive (new model + new optional column). No breaking changes. Run:

```bash
pnpm db:migrate --name add-heartbeat-log-and-lockdown
```

---

## 6. WebSocket Protocol Changes

### Current Protocol

```
Agent connects:  ws://localhost:3001?sessionId=xxx&role=agent
Dashboard connects: ws://localhost:3001?sessionId=xxx&role=dashboard

Agent -> Server: { type: "heartbeat", data: AgentHeartbeat }
Agent -> Server: { type: "alert", data: TrustEvent }
Server -> Agent: { type: "session_end" }
Server -> Dashboard: (raw forward of agent messages)
Server -> Dashboard: { type: "agent_status", connected: boolean }
```

### Updated Protocol

```
Agent -> Server:
  { type: "heartbeat", data: AgentHeartbeat }          // existing (extended payload)
  { type: "alert", data: TrustEvent }                  // existing
  { type: "session_start_confirmed" }                  // NEW
  { type: "lockdown_status", data: LockdownStatus }    // NEW

Server -> Agent:
  { type: "session_end" }                              // existing
  { type: "session_start", sessionId: string }         // existing (unused today)
  { type: "config_update", config: AgentConfig }       // existing (unused today)

Server -> Dashboard:
  { type: "trust_update", data: TrustScoreUpdate }     // NEW (replaces raw forward)
  { type: "alert", data: TrustEvent }                  // existing
  { type: "agent_status", connected: boolean }         // existing
  { type: "session_started", timestamp: number }       // NEW
  { type: "lockdown_status", data: LockdownStatus }    // NEW (forwarded)
```

**Breaking change:** The server will NO LONGER forward raw heartbeat messages to the dashboard. Instead, it processes heartbeats through the trust engine and sends `trust_update` messages. This is intentional -- the dashboard should not receive raw process lists (privacy: interviewer doesn't need to see every process name, just the trust score and flagged items).

---

## 7. Server-Side Changes

### 7.1 New Files

```
apps/server/src/ws/trust-engine.ts    -- trust score computation
apps/server/src/ws/session-state.ts   -- in-memory session runtime state
apps/server/src/ws/watchdog.ts        -- heartbeat gap detector
```

### 7.2 Changes to `apps/server/src/index.ts`

The WebSocket `on("message")` handler needs significant changes:

```typescript
// Current: raw forward to dashboards
// New: process through trust engine, then send computed result

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  if (role === "agent") {
    if (msg.type === "heartbeat") {
      const state = getOrCreateSessionState(sessionId);
      state.lastHeartbeatAt = Date.now();

      // Clear disconnect warning if it was active
      if (state.disconnectWarningActive) {
        const gap = Date.now() - (state.lastDisconnectAt ?? 0);
        handleReconnect(sessionId, gap, state);
      }

      // Compute trust score
      const result = computeTrustScore(msg.data, state);
      state.currentScore = result.overallScore;

      // Send computed result to dashboards
      broadcastToDashboards(sessionId, {
        type: "trust_update",
        data: result,
      });

      // Persist critical events
      for (const event of result.events) {
        if (event.severity === "critical" || event.severity === "warning") {
          await prisma.trustEvent.create({ ... });
        }
      }

      // Optionally persist heartbeat log (every Nth heartbeat to save space)
      if (shouldPersistHeartbeat(state)) {
        await prisma.heartbeatLog.create({ ... });
      }
    }

    if (msg.type === "session_start_confirmed") {
      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: { status: "ACTIVE", startedAt: new Date() },
      });
      broadcastToDashboards(sessionId, {
        type: "session_started",
        timestamp: Date.now(),
      });
    }

    if (msg.type === "lockdown_status") {
      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: { lockdownActive: msg.data.active },
      });
      broadcastToDashboards(sessionId, msg);
    }
  }
});
```

### 7.3 Trust Engine Scoring Algorithm

```typescript
// apps/server/src/ws/trust-engine.ts

const WEIGHTS = {
  screenCount:  0.10,
  aiTools:      0.35,
  overlays:     0.20,
  network:      0.15,
  clipboard:    0.10,
  connectivity: 0.10,
};

function computeTrustScore(
  hb: AgentHeartbeat,
  state: SessionRuntimeState
): TrustScoreResult {
  const events: TrustEvent[] = [];

  // Screen count signal
  const screenScore = hb.screens.length === 1 ? 100 :
    hb.screens.length === 2 ? 60 : 30;
  if (hb.screens.length > 1 && !state.multiMonitorFlagged) {
    state.multiMonitorFlagged = true;
    events.push({
      timestamp: Date.now(),
      type: "screen_change",
      severity: hb.screens.length > 2 ? "critical" : "warning",
      message: `${hb.screens.length} monitors detected`,
    });
  }

  // AI tools signal
  const flaggedProcesses = hb.processes.filter(p => p.isFlagged);
  let aiScore = flaggedProcesses.length === 0 ? 100 : 0;
  if (hb.lockdownActive && flaggedProcesses.length === 0) {
    aiScore = 100; // lockdown active, no unsuspended AI tools visible
  }
  for (const proc of flaggedProcesses) {
    if (!state.flaggedProcessHistory.has(proc.name)) {
      state.flaggedProcessHistory.add(proc.name);
      events.push({
        timestamp: Date.now(),
        type: "ai_tool_detected",
        severity: "critical",
        message: `AI tool detected: ${proc.name} (pid ${proc.pid})`,
      });
    }
  }

  // Overlay signal
  const suspiciousWindows = hb.suspiciousWindows.filter(
    w => w.isTransparent || (w.isTopmost && w.opacity < 1.0)
  );
  const overlayScore = suspiciousWindows.length === 0 ? 100 : 20;
  for (const win of suspiciousWindows) {
    events.push({
      timestamp: Date.now(),
      type: "overlay_detected",
      severity: "critical",
      message: `Suspicious overlay: "${win.title}" (${win.processName})`,
    });
  }

  // Network signal
  const networkScore = hb.networkFlags.length === 0 ? 100 : 10;
  for (const flag of hb.networkFlags) {
    events.push({
      timestamp: Date.now(),
      type: "network_flag",
      severity: "critical",
      message: `Connection to ${flag.destination}:${flag.port}`,
    });
  }

  // Clipboard signal
  const largePastes = hb.clipboardEvents.filter(e => e.contentLength > 500);
  const clipboardScore = largePastes.length === 0 ? 100 : 50;
  for (const paste of largePastes) {
    events.push({
      timestamp: Date.now(),
      type: "clipboard_flag",
      severity: "warning",
      message: `Large paste (${paste.contentLength} chars) from ${paste.source}`,
    });
  }

  // Connectivity signal (based on session state, not current heartbeat)
  const connectivityScore = state.disconnectCount === 0 ? 100 :
    state.disconnectCount <= 2 ? 70 : 40;

  // Weighted overall
  const overall = Math.round(
    screenScore * WEIGHTS.screenCount +
    aiScore * WEIGHTS.aiTools +
    overlayScore * WEIGHTS.overlays +
    networkScore * WEIGHTS.network +
    clipboardScore * WEIGHTS.clipboard +
    connectivityScore * WEIGHTS.connectivity
  );

  return {
    overallScore: overall,
    breakdown: {
      screenCount:  { score: screenScore, weight: WEIGHTS.screenCount, details: `${hb.screens.length} monitor(s)` },
      aiTools:      { score: aiScore, weight: WEIGHTS.aiTools, details: flaggedProcesses.length === 0 ? "No AI tools" : `${flaggedProcesses.length} flagged` },
      overlays:     { score: overlayScore, weight: WEIGHTS.overlays, details: suspiciousWindows.length === 0 ? "No overlays" : `${suspiciousWindows.length} suspicious` },
      network:      { score: networkScore, weight: WEIGHTS.network, details: hb.networkFlags.length === 0 ? "Clean" : `${hb.networkFlags.length} flags` },
      clipboard:    { score: clipboardScore, weight: WEIGHTS.clipboard, details: largePastes.length === 0 ? "Normal" : `${largePastes.length} large pastes` },
      connectivity: { score: connectivityScore, weight: WEIGHTS.connectivity, details: `${state.disconnectCount} disconnects` },
    },
    events,
  };
}
```

---

## 8. Agent Frontend Changes

### 8.1 HTML Changes (`index.html`)

Add new preflight check items and a new Screen 4:

```html
<!-- In Screen 2 (Preflight), the checklist is built dynamically in JS.
     Update CHECK_NAMES to include new phases. -->

<!-- New Screen 4: Interview Active (replaces minimal Screen 3) -->
<div id="screen-active" class="screen hidden">
  <div class="active-header">
    <div class="active-indicator">
      <div id="active-dot" class="dot dot-green"></div>
      <span id="active-status">Interview Active</span>
    </div>
  </div>

  <div class="active-stats">
    <div class="stat-row">
      <span class="stat-label">Duration</span>
      <span id="session-timer" class="stat-value">00:00:00</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Connection</span>
      <span id="connection-status" class="stat-value">Connected</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Lockdown</span>
      <span id="lockdown-status" class="stat-value">Active</span>
    </div>
  </div>

  <div class="active-actions">
    <button id="active-minimize-btn" class="btn-primary">Minimize to Tray</button>
    <button id="end-interview-btn" class="btn-ghost btn-danger">End Interview</button>
  </div>
</div>
```

### 8.2 TypeScript Changes (`main.ts`)

**Extended CHECK_NAMES:**

```typescript
const CHECK_NAMES = [
  "Connecting to server",
  "Checking displays",
  "Scanning processes",
  "Verifying permissions",
  "Applying network lock",     // NEW
  "Verifying lockdown",        // NEW
];
```

**New functions:**

```typescript
// Process suspension in preflight
async function suspendProcess(pid: number, row: HTMLElement, btn: HTMLButtonElement) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" ...></span>`;
  try {
    await invoke("start_lockdown", { aiPids: [pid] });
    row.classList.add("suspended");
    row.querySelector(".process-actions")!.innerHTML =
      '<span class="suspended-badge">Suspended</span>';
  } catch (err) {
    btn.textContent = "Suspend";
    btn.disabled = false;
  }
}

// Network lock phase
async function applyNetworkLock(): Promise<boolean> {
  setCheckState("Applying network lock", "pending");
  try {
    await invoke("start_lockdown", { aiPids: [] }); // DNS only, processes already handled
    setCheckState("Applying network lock", "pass", "DNS sinkhole active");
    return true;
  } catch (err) {
    setCheckState("Applying network lock", "fail", String(err));
    return false;
  }
}

// Verification phase
async function verifyLockdown(): Promise<boolean> {
  setCheckState("Verifying lockdown", "pending");
  try {
    const result = await invoke<LockdownVerification>("verify_lockdown");
    const allBlocked = result.verifiedDomains.every(d => d.blocked);
    setCheckState(
      "Verifying lockdown",
      allBlocked ? "pass" : "fail",
      allBlocked
        ? `${result.verifiedDomains.length} domains blocked`
        : "Some domains not blocked"
    );
    return allBlocked;
  } catch (err) {
    setCheckState("Verifying lockdown", "fail", String(err));
    return false;
  }
}

// Session timer
let timerInterval: number | null = null;
let interviewStartedAt: number | null = null;

function startSessionTimer() {
  interviewStartedAt = Date.now();
  timerInterval = window.setInterval(() => {
    if (!interviewStartedAt) return;
    const elapsed = Date.now() - interviewStartedAt;
    const h = Math.floor(elapsed / 3600000);
    const m = Math.floor((elapsed % 3600000) / 60000);
    const s = Math.floor((elapsed % 60000) / 1000);
    const el = document.getElementById("session-timer");
    if (el) el.textContent =
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, 1000);
}

// End interview
async function endInterview() {
  if (!confirm("End this interview session? AI tools will be resumed and network restrictions removed.")) return;
  try {
    await invoke("stop_lockdown");
    await invoke("stop_monitoring");
  } catch (err) {
    console.error("Cleanup error:", err);
  }
  if (timerInterval) clearInterval(timerInterval);
  currentSession = null;
  showScreen("screen-welcome");
}
```

**Updated `startMonitoring` flow:**

```typescript
async function startMonitoring() {
  if (!currentSession) return;
  try {
    await invoke("start_monitoring", { sessionId: currentSession.id });
    startSessionTimer();
    showScreen("screen-active"); // Screen 4, not Screen 3
    await minimizeToTray();
  } catch (err) {
    console.error("start_monitoring error:", err);
  }
}
```

### 8.3 Process List UI Update

In `renderProcessList`, add a Suspend button to each row:

```typescript
row.innerHTML = `
  <span class="process-dot"></span>
  <span class="process-name">${escapeHtml(proc.name)}...</span>
  <span class="process-pid">pid ${proc.pid}</span>
  <div class="process-actions">
    <button class="btn-suspend">Suspend</button>        <!-- NEW -->
    <button class="btn-quit">Quit</button>
    <button class="btn-force-quit">Force Quit</button>
  </div>
`;

const suspendBtn = row.querySelector<HTMLButtonElement>(".btn-suspend")!;
suspendBtn.addEventListener("click", () =>
  suspendProcess(killTargetPid, row, suspendBtn));
```

---

## 9. Dashboard Frontend Changes

### 9.1 New Page: Live Session Monitor

**Route:** `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/page.tsx`

This is the page interviewers open during an active interview. It shows real-time trust score and events.

**Component hierarchy:**

```
LiveSessionPage (server component - fetches initial session data)
  LiveSessionClient (client component - WebSocket connection)
    TrustScorePanel
      ScoreGauge (circular gauge, 0-100)
      BreakdownGrid (6 signal cards)
    EventTimeline
      EventRow (per event, color-coded by severity)
    AlertBanner (critical alerts, dismissable)
    SessionHeader (candidate name, timer, status)
    ConnectionIndicator (agent connected/disconnected)
```

### 9.2 WebSocket Connection from Dashboard

```typescript
// apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/use-session-ws.ts

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { TrustScoreUpdate, TrustEvent, LockdownStatus } from "@trueself/shared-types";

interface SessionWSState {
  connected: boolean;
  agentConnected: boolean;
  trustScore: TrustScoreUpdate | null;
  events: TrustEvent[];
  lockdown: LockdownStatus | null;
  sessionStarted: boolean;
}

export function useSessionWS(sessionId: string): SessionWSState {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<SessionWSState>({ ... });

  useEffect(() => {
    const ws = new WebSocket(
      `ws://localhost:3001?sessionId=${sessionId}&role=dashboard`
    );
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "trust_update":
          setState(prev => ({
            ...prev,
            trustScore: msg.data,
            events: [...prev.events, ...msg.data.newEvents],
          }));
          // Play sound for critical events
          if (msg.data.newEvents.some((e: TrustEvent) => e.severity === "critical")) {
            playAlertSound();
          }
          break;
        case "agent_status":
          setState(prev => ({ ...prev, agentConnected: msg.connected }));
          break;
        case "session_started":
          setState(prev => ({ ...prev, sessionStarted: true }));
          break;
        case "lockdown_status":
          setState(prev => ({ ...prev, lockdown: msg.data }));
          break;
      }
    };

    return () => ws.close();
  }, [sessionId]);

  return state;
}
```

### 9.3 Alert System

**Critical alerts** (red banner + sound):
- AI tool detected during interview
- Suspicious overlay window detected
- Network connection to AI API domain

**Warning alerts** (yellow banner, no sound):
- Multiple monitors connected
- Agent disconnected (no heartbeat for 10s)

**Info events** (timeline entry only):
- Large clipboard paste
- Agent reconnected

**Sound:** Use the Web Audio API to play a short alert tone. Embed a small audio file or synthesize a tone. The dashboard should request audio permission on page load (modern browsers require user interaction first -- the interviewer clicking "Monitor Session" counts).

### 9.4 Session Detail Page Updates

The existing sessions list page (`/dashboard/sessions/page.tsx`) needs a "Monitor Live" button for active sessions that links to `/dashboard/sessions/[id]/live`.

---

## 10. Trust Score Integration

### Signal Weights

| Signal | Weight | Rationale |
|--------|--------|-----------|
| AI Tools | 0.35 | Primary detection target. An active AI tool is the strongest indicator of cheating. |
| Overlays | 0.20 | Transparent/topmost windows are a common overlay-based cheat vector. |
| Network | 0.15 | Connections to AI APIs indicate active use even if process is renamed. |
| Screen Count | 0.10 | Multiple monitors can hide AI tools on secondary display. Not definitive alone. |
| Clipboard | 0.10 | Large pastes may indicate copying from an AI tool, but also legitimate (pasting a URL). |
| Connectivity | 0.10 | Frequent disconnects may indicate the candidate is manipulating the agent. |

### Scoring Thresholds

| Overall Score | Trust Level | Dashboard Color | Action |
|--------------|-------------|-----------------|--------|
| 90-100 | High | Green | No action needed |
| 70-89 | Medium | Yellow | Review timeline for context |
| 40-69 | Low | Orange | Strong indicators of AI assistance |
| 0-39 | Critical | Red | Near-certain AI tool usage detected |

### Lockdown Bonus

When the lockdown is active and verified:
- AI Tools signal gets a +10 boost (suspended processes are neutralized)
- Network signal gets a +10 boost (DNS sinkhole blocks API access)
- This rewards candidates who cooperated with the lockdown process

---

## 11. Implementation Roadmap

### Phase 1: Foundation (S-M complexity)

| Task | File(s) | Size | Notes |
|------|---------|------|-------|
| Add shared types for lockdown, trust update, WS messages | `packages/shared-types/src/index.ts` | S | Non-breaking additions |
| Add HeartbeatLog model + lockdownActive to schema | `packages/db/prisma/schema.prisma` | S | Additive migration |
| Run migration | `packages/db/` | S | `pnpm db:migrate` |

### Phase 2: Agent -- Process Suspension (M complexity)

| Task | File(s) | Size | Notes |
|------|---------|------|-------|
| Create `lockdown/` module structure | `apps/agent/src-tauri/src/lockdown/mod.rs` | S | Module skeleton |
| Implement `suspend.rs` (macOS first) | `apps/agent/src-tauri/src/lockdown/suspend.rs` | M | SIGSTOP/SIGCONT via nix |
| Add `nix` dep to Cargo.toml | `apps/agent/src-tauri/Cargo.toml` | S | |
| Add `start_lockdown` / `stop_lockdown` Tauri commands | `apps/agent/src-tauri/src/lib.rs` | M | Wire to AppState |
| Add LockdownState to AppState + Drop cleanup | `apps/agent/src-tauri/src/lib.rs` | M | Crash safety |
| Add "Suspend" button to preflight UI | `apps/agent/src/main.ts` | S | |

### Phase 3: Agent -- DNS Sinkhole (L complexity)

| Task | File(s) | Size | Notes |
|------|---------|------|-------|
| Add `hickory-server` / `hickory-resolver` deps | `Cargo.toml` | S | |
| Implement `dns_sinkhole.rs` (DNS server) | `lockdown/dns_sinkhole.rs` | L | Core DNS logic |
| Implement `privilege.rs` (macOS osascript) | `lockdown/privilege.rs` | M | Platform-specific |
| Implement system DNS redirect (macOS networksetup) | `lockdown/dns_sinkhole.rs` | M | Requires admin |
| DNS backup file persistence | `lockdown/dns_sinkhole.rs` | S | `~/.trueself/dns_backup.json` |
| Stale lockdown recovery on startup | `lib.rs` | S | Check + restore |
| Add `verify_lockdown` command | `lib.rs` | S | DNS lookup verification |
| Add preflight phases 5+6 (network lock + verify) | `apps/agent/src/main.ts` | M | |

### Phase 4: Server -- Trust Engine (M-L complexity)

| Task | File(s) | Size | Notes |
|------|---------|------|-------|
| Create `trust-engine.ts` | `apps/server/src/ws/trust-engine.ts` | L | Scoring algorithm |
| Create `session-state.ts` | `apps/server/src/ws/session-state.ts` | M | In-memory state per session |
| Create `watchdog.ts` | `apps/server/src/ws/watchdog.ts` | M | Heartbeat gap detection |
| Refactor WS handler in `index.ts` | `apps/server/src/index.ts` | L | Replace raw forwarding with trust engine |
| Handle `session_start_confirmed` message | `apps/server/src/index.ts` | S | Update DB status |
| Persist HeartbeatLog (every 10th beat) | `apps/server/src/index.ts` | S | |

### Phase 5: Agent -- Interview Active UI (M complexity)

| Task | File(s) | Size | Notes |
|------|---------|------|-------|
| Add Screen 4 HTML | `apps/agent/index.html` | S | |
| Add Screen 4 CSS | `apps/agent/src/styles.css` | S | |
| Session timer logic | `apps/agent/src/main.ts` | S | |
| End Interview flow | `apps/agent/src/main.ts` | M | Confirm, cleanup, reset |
| Update tray menu during interview | `apps/agent/src-tauri/src/lib.rs` | M | Dynamic menu items |
| Send `session_start_confirmed` over WS | `apps/agent/src-tauri/src/lib.rs` | S | |

### Phase 6: Dashboard -- Live Monitor (L complexity)

| Task | File(s) | Size | Notes |
|------|---------|------|-------|
| Create `useSessionWS` hook | `apps/web/src/app/.../live/use-session-ws.ts` | M | WebSocket client |
| Create LiveSessionPage | `apps/web/src/app/.../live/page.tsx` | M | Server component shell |
| Create TrustScorePanel | components | M | Gauge + breakdown grid |
| Create EventTimeline | components | M | Scrollable event log |
| Create AlertBanner | components | S | Dismissable banners |
| Alert sound system | `apps/web/src/lib/alert-sound.ts` | S | Web Audio API |
| "Monitor Live" button on session list | `sessions/page.tsx` | S | Link to live page |

### Phase 7: Integration & Testing (M complexity)

| Task | Size | Notes |
|------|------|-------|
| End-to-end: agent lockdown -> server score -> dashboard display | M | Manual integration test |
| Test stale lockdown recovery | S | Kill agent, verify DNS restores on restart |
| Test heartbeat gap detection + reconnect | M | Disconnect agent, verify alerts |
| Test lockdown on Windows | L | ntapi + netsh (if targeting Windows) |
| Cross-platform DNS sinkhole testing | M | Verify on macOS, test on Linux |

### Phase 8: Polish & Edge Cases (S-M complexity)

| Task | Size | Notes |
|------|------|-------|
| Handle DNS sinkhole port conflict (another DNS on :53) | S | Detect + error message |
| Handle process already exited when resuming | S | Ignore ESRCH errors |
| Rate-limit trust events (no duplicate critical events within 10s) | S | Debounce in trust engine |
| Lockdown status badge in session list | S | Show lockdown icon |

---

## 12. Risks and Trade-offs

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **DNS not restored after crash (kill -9)** | Candidate's internet breaks for AI-related sites permanently | Stale lockdown recovery on next launch + persist DNS backup to file. Document that candidate should reboot or run the agent to fix. |
| **Port 53 conflict** | Another DNS service (systemd-resolved on Linux, mDNSResponder on macOS) may hold port 53 | Detect conflict before binding. On Linux, may need to disable systemd-resolved stub. On macOS, mDNSResponder uses port 5353 (not 53), so no conflict. |
| **Privilege escalation UX** | Asking for admin/root access may alarm candidates | Clear explanation in the preflight UI: "TrueSelf needs administrator access to verify your network configuration. This is temporary and will be removed when the interview ends." |
| **False positive process detection** | Legitimate processes matching AI tool names get suspended | The existing `FLAGGED_PROCESSES` list is hand-curated. Suspension is reversible (unlike kill), reducing the impact of false positives. |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **DNS cache bypasses sinkhole** | Browser/OS cached DNS entries for AI domains may persist | Flush DNS cache as part of lockdown: `dscacheutil -flushcache` (macOS), `ipconfig /flushdns` (Windows) |
| **VPN/proxy bypasses DNS sinkhole** | Candidate using VPN with its own DNS won't be affected | Detect VPN processes in process scan. Flag in trust score as a warning. The network monitor should also detect direct IP connections. |
| **hickory-server adds significant binary size** | Tauri bundle size increases | Acceptable for the security benefit. Monitor binary size; hickory-server adds ~2-3MB. |
| **Browser connection pooling** | Existing HTTP/2 connections to AI APIs may persist after DNS redirect | Most connections have idle timeouts. The sinkhole is defense-in-depth alongside process suspension. |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Timer drift** | Session timer on agent frontend may drift from server time | Timer is informational only. Server tracks `startedAt`/`endedAt` authoritatively. |
| **WebSocket message ordering** | Trust updates may arrive out of order on dashboard | Each message has a timestamp. Dashboard should use latest timestamp, not arrival order. |

### Open Questions (Decisions Needed Before Implementation)

1. **macOS DNS: Wi-Fi vs Ethernet vs both?** When multiple network services exist, should we redirect DNS on all of them or just the active one? **Recommendation:** Redirect on all active services. Iterate `networksetup -listallnetworkservices` and set DNS on each that has an IP address.

2. **Should the interviewer be able to trigger lockdown remotely?** The current design has the candidate initiate lockdown via preflight. An alternative is server-sent `{ type: "start_lockdown" }` triggered by the interviewer. **Recommendation:** Candidate-initiated for v1. Interviewer-triggered is a v2 feature (adds complexity around consent and agent command handling).

3. **Heartbeat persistence granularity:** Should we store every heartbeat or sample? Every 3s = 1200 rows per hour per session. **Recommendation:** Store every 10th heartbeat (every 30s) for timeline replay. Store all critical events immediately.

4. **Should the DNS sinkhole block ALL traffic or just DNS lookups?** Current design only sinkholed DNS (resolves AI domains to 127.0.0.1). A more aggressive approach would also drop packets to known AI IP ranges using firewall rules. **Recommendation:** DNS-only for v1. IP-level blocking is harder to maintain (IP ranges change) and requires deeper OS integration.

5. **Windows support timeline:** The suspension uses `ntapi` (Windows-only crate). DNS uses `netsh`. Should both platforms ship simultaneously? **Recommendation:** macOS first (primary target for developer interviews). Windows support can follow as Phase 3b. The module structure supports this via `cfg(target_os)` blocks.

6. **What happens if the candidate refuses the lockdown?** Should the interview proceed without lockdown (lower trust score) or block entirely? **Recommendation:** Allow proceeding without lockdown, but apply a -15 penalty to the base trust score and flag it for the interviewer. The interviewer can decide whether to continue.

---

## Appendix A: File Change Summary

### New Files

| File | Purpose |
|------|---------|
| `apps/agent/src-tauri/src/lockdown/mod.rs` | Lockdown orchestrator, LockdownState, Drop cleanup |
| `apps/agent/src-tauri/src/lockdown/suspend.rs` | SIGSTOP/SIGCONT and NtSuspend/ResumeProcess |
| `apps/agent/src-tauri/src/lockdown/dns_sinkhole.rs` | DNS server, system DNS redirect, upstream forwarding |
| `apps/agent/src-tauri/src/lockdown/privilege.rs` | Platform-specific elevation helpers |
| `apps/server/src/ws/trust-engine.ts` | Trust score computation algorithm |
| `apps/server/src/ws/session-state.ts` | In-memory per-session runtime state |
| `apps/server/src/ws/watchdog.ts` | Heartbeat gap detection + reconnect handling |
| `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/page.tsx` | Live session monitor page |
| `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/use-session-ws.ts` | WebSocket hook for dashboard |
| `apps/web/src/lib/alert-sound.ts` | Audio alert system |

### Modified Files

| File | Changes |
|------|---------|
| `apps/agent/src-tauri/Cargo.toml` | Add nix, hickory-server, hickory-resolver, ntapi (Windows) |
| `apps/agent/src-tauri/src/lib.rs` | Add lockdown module, AppState.lockdown, new Tauri commands, startup recovery |
| `apps/agent/src-tauri/src/monitors/mod.rs` | No changes needed |
| `apps/agent/index.html` | Add Screen 4 (Interview Active), update preflight check names |
| `apps/agent/src/main.ts` | Extended preflight, suspend button, session timer, end interview, Screen 4 logic |
| `apps/agent/src/styles.css` | Styles for Screen 4, suspended process badge, lockdown indicators |
| `packages/shared-types/src/index.ts` | LockdownStatus, LockdownVerification, TrustScoreUpdate, TrustBreakdown, TrustSignal, extended WS message types, extended AgentHeartbeat |
| `packages/db/prisma/schema.prisma` | HeartbeatLog model, lockdownActive on InterviewSession |
| `apps/server/src/index.ts` | Refactored WS handler with trust engine integration, session_start_confirmed handling |
| `apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx` | "Monitor Live" button for active sessions |

## Appendix B: Dependency Versions

| Crate / Package | Version | Purpose |
|----------------|---------|---------|
| `nix` | 0.29 | POSIX signals (SIGSTOP/SIGCONT) for macOS/Linux |
| `hickory-server` | 0.25 | DNS server for sinkhole |
| `hickory-resolver` | 0.25 | DNS resolution for lockdown verification |
| `ntapi` | 0.4 | Windows NtSuspendProcess/NtResumeProcess |
| `winapi` | 0.3 | Windows process handle APIs |
