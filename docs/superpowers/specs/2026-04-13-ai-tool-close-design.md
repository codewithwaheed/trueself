# AI Tool Close Feature — Design Spec

**Date:** 2026-04-13
**Status:** Approved

## Problem

When the preflight "Scanning processes" check detects running AI tools (Claude, ChatGPT, Cursor, Copilot, etc.), the candidate currently sees a plain text failure message listing tool names. They must manually find and close those apps themselves, then hit "Re-run Checks." There is no in-app way to close detected tools.

## Goal

Let candidates quit detected AI tools directly from the TrueSelf agent preflight screen, without leaving the app.

## Design

### Rust Backend

**1. New type `FlaggedProcess`** (in `monitors/processes.rs`):
```rust
pub struct FlaggedProcess {
    pub pid: u32,
    pub name: String,
}
```

**2. Extend `PreflightCheck`** (in `lib.rs`):
```rust
pub struct PreflightCheck {
    pub name: String,
    pub passed: bool,
    pub details: String,
    pub flagged_processes: Option<Vec<FlaggedProcess>>,  // new
}
```
Only the "Scanning processes" check populates `flagged_processes`. All other checks leave it `None`.

**3. New Tauri command `kill_process`**:
```rust
#[tauri::command]
fn kill_process(pid: u32, force: bool) -> Result<(), String>
```
- `force: false` → sends SIGTERM (graceful quit, app saves its state)
- `force: true` → sends SIGKILL (immediate termination)
- Uses `sysinfo` to locate the process by PID and call `.kill()` or `.kill_with(Signal::Kill)`
- Returns an error string if the process is not found or the kill fails

**4. Register the command** in `invoke_handler!` in `lib.rs`.

### Frontend (TypeScript + HTML)

**Preflight result type** (`main.ts`):
```typescript
interface FlaggedProcess { pid: number; name: string; }
interface PreflightCheck {
  name: string;
  passed: boolean;
  details: string;
  flagged_processes?: FlaggedProcess[];
}
```

**Expanded process row** — when `check.name === "Scanning processes"` and `flagged_processes` is non-empty, `setCheckState` injects a process list below the fail icon:

```
● Claude    pid 12483    [Quit]  [Force Quit]
● Cursor    pid 18821    [Quit]  [Force Quit]
─────────────────────────────────────────────
              [Quit All & Re-run]
```

**Per-row Quit / Force Quit behavior:**
1. Button clicked → disable both buttons, show spinner on clicked button
2. Call `invoke("kill_process", { pid, force })`
3. Success → row icon becomes ✓, buttons removed, row text grays out
4. Error → row shows red "Failed to quit — try Force Quit" message; Force Quit button re-enables

**Quit All & Re-run:**
- Calls `kill_process` sequentially for all rows that are not yet closed
- After all kills (success or failure), calls `runPreflight()` to re-run the full check

**Existing "Re-run Checks" button** remains unchanged — candidates who prefer to close apps manually can still use it.

### CSS

Add styles for:
- `.process-list` — container below a failed checklist item
- `.process-row` — flex row with name, PID badge, action buttons
- `.process-row.closed` — grayed-out state after successful kill
- `.btn-quit` / `.btn-force-quit` — small destructive-style buttons matching existing design language
- `.quit-all-btn` — full-width button at the bottom of the process list

## Scope

- macOS and Windows (sysinfo handles both; SIGTERM/SIGKILL map to platform APIs via sysinfo)
- Only affects the preflight screen — monitoring heartbeat is unchanged
- No server-side changes needed

## Out of Scope

- Detecting/closing browser extensions
- Killing processes during the active session (only preflight)
- Showing process icons or memory usage
