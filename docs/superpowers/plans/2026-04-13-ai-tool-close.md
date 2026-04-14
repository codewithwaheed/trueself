# AI Tool Close Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let candidates quit detected AI tools directly from the TrueSelf preflight screen, with per-tool Quit (graceful) and Force Quit (immediate) buttons plus a Quit All & Re-run action.

**Architecture:** Extend `PreflightCheck` in Rust with an optional `flagged_processes` field so structured process data flows through the existing `run_preflight` invoke. A new `kill_process(pid, force)` Tauri command handles termination using `sysinfo`. The TypeScript frontend renders an inline process list beneath the failing checklist item with per-row action buttons.

**Tech Stack:** Rust + sysinfo, Tauri 2 command system, TypeScript, CSS custom properties

---

## File Map

| File | Change |
|------|--------|
| `apps/agent/src-tauri/src/monitors/processes.rs` | Add `FlaggedProcess` struct |
| `apps/agent/src-tauri/src/lib.rs` | Add `flagged_processes` to `PreflightCheck`; add `kill_process` command; register it |
| `apps/agent/src/main.ts` | Add TS types; extend preflight loop; add process list renderer + kill logic |
| `apps/agent/src/styles.css` | Add `.process-list`, `.process-row`, `.btn-quit`, `.btn-force-quit` styles |

---

## Task 1: Add `FlaggedProcess` struct to `processes.rs`

**Files:**
- Modify: `apps/agent/src-tauri/src/monitors/processes.rs`

- [ ] **Step 1: Add the struct after the existing `ProcessInfo` definition**

In `apps/agent/src-tauri/src/monitors/processes.rs`, add after line 21 (after the closing `}` of `ProcessInfo`):

```rust
#[derive(Debug, Serialize, Clone)]
pub struct FlaggedProcess {
    pub pid: u32,
    pub name: String,
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/agent && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30
```

Expected: no errors (warnings about unused struct are fine at this stage).

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src-tauri/src/monitors/processes.rs
git commit -m "feat(agent): add FlaggedProcess struct to processes monitor"
```

---

## Task 2: Extend `PreflightCheck` and update `run_preflight`

**Files:**
- Modify: `apps/agent/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `flagged_processes` field to `PreflightCheck`**

In `apps/agent/src-tauri/src/lib.rs`, replace the existing `PreflightCheck` struct (lines 27–31):

```rust
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct PreflightCheck {
    pub name: String,
    pub passed: bool,
    pub details: String,
    pub flagged_processes: Option<Vec<monitors::processes::FlaggedProcess>>,
}
```

- [ ] **Step 2: Update all `PreflightCheck` construction sites to include the new field**

In `run_preflight`, every `checks.push(PreflightCheck { ... })` call needs `flagged_processes: None` added — except the processes check. Update each push:

**Server connectivity check** (no change to logic, add field):
```rust
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
```

**Display check** (no change to logic, add field):
```rust
checks.push(PreflightCheck {
    name: "Checking displays".to_string(),
    passed: screen_ok,
    details,
    flagged_processes: None,
});
```

**Process scan check** — replace the existing push with:
```rust
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
            flagged.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")
        )
    },
    flagged_processes: if flagged.is_empty() { None } else { Some(flagged) },
});
```

**Permissions check** (no change to logic, add field):
```rust
checks.push(PreflightCheck {
    name: "Verifying permissions".to_string(),
    passed: true,
    details: "All permissions granted".to_string(),
    flagged_processes: None,
});
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/agent && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src-tauri/src/lib.rs
git commit -m "feat(agent): extend PreflightCheck with flagged_processes field"
```

---

## Task 3: Add `kill_process` Tauri command

**Files:**
- Modify: `apps/agent/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `kill_process` command function**

Add this function after `stop_monitoring` (around line 191), before `get_ws_connected`:

```rust
/// Kill a process by PID. force=false sends SIGTERM (graceful), force=true sends SIGKILL.
#[tauri::command]
fn kill_process(pid: u32, force: bool) -> Result<(), String> {
    use sysinfo::{Pid, Signal, System};

    let mut sys = System::new();
    let pid_val = Pid::from_u32(pid);
    sys.refresh_process(pid_val);

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
```

- [ ] **Step 2: Register `kill_process` in the invoke handler**

In `lib.rs`, find the `invoke_handler` call (around line 362) and add `kill_process` to the list:

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
])
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/agent && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src-tauri/src/lib.rs
git commit -m "feat(agent): add kill_process Tauri command (graceful + force)"
```

---

## Task 4: Add CSS for the process list UI

**Files:**
- Modify: `apps/agent/src/styles.css`

- [ ] **Step 1: Append the process list styles to `styles.css`**

Add at the end of `apps/agent/src/styles.css`:

```css
/* ---- Process List (AI tool close UI, shown inside failed scan check) ---- */

.process-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.process-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: 6px;
  transition: opacity 0.2s;
}

.process-row.closed {
  opacity: 0.45;
  border-color: rgba(34, 197, 94, 0.2);
  background: rgba(34, 197, 94, 0.05);
}

.process-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--error);
  flex-shrink: 0;
}

.process-row.closed .process-dot {
  background: var(--success);
}

.process-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.process-pid {
  font-size: 11px;
  color: var(--text-muted);
  font-family: "SF Mono", "Fira Code", monospace;
  flex-shrink: 0;
}

.process-actions {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.process-row-error {
  font-size: 11px;
  color: var(--error);
  margin-top: 2px;
  padding-left: 15px;
}

/* Small action buttons — override the full-width default button style */
.btn-quit,
.btn-force-quit {
  width: auto;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 5px;
  border: 1px solid;
}

.btn-quit {
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-quit:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
}

.btn-force-quit {
  background: rgba(239, 68, 68, 0.18);
  color: var(--error);
  border-color: rgba(239, 68, 68, 0.45);
}

.btn-force-quit:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.3);
}

.process-list-footer {
  margin-top: 4px;
}

.btn-quit-all {
  width: 100%;
  background: var(--error);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s;
  font-family: var(--font);
}

.btn-quit-all:hover:not(:disabled) {
  background: #dc2626;
}

.btn-quit-all:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent/src/styles.css
git commit -m "feat(agent): add process list CSS for AI tool close UI"
```

---

## Task 5: Update TypeScript — types, rendering, and kill logic

**Files:**
- Modify: `apps/agent/src/main.ts`

- [ ] **Step 1: Add the new TypeScript types at the top of `main.ts`**

After the existing `PreflightCheck` interface (after line 12), add:

```typescript
interface FlaggedProcess {
  pid: number;
  name: string;
}

interface PreflightCheck {
  name: string;
  passed: boolean;
  details: string;
  flagged_processes?: FlaggedProcess[];
}
```

Remove (or replace) the existing `PreflightCheck` interface at line 8–12 — the new one above supersedes it.

- [ ] **Step 2: Update `runPreflight` to pass `flagged_processes` through**

The `checks` array returned by `invoke("run_preflight")` now has the `flagged_processes` field. Update the loop in `runPreflight` (around line 173) to pass the full check object to a new render function:

Replace the inner loop body:
```typescript
for (let i = 0; i < checks.length; i++) {
  const check = checks[i];

  // Show as pending briefly while "running"
  setCheckState(check.name, "pending");
  await delay(400 + i * 100);
  setCheckState(
    check.name,
    check.passed ? "pass" : "fail",
    check.details
  );

  if (!check.passed) allPassed = false;
}
```

With:
```typescript
for (let i = 0; i < checks.length; i++) {
  const check = checks[i];

  setCheckState(check.name, "pending");
  await delay(400 + i * 100);
  setCheckState(check.name, check.passed ? "pass" : "fail", check.details);

  if (!check.passed) allPassed = false;

  // If process scan failed, render the inline close UI
  if (check.name === "Scanning processes" && !check.passed && check.flagged_processes?.length) {
    renderProcessList(check.name, check.flagged_processes);
  }
}
```

- [ ] **Step 3: Add `renderProcessList` function**

Add this function after `setCheckState` (around line 154):

```typescript
function renderProcessList(checkName: string, processes: FlaggedProcess[]) {
  const li = document.getElementById(`check-${slugify(checkName)}`);
  if (!li) return;

  // Remove any existing process list (e.g., from a previous re-run)
  li.querySelector(".process-list")?.remove();

  // Make the checklist item top-aligned so the list doesn't look odd
  li.style.alignItems = "flex-start";

  const listEl = document.createElement("div");
  listEl.className = "process-list";

  for (const proc of processes) {
    const row = document.createElement("div");
    row.className = "process-row";
    row.dataset.pid = String(proc.pid);
    row.innerHTML = `
      <span class="process-dot"></span>
      <span class="process-name">${escapeHtml(proc.name)}</span>
      <span class="process-pid">pid ${proc.pid}</span>
      <div class="process-actions">
        <button class="btn-quit">Quit</button>
        <button class="btn-force-quit">Force Quit</button>
      </div>
    `;

    const quitBtn = row.querySelector<HTMLButtonElement>(".btn-quit")!;
    const forceBtn = row.querySelector<HTMLButtonElement>(".btn-force-quit")!;

    quitBtn.addEventListener("click", () => killProcess(proc.pid, false, row, quitBtn, forceBtn));
    forceBtn.addEventListener("click", () => killProcess(proc.pid, true, row, quitBtn, forceBtn));

    listEl.appendChild(row);
  }

  // Quit All & Re-run footer
  const footer = document.createElement("div");
  footer.className = "process-list-footer";
  const quitAllBtn = document.createElement("button");
  quitAllBtn.className = "btn-quit-all";
  quitAllBtn.textContent = "Quit All & Re-run";
  quitAllBtn.addEventListener("click", () => quitAllAndRerun(listEl, quitAllBtn));
  footer.appendChild(quitAllBtn);
  listEl.appendChild(footer);

  // Inject into .item-text
  li.querySelector(".item-text")!.appendChild(listEl);
}
```

- [ ] **Step 4: Add `killProcess` helper function**

Add after `renderProcessList`:

```typescript
async function killProcess(
  pid: number,
  force: boolean,
  row: HTMLElement,
  quitBtn: HTMLButtonElement,
  forceBtn: HTMLButtonElement
) {
  // Disable buttons, show spinner on the clicked one
  quitBtn.disabled = true;
  forceBtn.disabled = true;
  const activeBtn = force ? forceBtn : quitBtn;
  const originalText = activeBtn.textContent!;
  activeBtn.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:1.5px;"></span>`;

  // Remove any previous error
  row.querySelector(".process-row-error")?.remove();

  try {
    await invoke("kill_process", { pid, force });
    // Success — mark row as closed
    row.classList.add("closed");
    row.querySelector(".process-actions")!.remove();
  } catch (err) {
    // Failure — restore buttons, show error
    quitBtn.disabled = true; // keep Quit disabled, only force still makes sense
    activeBtn.textContent = originalText;
    forceBtn.disabled = false;
    const errEl = document.createElement("div");
    errEl.className = "process-row-error";
    errEl.textContent = "Failed to quit — try Force Quit";
    row.after(errEl);
  }
}
```

- [ ] **Step 5: Add `quitAllAndRerun` helper function**

Add after `killProcess`:

```typescript
async function quitAllAndRerun(listEl: HTMLElement, btn: HTMLButtonElement) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:1.5px;border-top-color:#fff;"></span> Quitting...`;

  const rows = listEl.querySelectorAll<HTMLElement>(".process-row:not(.closed)");
  for (const row of rows) {
    const pid = Number(row.dataset.pid);
    const quitBtn = row.querySelector<HTMLButtonElement>(".btn-quit")!;
    const forceBtn = row.querySelector<HTMLButtonElement>(".btn-force-quit")!;
    await killProcess(pid, false, row, quitBtn, forceBtn);
  }

  // Re-run preflight regardless of individual failures
  await runPreflight();
}
```

- [ ] **Step 6: Add `escapeHtml` utility function**

Add after the existing `slugify` utility (around line 271):

```typescript
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 7: Also clear the process list when `buildChecklist` is called (on re-run)**

`buildChecklist` already rebuilds `list.innerHTML = ""`, which removes the entire `<ul>` and re-injects `<li>` elements — so the process list is automatically cleared on each re-run. No changes needed here. Verify by reading `buildChecklist` (line 105) to confirm it sets `list.innerHTML = ""`.

- [ ] **Step 8: Commit**

```bash
git add apps/agent/src/main.ts
git commit -m "feat(agent): render AI tool close UI in preflight with Quit and Force Quit"
```

---

## Task 6: Manual integration verification

No automated test harness exists for Tauri commands, so verify manually.

- [ ] **Step 1: Start a server + web app so session code lookup works**

```bash
pnpm dev:server
```

- [ ] **Step 2: Launch the agent in dev mode**

```bash
cd apps/agent && pnpm tauri dev
```

- [ ] **Step 3: Verify the happy path (no AI tools running)**

If no flagged processes are running, enter any valid session code and run preflight. "Scanning processes" should show ✓ No AI tools detected. The process list should not appear.

- [ ] **Step 4: Verify the AI tool detection path**

Open a flagged app (e.g., the Claude desktop app or Cursor). Run preflight. "Scanning processes" should show ✗ with the process list expanded inline, showing the app name and PID, with Quit and Force Quit buttons.

- [ ] **Step 5: Verify Quit (graceful)**

Click **Quit** on a row. The row should show a spinner, then transition to grayed-out ✓ closed state with buttons removed.

- [ ] **Step 6: Verify Force Quit**

With an app running, click **Force Quit**. Same result as graceful quit but using SIGKILL.

- [ ] **Step 7: Verify Quit All & Re-run**

With multiple flagged apps open, click **Quit All & Re-run**. All rows should close in sequence, then preflight should automatically re-run. If all tools are closed, the scan should now pass.

- [ ] **Step 8: Verify error handling**

Kill a process manually in the OS before clicking Quit in the agent. The row should show "Failed to quit — try Force Quit" error text (process not found).

- [ ] **Step 9: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix(agent): integration fixups for AI tool close feature"
```

---

## Self-Review

**Spec coverage:**
- ✅ `FlaggedProcess` struct added to Rust
- ✅ `PreflightCheck.flagged_processes` field added
- ✅ `kill_process(pid, force)` command — SIGTERM / SIGKILL
- ✅ Per-row Quit + Force Quit buttons
- ✅ Row updates to closed state on success (buttons removed, grayed out)
- ✅ Row shows error on failure, Force Quit re-enables
- ✅ "Quit All & Re-run" closes all then calls `runPreflight()`
- ✅ Existing "Re-run Checks" button unchanged
- ✅ `escapeHtml` prevents XSS from process names

**Type consistency:**
- `FlaggedProcess` defined in Task 1 (Rust) and Task 5 (TS) with same fields (`pid`, `name`)
- `PreflightCheck.flagged_processes` defined in Task 2 (Rust) matches TS type in Task 5
- `kill_process` registered in Task 3 and called as `invoke("kill_process", { pid, force })` in Task 5 — ✅ matches

**Placeholder scan:** No TBDs or vague steps found.
