# Design: Interview Lifecycle Fixes

**Date:** 2026-04-21  
**Scope:** Fix End Interview button, DNS/process restoration on end, session status lifecycle (PENDING→ACTIVE→COMPLETED), interviewer real-time notifications.

---

## Problem Summary

Four interconnected bugs prevent the interview lifecycle from working end-to-end:

1. **Agent End Interview button does nothing** — `window.confirm()` in Tauri 2's WKWebView silently returns `false`, so the handler short-circuits before any cleanup runs. DNS is never restored, suspended processes are never resumed.

2. **Agent never notifies the server on end** — Even if the button worked, it only does local cleanup (`stop_monitoring`, `stop_lockdown`). The server session stays `ACTIVE` indefinitely. The interviewer's dashboard never shows "completed".

3. **Sessions list has no pending→active detection** — `useInterviewerWS` in `sessions-content.tsx` only opens a WebSocket for `drawerSession.status === "active"`. If the candidate joins while the interviewer is just viewing the list (drawer closed), nothing updates.

4. **Live page ignores session completion** — `handleMessage` in `live/page.tsx` handles `trust_update`, `agent_status`, and `session_alert` but drops `session_status_update: completed`. The interviewer stays on the live view even after the interview ends.

---

## Architecture

### Flow After This Fix

```
Candidate clicks "End Interview"
  → inline confirmation UI (no window.confirm)
  → invoke stop_lockdown        (DNS restored, processes resumed)
  → invoke stop_monitoring      (heartbeat aborted)
  → invoke notify_session_ended (HTTP POST /api/sessions/:id/agent-end)
      → server marks COMPLETED
      → server broadcasts session_status_update: completed to all dashboards
      → server sends session_end to agent (agent already ending — ignored)
  → agent shows "Interview Ended" screen

Interviewer on sessions list
  → sees pending sessions
  → useSessionsPoller polls every 30s (router.refresh) OR
    WS connection per pending session fires onStatusUpdate → router.refresh()
  → session moves to Active tab instantly when candidate joins

Interviewer on live page
  → receives session_status_update: completed
  → shows "Session Ended" overlay with duration
```

---

## Component Changes

### 1. Agent Frontend (`apps/agent/src/main.ts`)

**Replace `window.confirm` with inline confirmation state:**

In `initReadyScreen()`, instead of `window.confirm(...)`, show a confirmation state inline: replace the "End Interview" button text with "Confirm End" + "Cancel" buttons. On "Confirm End", proceed with cleanup. This is purely a UI change to the button's click handler.

**Sequential cleanup on confirmed end:**
```
1. invoke("stop_lockdown")   → async, restores DNS + resumes processes
2. invoke("stop_monitoring") → aborts heartbeat task
3. invoke("notify_session_ended") → HTTP POST to server (new Rust command)
4. showInterviewEndedScreen()
```

`stop_lockdown` must run FIRST while the session ID is still set in AppState, before `stop_monitoring` clears it.

### 2. Agent Backend (`apps/agent/src-tauri/src/lib.rs`)

**New Tauri command `notify_session_ended`:**

```rust
#[tauri::command]
async fn notify_session_ended(state: State<'_, AppState>) -> Result<(), String> {
    let sid = state.session_id.lock().unwrap().clone();
    if let Some(id) = sid {
        let url = format!("http://localhost:3001/api/sessions/{}/agent-end", id);
        let _ = reqwest::Client::new().post(&url).send().await;
    }
    Ok(())
}
```

This is best-effort (we `let _ = ...`). If the server is unreachable, local cleanup already happened — we don't block the user on a network failure.

Register in `invoke_handler!`.

### 3. Server (`apps/server/src/index.ts`)

**New unauthenticated route `POST /api/sessions/:id/agent-end`:**

Registered BEFORE the authenticated sessions router (same pattern as `GET /api/sessions/code/:code`).

```
- Find session by ID
- If not found → 404
- If status !== ACTIVE → 409 (idempotent: completed is already done)
- Update status to COMPLETED, set endedAt = now()
- sendToAgent(sessionId, { type: "session_end" })
- broadcastToDashboards(sessionId, { type: "session_status_update", status: "completed", endedAt })
- Return 200 { ok: true }
```

No auth required — the session ID in the URL is the only credential needed (the agent must know it to call this).

### 4. Sessions List (`apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx`)

**Polling for pending→active transitions:**

Add a `useEffect` that watches `initialSessions` for any `pending` entries. While any exist, `router.refresh()` is called every 30 seconds. When no pending sessions remain, the interval is cleared.

```typescript
useEffect(() => {
  const hasPending = initialSessions.some(s => s.status === "pending");
  if (!hasPending) return;
  const id = setInterval(() => router.refresh(), 30_000);
  return () => clearInterval(id);
}, [initialSessions, router]);
```

This is O(1) connections, simple, and handles the case where the interviewer is on the sessions list waiting for the candidate to join.

For completeness, the existing `useInterviewerWS` already handles real-time updates when the drawer is open on an active session — that path is unchanged.

### 5. Live Page (`apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/page.tsx`)

**Handle session_status_update in `handleMessage`:**

Add a new state `sessionEnded: boolean` (default `false`).

When `msg.type === "session_status_update" && msg.status === "completed"`:
- Set `sessionEnded = true`
- Store `endedAt` for display

Render a full-page "Session Ended" overlay when `sessionEnded` is true, showing:
- "Interview Complete" heading
- End timestamp
- "Back to Sessions" button → `router.push("/dashboard/sessions")`

The WS connection can remain open (or close gracefully — the server already closes it when the session ends).

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Agent can't reach server on end | `notify_session_ended` fails silently; local cleanup still completes; interviewer sees "Agent disconnected" notification |
| `stop_lockdown` DNS restore fails | Existing fallback: osascript elevation prompt; if that also fails, the backup file is still on disk for crash recovery on next launch |
| App quits without clicking end | `LockdownState::Drop` runs `stop_sync()` — DNS restored synchronously; processes resumed |
| Server already marked session COMPLETED | `POST /api/sessions/:id/agent-end` returns 409; agent ignores it |

---

## Out of Scope

- Push notifications for session start (browser `Notification` API already wired in `use-interviewer-ws.ts`; polling covers the gap without adding infra)
- Interviewer-initiated end from the live page (the `POST /api/sessions/:id/end` endpoint already handles this correctly)
- Windows/Linux DNS restore differences (existing platform-specific code handles these)
