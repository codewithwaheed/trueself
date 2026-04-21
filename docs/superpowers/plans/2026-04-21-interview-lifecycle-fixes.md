# Interview Lifecycle Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the End Interview button so it restores DNS/resumes processes and notifies the server, then add real-time session status updates on the interviewer dashboard.

**Architecture:** The agent calls a new unauthenticated `POST /api/sessions/:id/agent-end` HTTP endpoint (mirroring the existing `GET /api/sessions/code/:code` pattern), which marks the session COMPLETED and broadcasts to dashboards. The agent frontend replaces `window.confirm` with an inline confirmation state. The sessions list polls every 30s while pending sessions exist, and the live page shows a "Session Ended" overlay on completion.

**Tech Stack:** Rust/Tauri 2 (reqwest already in Cargo.toml), Hono server, Next.js 14 App Router, TypeScript.

---

## File Map

| File | Change |
|------|--------|
| `apps/server/src/index.ts` | Add `POST /api/sessions/:id/agent-end` route (unauthenticated) |
| `apps/agent/src-tauri/src/lib.rs` | Add `notify_session_ended` Tauri command + register it |
| `apps/agent/src/main.ts` | Replace `window.confirm` with inline confirm UI, fix end sequence |
| `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/page.tsx` | Handle `session_status_update: completed` → show ended overlay |
| `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx` | Add 30s polling when pending sessions exist |

---

## Task 1: Server — add agent-end endpoint

**Files:**
- Modify: `apps/server/src/index.ts`

This endpoint sits alongside the existing unauthenticated `GET /api/sessions/code/:code` route. It must be registered **before** `app.route("/api/sessions", endSessionRoute)` so it is matched first and bypasses auth middleware.

- [ ] **Step 1: Add the route in `apps/server/src/index.ts`**

Find the block that starts with `// ---- POST /api/sessions/:id/end (inline — needs access to wsSessions) ----` (around line 99). Insert the new route **before** `app.route("/api/sessions", endSessionRoute)` (line 150). Add this after the endSessionRoute definition block ends (after line 150):

```typescript
// POST /api/sessions/:id/agent-end — unauthenticated, called by the desktop agent
// The agent proves identity by knowing the session ID (set during verify_session_code).
app.post("/api/sessions/:id/agent-end", async (c) => {
  const sessionId = c.req.param("id");

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (session.status !== "ACTIVE") {
    // Idempotent — if already completed/cancelled, just acknowledge
    return c.json({ ok: true, already: session.status.toLowerCase() });
  }

  const endedAt = new Date();
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", endedAt },
  });

  // Tell any still-connected agent WebSocket the session ended
  sendToAgent(sessionId, { type: "session_end" });

  // Notify all dashboard viewers
  broadcastToDashboards(sessionId, {
    type: "session_status_update",
    sessionId,
    status: "completed",
    endedAt: endedAt.toISOString(),
  });

  return c.json({ ok: true });
});
```

Place this block **between** the `endSessionRoute` block definition and the final `app.route("/api/sessions", endSessionRoute)` line. The exact insertion point is after line 150 (`app.route("/api/sessions", endSessionRoute);`) — add it right before `wss.on("connection", ...` starts.

Actually: place it right after line 150 and before `wss.on`. The order in the file becomes:

```
app.route("/api/sessions", endSessionRoute);   // authenticated end-by-interviewer
app.post("/api/sessions/:id/agent-end", ...);  // unauthenticated end-by-agent  ← NEW
wss.on("connection", ...
```

- [ ] **Step 2: Manually verify the server compiles and the route exists**

```bash
cd /Users/m3/Work/trueself
pnpm dev:server
```

In a second terminal:
```bash
# Should return 404 (session doesn't exist — proves route is registered)
curl -s -X POST http://localhost:3001/api/sessions/nonexistent-id/agent-end
# Expected: {"error":"Session not found"}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): add unauthenticated POST /api/sessions/:id/agent-end for agent-initiated session end"
```

---

## Task 2: Agent Backend — add `notify_session_ended` Tauri command

**Files:**
- Modify: `apps/agent/src-tauri/src/lib.rs`

`reqwest` is already in `Cargo.toml`. This command is best-effort — if the server is unreachable, we still let local cleanup complete.

- [ ] **Step 1: Add the command function in `apps/agent/src-tauri/src/lib.rs`**

Find the `stop_monitoring` command (around line 251). Add the new command directly after it:

```rust
/// Notify the server that the agent is ending the interview session.
/// Best-effort: errors are logged but not propagated — local cleanup must succeed
/// regardless of server reachability.
#[tauri::command]
async fn notify_session_ended(state: State<'_, AppState>) -> Result<(), String> {
    let sid = state.session_id.lock().unwrap().clone();
    if let Some(id) = sid {
        let url = format!("http://localhost:3001/api/sessions/{}/agent-end", id);
        match reqwest::Client::new().post(&url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    eprintln!("[agent] agent-end notify got status: {}", resp.status());
                }
            }
            Err(e) => {
                eprintln!("[agent] agent-end notify failed: {}", e);
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Register the command in the `invoke_handler!` macro**

Find the `invoke_handler` block (around line 666):

```rust
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
```

Add `notify_session_ended` to the list:

```rust
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
    notify_session_ended,
])
```

- [ ] **Step 3: Build to verify no Rust compile errors**

```bash
cd /Users/m3/Work/trueself/apps/agent
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `Finished` with no errors. Warnings about `FLAGGED_DOMAINS` and `needs_elevation` are pre-existing — ignore them.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src-tauri/src/lib.rs
git commit -m "feat(agent): add notify_session_ended Tauri command to POST session end to server"
```

---

## Task 3: Agent Frontend — inline confirmation + correct end sequence

**Files:**
- Modify: `apps/agent/src/main.ts`

`window.confirm` in Tauri 2's WKWebView can silently return `false`. Replace it with an inline two-button confirmation that transforms the "End Interview" button in-place, with no modal/dialog needed.

The end sequence must be:
1. `stop_lockdown` first (restores DNS, resumes processes — needs session_id still set)
2. `stop_monitoring` second (aborts heartbeat, clears session_id)
3. `notify_session_ended` third (HTTP POST — uses session_id copied before step 2)
4. `showInterviewEndedScreen()`

- [ ] **Step 1: Replace `initReadyScreen` in `apps/agent/src/main.ts`**

Find the `initReadyScreen` function (around line 697) and replace its entire body:

```typescript
function initReadyScreen() {
  const endBtn = document.getElementById("end-interview-btn") as HTMLButtonElement | null;
  if (!endBtn) return;

  endBtn.addEventListener("click", async () => {
    // Replace button with inline confirmation — avoids window.confirm which
    // returns false silently in Tauri 2 WKWebView.
    if (endBtn.dataset.confirming === "true") return; // guard against double-click
    endBtn.dataset.confirming = "true";
    endBtn.textContent = "End interview?";
    endBtn.disabled = true;

    const confirmRow = document.createElement("div");
    confirmRow.style.cssText = "display:flex;gap:8px;justify-content:center;margin-top:8px;";

    const confirmYes = document.createElement("button");
    confirmYes.className = "btn-danger";
    confirmYes.style.cssText = "flex:1;max-width:140px;";
    confirmYes.textContent = "Yes, end it";

    const confirmNo = document.createElement("button");
    confirmNo.className = "btn-ghost";
    confirmNo.style.cssText = "flex:1;max-width:100px;";
    confirmNo.textContent = "Cancel";

    confirmRow.appendChild(confirmYes);
    confirmRow.appendChild(confirmNo);
    endBtn.insertAdjacentElement("afterend", confirmRow);

    confirmNo.addEventListener("click", () => {
      confirmRow.remove();
      endBtn.textContent = "End Interview";
      endBtn.disabled = false;
      delete endBtn.dataset.confirming;
    });

    confirmYes.addEventListener("click", async () => {
      confirmRow.remove();
      endBtn.textContent = "Ending...";

      // Capture session ID before stop_monitoring clears AppState
      const sid = currentSession?.id ?? null;

      try {
        // 1. Restore DNS + resume suspended processes (must be first)
        if (lockdownActive) {
          await invoke("stop_lockdown");
          lockdownActive = false;
        }

        // 2. Stop heartbeat loop (clears session_id in AppState)
        await invoke("stop_monitoring");

        // 3. Notify server — best-effort, non-blocking
        if (sid) {
          await invoke("notify_session_ended").catch((e: unknown) => {
            console.warn("notify_session_ended failed (non-fatal):", e);
          });
        }
      } catch (err) {
        console.error("Error during end interview cleanup:", err);
      }

      stopRespawnWatcher();
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      showInterviewEndedScreen();
    });
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/m3/Work/trueself/apps/agent
pnpm build 2>&1 | tail -10
```

Expected: build succeeds (or only pre-existing warnings).

- [ ] **Step 3: Manual smoke test**

```bash
cd /Users/m3/Work/trueself/apps/agent
pnpm tauri dev
```

1. Enter a valid session code → complete preflight → Start Interview
2. On the session overlay screen, click "End Interview"
3. Verify: the button text changes to "End interview?" and two sub-buttons appear ("Yes, end it" / "Cancel")
4. Click "Cancel" → verify buttons disappear and "End Interview" is restored
5. Click "End Interview" → "Yes, end it" → verify the "Interview Ended" screen appears
6. Check server logs: should see the session marked COMPLETED
7. If DNS sinkhole was active: verify system DNS is restored (`networksetup -getdnsservers Wi-Fi` should NOT show `127.0.0.1`)

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/main.ts
git commit -m "fix(agent): replace window.confirm with inline confirmation, fix end-interview sequence (stop_lockdown → stop_monitoring → notify_server)"
```

---

## Task 4: Live Page — handle session completion

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/page.tsx`

When the interviewer is watching the live view and the session ends (either agent-initiated via Task 3 or interviewer-initiated via the existing `POST /api/sessions/:id/end`), the page should show a clear "Session Ended" overlay instead of staying on the live dashboard indefinitely.

- [ ] **Step 1: Add `sessionEnded` state and handler in `LiveSessionPage`**

Find the state declarations near line 247:

```typescript
const [trustScore, setTrustScore] = useState(100);
const [trustFactors, setTrustFactors] = useState<TrustUpdate['factors']>({...});
const [wsConnected, setWsConnected] = useState(false);
const [agentConnected, setAgentConnected] = useState(true);
const [events, setEvents] = useState<SessionAlert[]>([]);
const [criticalBanner, setCriticalBanner] = useState<string | null>(null);
```

Add one more state after `criticalBanner`:

```typescript
const [sessionEnded, setSessionEnded] = useState<{ endedAt: string } | null>(null);
```

- [ ] **Step 2: Handle `session_status_update` in `handleMessage`**

Find the `handleMessage` callback (around line 277). The current `if/else` chain handles `trust_update`, `agent_status`, `session_alert`. Add a new branch:

```typescript
} else if (msg.type === 'session_status_update') {
  const update = msg as { type: string; status: string; endedAt?: string };
  if (update.status === 'completed') {
    setSessionEnded({ endedAt: update.endedAt ?? new Date().toISOString() });
  }
}
```

The full updated `handleMessage` body:

```typescript
const handleMessage = useCallback(
  (data: string) => {
    let msg: LiveMessage & { type: string; status?: string; endedAt?: string };
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      return;
    }

    if (msg.type === 'trust_update') {
      const update = msg as TrustUpdate;
      setTrustScore(update.score);
      setTrustFactors(update.factors);
    } else if (msg.type === 'agent_status') {
      const status = msg as AgentStatusUpdate;
      setAgentConnected(status.connected);
    } else if (msg.type === 'session_alert') {
      const alert = msg as SessionAlert;
      setEvents((prev) => [alert, ...prev].slice(0, MAX_EVENTS));
      if (alert.severity === 'critical') {
        setCriticalBanner(alert.message);
        const ctx = getOrCreateAudioCtx();
        if (ctx) playAlert(ctx);
      }
    } else if (msg.type === 'session_status_update' && msg.status === 'completed') {
      setSessionEnded({ endedAt: msg.endedAt ?? new Date().toISOString() });
    }
  },
  [getOrCreateAudioCtx]
);
```

- [ ] **Step 3: Render "Session Ended" overlay when `sessionEnded` is set**

Find the `return (` in `LiveSessionPage` (around line 365). Add an early return just before the main JSX `return`:

```typescript
if (sessionEnded) {
  const endTime = new Date(sessionEnded.endedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
        <svg className="w-8 h-8 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Session Ended</h1>
        <p className="text-sm text-[var(--text-muted)]">Completed at {endTime}</p>
      </div>
      <button
        onClick={() => router.push('/dashboard/sessions')}
        className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-4 py-2 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-default)]"
      >
        Back to Sessions
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/m3/Work/trueself
pnpm --filter web build 2>&1 | tail -15
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/sessions/\[id\]/live/page.tsx
git commit -m "feat(web): show Session Ended overlay on live page when session_status_update:completed received"
```

---

## Task 5: Sessions List — poll for pending→active transitions

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx`

The sessions list is server-rendered. When a candidate joins a pending session, the server broadcasts `session_status_update: active` — but only to WS connections that are already open for that specific session ID. The sessions list only opens a WS for the session in the drawer (if active). We add a 30s polling loop as a simple, reliable fallback.

- [ ] **Step 1: Add polling `useEffect` in `SessionsContent`**

Find the `useInterviewerWS` call block (around line 165):

```typescript
useInterviewerWS({
  sessionId: activeSessionId,
  onStatusUpdate: ({ status }: { status: string }) => {
    if (status === "completed" || status === "active") {
      router.refresh();
    }
  },
  onAgentStatus: (connected) => {
    if (!connected) {
      setResendToast("Agent disconnected");
      setTimeout(() => setResendToast(null), 4000);
    }
  },
});
```

Add the following `useEffect` immediately after that block:

```typescript
// Poll every 30s while any session is pending, to detect candidate joining.
// The WS-based path only covers sessions open in the drawer; polling covers the rest.
useEffect(() => {
  const hasPending = initialSessions.some((s) => s.status === "pending");
  if (!hasPending) return;

  const id = setInterval(() => {
    router.refresh();
  }, 30_000);

  return () => clearInterval(id);
}, [initialSessions, router]);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/m3/Work/trueself
pnpm --filter web build 2>&1 | tail -15
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/sessions/sessions-content.tsx
git commit -m "feat(web): poll sessions list every 30s while pending sessions exist for real-time status updates"
```

---

## End-to-End Verification

After all tasks are complete, run a full lifecycle test:

```bash
# Terminal 1: Start server + DB
docker compose up -d
pnpm dev:server

# Terminal 2: Start web dashboard
pnpm dev:web

# Terminal 3: Start agent
cd apps/agent && pnpm tauri dev
```

**Test flow:**
1. Interviewer creates a new session in the dashboard → note the session code
2. Candidate enters the code in the agent → completes preflight → activates lockdown → clicks "Start Interview"
3. **Assert:** Interviewer's sessions list (within 30s) shows the session as "Active"
4. **Assert:** "View Live" link appears on the session row
5. Interviewer clicks "View Live" → live page opens → trust score visible
6. **Candidate** clicks "End Interview" → inline confirm appears → clicks "Yes, end it"
7. **Assert (agent):** "Interview Ended" screen appears with elapsed time
8. **Assert (agent):** `networksetup -getdnsservers Wi-Fi` does NOT show `127.0.0.1`
9. **Assert (server logs):** Session marked COMPLETED
10. **Assert (live page):** "Session Ended" overlay appears within a few seconds
11. **Assert (sessions list):** Session moves to "Completed" tab on next refresh
