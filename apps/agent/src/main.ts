import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentSessionInfo } from "@trueself/shared-types";

// ---- State ----

interface FlaggedProcess {
  pid: number;
  name: string;
  parent_pid?: number;
  parent_name?: string;
}

interface PreflightCheck {
  name: string;
  passed: boolean;
  details: string;
  flagged_processes?: FlaggedProcess[];
}

let currentSession: AgentSessionInfo | null = null;

// Tracks whether any flagged processes were found in the last preflight run
let hadFlaggedProcesses = false;
// Tracks whether the lockdown was verified successfully
let lockdownVerified = false;
// Tracks whether the lockdown was activated (even without verification)
let lockdownActive = false;
// Session timer state
let sessionStartTime: number | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;

// Respawn watcher: names of processes the user killed that we now watch for
const killedProcessNames = new Set<string>();
let respawnWatcherInterval: ReturnType<typeof setInterval> | null = null;

// ---- Screen helpers ----

function showScreen(id: "screen-welcome" | "screen-preflight" | "screen-ready") {
  document.querySelectorAll<HTMLElement>(".screen").forEach((el) => {
    el.classList.remove("active");
    el.classList.add("hidden");
  });
  const target = document.getElementById(id)!;
  target.classList.remove("hidden");
  target.classList.add("active");
}

// ---- Screen 1: Code Entry ----

function initWelcomeScreen() {
  const form = document.getElementById("code-form") as HTMLFormElement;
  const input = document.getElementById("code-input") as HTMLInputElement;
  const errorEl = document.getElementById("code-error") as HTMLElement;
  const verifyLabel = document.getElementById("verify-label") as HTMLElement;
  const verifySpinner = document.getElementById("verify-spinner") as HTMLElement;
  const verifyBtn = document.getElementById("verify-btn") as HTMLButtonElement;

  // Only allow digits
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
    input.classList.remove("error");
    errorEl.classList.add("hidden");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (code.length !== 6) {
      showError("Please enter a 6-digit session code.");
      return;
    }

    setLoading(true);
    try {
      currentSession = await invoke<AgentSessionInfo>("verify_session_code", { code });
      showPreflightScreen(currentSession);
    } catch (err) {
      showError(typeof err === "string" ? err : "Cannot connect to server. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  });

  function showError(msg: string) {
    input.classList.add("error");
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  }

  function setLoading(loading: boolean) {
    verifyBtn.disabled = loading;
    verifyLabel.classList.toggle("hidden", loading);
    verifySpinner.classList.toggle("hidden", !loading);
  }
}

// ---- Screen 2: Preflight ----

const CHECK_NAMES = [
  "Connecting to server",
  "Checking displays",
  "Scanning processes",
  "Verifying permissions",
];

function showPreflightScreen(session: AgentSessionInfo) {
  // Populate session header
  const company = document.getElementById("session-company")!;
  const interviewer = document.getElementById("session-interviewer")!;
  const time = document.getElementById("session-time")!;

  company.textContent = session.companyName;
  interviewer.textContent = `Interviewer: ${session.interviewerName}`;
  time.textContent = `Scheduled: ${formatDate(session.scheduledAt)}`;

  // Build initial checklist (all idle)
  buildChecklist(CHECK_NAMES);

  showScreen("screen-preflight");

  // Run preflight automatically
  runPreflight();
}

function buildChecklist(names: string[]) {
  const list = document.getElementById("checklist")!;
  list.innerHTML = "";
  for (const name of names) {
    const li = document.createElement("li");
    li.className = "checklist-item";
    li.id = `check-${slugify(name)}`;
    li.innerHTML = `
      <div class="item-icon">
        <div class="icon-idle"></div>
      </div>
      <div class="item-text">
        <div class="item-name">${name}</div>
        <div class="item-detail"></div>
      </div>
    `;
    list.appendChild(li);
  }
}

function setCheckState(
  name: string,
  state: "pending" | "pass" | "fail",
  detail?: string
) {
  const li = document.getElementById(`check-${slugify(name)}`);
  if (!li) return;

  const iconEl = li.querySelector(".item-icon")!;
  const detailEl = li.querySelector<HTMLElement>(".item-detail")!;

  if (detail) detailEl.textContent = detail;

  let iconHTML = "";
  if (state === "pending") {
    iconHTML = `<div class="icon-pending"></div>`;
  } else if (state === "pass") {
    iconHTML = `<svg class="icon-pass" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.5"/>
      <path d="M5.5 9.5l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  } else {
    iconHTML = `<svg class="icon-fail" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.5"/>
      <path d="M6 6l6 6M12 6l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }

  iconEl.innerHTML = iconHTML;
}

function renderProcessList(checkName: string, processes: FlaggedProcess[]) {
  const li = document.getElementById(`check-${slugify(checkName)}`);
  if (!li) return;

  // Remove any existing process list (e.g., from a previous re-run)
  li.querySelector(".process-list")?.remove();

  // Top-align so the expanded list doesn't look odd
  li.style.alignItems = "flex-start";

  const listEl = document.createElement("div");
  listEl.className = "process-list";

  for (const proc of processes) {
    // When the flagged process is an extension subprocess inside an IDE,
    // killing the child is pointless — the IDE respawns it immediately.
    // Target the parent instead.
    const killTargetPid = proc.parent_pid ?? proc.pid;
    const killTargetName = proc.parent_name ?? proc.name;
    const isChildProc = !!proc.parent_pid;

    const row = document.createElement("div");
    row.className = "process-row";
    row.dataset.pid = String(killTargetPid);
    row.dataset.procName = killTargetName;
    row.dataset.originalPid = String(proc.pid);
    row.innerHTML = `
      <div class="process-row-header">
        <span class="process-dot"></span>
        <span class="process-name">${escapeHtml(proc.name)}</span>
        ${isChildProc ? `<span class="process-parent">via ${escapeHtml(killTargetName)}</span>` : ""}
      </div>
      <div class="process-row-meta">
        <span class="process-pid">pid ${proc.pid}</span>
      </div>
      <div class="process-actions">
        <button class="btn-quit">${isChildProc ? `Close ${escapeHtml(killTargetName)}` : "Quit"}</button>
        <button class="btn-force-quit">${isChildProc ? `Force Close ${escapeHtml(killTargetName)}` : "Force Quit"}</button>
      </div>
    `;

    const quitBtn = row.querySelector<HTMLButtonElement>(".btn-quit")!;
    const forceBtn = row.querySelector<HTMLButtonElement>(".btn-force-quit")!;

    quitBtn.addEventListener("click", () => killProcess(killTargetPid, killTargetName, false, row, quitBtn, forceBtn));
    forceBtn.addEventListener("click", () => killProcess(killTargetPid, killTargetName, true, row, quitBtn, forceBtn));

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

  // Inject into .item-text so it expands below the name/detail
  li.querySelector(".item-text")!.appendChild(listEl);
}

// Mark a row (and all siblings with same pid) as auto-suspended due to respawning.
async function autoSuspendRespawnedProcess(pid: number, name: string, listEl: HTMLElement) {
  try {
    await invoke("suspend_processes", { pids: [pid] });
  } catch (_err) {
    // Best-effort — if suspend fails we still show it as detected
  }

  // Find existing row for this pid, or create a new respawn row
  let existing = listEl.querySelector<HTMLElement>(`.process-row[data-pid="${pid}"]`);
  if (!existing) {
    const row = document.createElement("div");
    row.className = "process-row process-suspended";
    row.dataset.pid = String(pid);
    row.dataset.procName = name;
    row.innerHTML = `
      <div class="process-row-header">
        <span class="process-dot"></span>
        <span class="process-name">${escapeHtml(name)}</span>
        <span class="badge-respawning">↻ Respawned</span>
      </div>
      <div class="process-row-meta">
        <span class="process-pid">pid ${pid}</span>
      </div>
      <div class="process-actions">
        <span class="badge-suspended">Auto-suspended</span>
      </div>
    `;
    // Insert before footer
    const footer = listEl.querySelector(".process-list-footer");
    footer ? listEl.insertBefore(row, footer) : listEl.appendChild(row);
  } else {
    existing.classList.add("process-suspended");
    const actionsEl = existing.querySelector(".process-actions");
    if (actionsEl) {
      actionsEl.innerHTML = `<span class="badge-respawning">↻ Respawned</span><span class="badge-suspended">Auto-suspended</span>`;
    }
  }

  checkAndShowLockdownSection();
  updateStartInterviewBtnState();
}

// Start watching for processes that respawn after being killed.
// Polls scan_processes every 2s; if a watched name reappears with a new PID, auto-suspends it.
function startRespawnWatcher() {
  if (respawnWatcherInterval) return; // already running

  const seenPids = new Set<number>(
    Array.from(document.querySelectorAll<HTMLElement>(".process-row")).map((r) => Number(r.dataset.pid))
  );

  respawnWatcherInterval = setInterval(async () => {
    if (killedProcessNames.size === 0) return;

    try {
      const processes: FlaggedProcess[] = await invoke("scan_processes");
      const listEl = document.querySelector<HTMLElement>(".process-list");
      if (!listEl) return;

      for (const proc of processes) {
        const targetName = proc.parent_name ?? proc.name;
        const targetPid = proc.parent_pid ?? proc.pid;

        if (killedProcessNames.has(targetName) && !seenPids.has(targetPid)) {
          seenPids.add(targetPid);
          await autoSuspendRespawnedProcess(targetPid, targetName, listEl);
        }
      }
    } catch (_err) {
      // scan may fail transiently — ignore
    }
  }, 2000);
}

function stopRespawnWatcher() {
  if (respawnWatcherInterval) {
    clearInterval(respawnWatcherInterval);
    respawnWatcherInterval = null;
  }
  killedProcessNames.clear();
}

async function killProcess(
  pid: number,
  procName: string,
  force: boolean,
  row: HTMLElement,
  quitBtn: HTMLButtonElement,
  forceBtn: HTMLButtonElement
) {
  quitBtn.disabled = true;
  forceBtn.disabled = true;
  const activeBtn = force ? forceBtn : quitBtn;
  const originalText = activeBtn.textContent!;
  activeBtn.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:1.5px;"></span>`;

  row.nextElementSibling?.classList.contains("process-row-error") &&
    row.nextElementSibling.remove();

  try {
    await invoke("kill_process", { pid, force });

    // Mark every row targeting this PID as closed
    const list = row.closest(".process-list");
    const siblings = list
      ? list.querySelectorAll<HTMLElement>(`.process-row[data-pid="${pid}"]`)
      : [row];
    for (const sibling of siblings) {
      sibling.classList.add("closed");
      sibling.querySelector(".process-actions")?.remove();
    }

    // Watch this process name for respawning
    killedProcessNames.add(procName);
    startRespawnWatcher();

    checkAndShowLockdownSection();
    updateStartInterviewBtnState();
  } catch (_err) {
    activeBtn.textContent = originalText;
    forceBtn.disabled = false;
    const errEl = document.createElement("div");
    errEl.className = "process-row-error";
    errEl.textContent = "Failed to quit — try Force Quit";
    row.after(errEl);
  }
}

async function quitAllAndRerun(listEl: HTMLElement, btn: HTMLButtonElement) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:1.5px;border-top-color:#fff;"></span> Quitting...`;

  // Deduplicate by target PID
  const seenPids = new Set<number>();
  const rows = listEl.querySelectorAll<HTMLElement>(".process-row:not(.closed):not(.process-suspended)");
  for (const row of rows) {
    const targetPid = Number(row.dataset.pid);
    const procName = row.dataset.procName ?? "";
    if (seenPids.has(targetPid)) continue;
    seenPids.add(targetPid);
    const qb = row.querySelector<HTMLButtonElement>(".btn-quit")!;
    const fb = row.querySelector<HTMLButtonElement>(".btn-force-quit")!;
    if (qb && fb) {
      await killProcess(targetPid, procName, false, row, qb, fb);
    }
  }

  // Give process trees time to fully terminate before re-scanning
  btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:1.5px;border-top-color:#fff;"></span> Waiting...`;
  await delay(1500);

  await runPreflight();
}

// Check whether all flagged process rows are handled (closed or suspended)
// and show the lockdown section if so.
function checkAndShowLockdownSection() {
  const allRows = document.querySelectorAll<HTMLElement>(".process-row");
  if (allRows.length === 0) return;

  const allHandled = Array.from(allRows).every(
    (r) => r.classList.contains("closed") || r.classList.contains("process-suspended")
  );

  const lockdownSection = document.getElementById("lockdown-section");
  if (lockdownSection && allHandled) {
    lockdownSection.classList.remove("hidden");
  }
}

function updateStartInterviewBtnState() {
  const startBtn = document.getElementById("minimize-btn") as HTMLButtonElement | null;
  if (!startBtn) return;

  if (!hadFlaggedProcesses) {
    startBtn.disabled = false;
    return;
  }

  // All rows must be handled
  const allRows = document.querySelectorAll<HTMLElement>(".process-row");
  const allHandled =
    allRows.length > 0 &&
    Array.from(allRows).every(
      (r) => r.classList.contains("closed") || r.classList.contains("process-suspended")
    );

  if (!allHandled) {
    startBtn.disabled = true;
    return;
  }

  // If any processes were suspended, lockdown must be verified
  const hasSuspended = document.querySelectorAll<HTMLElement>(".process-suspended").length > 0;
  if (hasSuspended && !lockdownVerified) {
    startBtn.disabled = true;
    return;
  }

  startBtn.disabled = false;
}

function initLockdownSection() {
  const activateBtn = document.getElementById("activate-lockdown-btn") as HTMLButtonElement | null;
  if (!activateBtn) return;

  activateBtn.addEventListener("click", async () => {
    activateBtn.disabled = true;
    const statusEl = document.getElementById("lockdown-status")!;
    statusEl.classList.remove("hidden");
    statusEl.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:1.5px;"></span> Activating DNS sinkhole...`;

    // Collect suspended PIDs from UI
    const suspendedRows = document.querySelectorAll<HTMLElement>(".process-suspended");
    const pids: number[] = [];
    const seenPids = new Set<number>();
    for (const row of suspendedRows) {
      const p = Number(row.dataset.pid);
      if (!seenPids.has(p)) {
        seenPids.add(p);
        pids.push(p);
      }
    }

    try {
      await invoke("start_lockdown", { aiPids: pids });
      lockdownActive = true;
      statusEl.innerHTML = `<span class="lockdown-check">&#10003;</span> DNS sinkhole active — verifying...`;

      // Verify
      interface DomainCheck { domain: string; resolved_to: string; blocked: boolean; }
      interface LockdownVerification {
        dns_active: boolean;
        processes_suspended: boolean;
        verified_domains: DomainCheck[];
      }
      const verification = await invoke<LockdownVerification>("verify_lockdown");
      const allBlocked = verification.verified_domains.every((d) => d.blocked);

      if (allBlocked) {
        lockdownVerified = true;
        statusEl.innerHTML = `<span class="lockdown-check">&#10003;</span> Network lock verified — AI APIs are blocked`;
        statusEl.classList.add("lockdown-status-success");
      } else {
        statusEl.innerHTML = `<span class="lockdown-warn">&#9888;</span> Verification incomplete — some domains may not be blocked`;
        statusEl.classList.add("lockdown-status-warn");
      }

      updateStartInterviewBtnState();
    } catch (err) {
      statusEl.innerHTML = `<span class="lockdown-error">&#10007;</span> Failed to activate: ${typeof err === "string" ? escapeHtml(err) : "Unknown error"}`;
      statusEl.classList.add("lockdown-status-error");
      activateBtn.disabled = false;
    }
  });
}

async function runPreflight() {
  // Reset state on re-run
  hadFlaggedProcesses = false;
  lockdownVerified = false;
  lockdownActive = false;
  stopRespawnWatcher();

  // Hide results and actions from previous run
  document.getElementById("preflight-result")!.classList.add("hidden");
  document.getElementById("result-pass")!.classList.add("hidden");
  document.getElementById("result-warn")!.classList.add("hidden");
  document.getElementById("preflight-actions")!.classList.add("hidden");
  document.getElementById("minimize-btn")!.classList.add("hidden");

  // Hide lockdown section on re-run
  const lockdownSection = document.getElementById("lockdown-section");
  if (lockdownSection) {
    lockdownSection.classList.add("hidden");
    const statusEl = document.getElementById("lockdown-status");
    if (statusEl) {
      statusEl.classList.add("hidden");
      statusEl.innerHTML = "";
      statusEl.className = "lockdown-status hidden";
    }
    const activateBtn = document.getElementById("activate-lockdown-btn") as HTMLButtonElement | null;
    if (activateBtn) activateBtn.disabled = false;
  }

  // Reset all to idle
  buildChecklist(CHECK_NAMES);

  // Run each check with a small stagger for visual effect
  let allPassed = true;

  try {
    const checks: PreflightCheck[] = await invoke("run_preflight");

    for (let i = 0; i < checks.length; i++) {
      const check = checks[i];

      setCheckState(check.name, "pending");
      await delay(400 + i * 100);

      // Auto-handle AI processes: suspend + activate DNS sinkhole inline
      if (check.name === "Scanning processes" && !check.passed && check.flagged_processes?.length) {
        const procs = check.flagged_processes;
        const names = [...new Set(procs.map((p) => p.parent_name ?? p.name))];
        // Suspend the AI process itself (proc.pid), not the parent shell
        const pids = [...new Set(procs.map((p) => p.pid))];

        setCheckState(check.name, "pending", `Suspending ${names.join(", ")}...`);
        await delay(300);

        try {
          await invoke("suspend_processes", { pids });
          names.forEach((n) => killedProcessNames.add(n));
          startRespawnWatcher();

          setCheckState(check.name, "pending", "Activating network lock...");
          await delay(300);

          try {
            await invoke("start_lockdown", { aiPids: pids });
            lockdownActive = true;
            lockdownVerified = true;
          } catch (_dnsErr) {
            // DNS sinkhole optional — suspension alone is a win
          }

          const lockNote = lockdownActive ? " & network locked" : " (network lock unavailable)";
          setCheckState(check.name, "pass", `${names.join(", ")} suspended${lockNote}`);
          // Auto-handled — don't gate Start Interview
        } catch (_err) {
          // Suspension failed — fall back to manual UI
          setCheckState(check.name, "fail", check.details);
          hadFlaggedProcesses = true;
          renderProcessList(check.name, procs);
          allPassed = false;
        }
        continue;
      }

      setCheckState(check.name, check.passed ? "pass" : "fail", check.details);
      if (!check.passed) allPassed = false;
    }
  } catch (err) {
    console.error("Preflight error:", err);
    // Mark remaining as failed
    for (const name of CHECK_NAMES) {
      setCheckState(name, "fail", "Check failed");
    }
    allPassed = false;
  }

  // Show result banner
  const resultEl = document.getElementById("preflight-result")!;
  resultEl.classList.remove("hidden");

  const startBtn = document.getElementById("minimize-btn") as HTMLButtonElement;

  if (allPassed) {
    document.getElementById("result-pass")!.classList.remove("hidden");
    startBtn.classList.remove("hidden");
    startBtn.disabled = false;
  } else if (hadFlaggedProcesses) {
    // Manual intervention still needed (auto-suspend failed)
    document.getElementById("result-warn")!.classList.remove("hidden");
    startBtn.classList.remove("hidden");
    startBtn.disabled = true;
  } else {
    // Other non-blocking warnings (e.g. multiple displays)
    document.getElementById("result-warn")!.classList.remove("hidden");
    startBtn.classList.remove("hidden");
    startBtn.disabled = false;
  }

  document.getElementById("preflight-actions")!.classList.remove("hidden");
}

function initPreflightScreen() {
  document.getElementById("minimize-btn")!.addEventListener("click", startMonitoring);
  document.getElementById("rerun-btn")!.addEventListener("click", runPreflight);
  initLockdownSection();
}

async function startMonitoring() {
  if (!currentSession) return;
  try {
    await invoke("start_monitoring", { sessionId: currentSession.id });
    sessionStartTime = Date.now();
    showReadyScreen();
    startSessionTimer();
  } catch (err) {
    console.error("start_monitoring error:", err);
  }
}

// ---- Screen 3: Ready (Session Overlay) ----

function showReadyScreen() {
  showScreen("screen-ready");

  // Populate overlay with initial state
  const lockdownIndicator = document.getElementById("lockdown-indicator");
  if (lockdownIndicator) {
    lockdownIndicator.classList.toggle("hidden", !lockdownActive);
  }

  // Clear event log
  const logEntries = document.getElementById("event-log-entries");
  if (logEntries) logEntries.innerHTML = "";
}

function startSessionTimer() {
  if (timerInterval) clearInterval(timerInterval);

  const timerEl = document.getElementById("session-timer");
  if (!timerEl) return;

  timerInterval = setInterval(() => {
    if (!sessionStartTime) return;
    const elapsedMs = Date.now() - sessionStartTime;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    timerEl.textContent = [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].join(":");
  }, 1000);
}

function addEventLogEntry(severity: string, message: string, timestamp: string) {
  const logEntries = document.getElementById("event-log-entries");
  if (!logEntries) return;

  const entry = document.createElement("div");
  entry.className = `event-entry event-entry-${severity}`;

  const time = new Date(timestamp);
  const timeStr = time.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  entry.innerHTML = `
    <span class="event-time">${escapeHtml(timeStr)}</span>
    <span class="event-message">${escapeHtml(message)}</span>
  `;

  logEntries.prepend(entry);

  // Keep max 5 entries
  const allEntries = logEntries.querySelectorAll(".event-entry");
  if (allEntries.length > 5) {
    allEntries[allEntries.length - 1].remove();
  }
}

function initReadyScreen() {
  const endBtn = document.getElementById("end-interview-btn");
  if (endBtn) {
    endBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("End the interview session?");
      if (!confirmed) return;

      try {
        await invoke("stop_monitoring");
        if (lockdownActive) {
          await invoke("stop_lockdown");
          lockdownActive = false;
        }
      } catch (err) {
        console.error("Error ending interview:", err);
      }

      stopRespawnWatcher();
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      // Show ended state
      showInterviewEndedScreen();
    });
  }
}

function showInterviewEndedScreen() {
  const readyScreen = document.getElementById("screen-ready");
  if (!readyScreen) return;

  let elapsedStr = "00:00:00";
  if (sessionStartTime) {
    const totalSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    elapsedStr = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  readyScreen.innerHTML = `
    <div class="interview-ended">
      <div class="ended-icon">&#10003;</div>
      <h2 class="ended-title">Interview Ended</h2>
      <p class="ended-detail">Session duration: ${elapsedStr}</p>
      <button id="back-to-welcome-btn" class="btn btn-primary" style="max-width:200px;margin-top:16px;">
        Close
      </button>
    </div>
  `;

  document.getElementById("back-to-welcome-btn")?.addEventListener("click", async () => {
    currentSession = null;
    sessionStartTime = null;
    showScreen("screen-welcome");
    (document.getElementById("code-input") as HTMLInputElement).value = "";
  });
}

// ---- WS Status Events (from Rust backend) ----

function showNotification(message: string, durationMs = 5000) {
  let notif = document.getElementById("ready-notification");
  if (!notif) {
    notif = document.createElement("div");
    notif.id = "ready-notification";
    notif.style.cssText = [
      "position:fixed",
      "bottom:16px",
      "left:50%",
      "transform:translateX(-50%)",
      "background:rgba(30,40,60,0.95)",
      "border:1px solid rgba(255,255,255,0.1)",
      "color:#c9d1e8",
      "font-size:12px",
      "padding:8px 14px",
      "border-radius:8px",
      "pointer-events:none",
      "z-index:999",
      "opacity:0",
      "transition:opacity 0.2s",
    ].join(";");
    document.body.appendChild(notif);
  }
  notif.textContent = message;
  notif.style.opacity = "1";
  setTimeout(() => {
    if (notif) notif.style.opacity = "0";
  }, durationMs);
}

async function setupEvents() {
  await listen<{ connected: boolean }>("ws_status", (event) => {
    const { connected } = event.payload;

    // Update ready screen indicators if visible
    const dot = document.getElementById("ready-dot");
    const text = document.getElementById("ready-status-text");
    if (dot && text) {
      dot.className = "dot " + (connected ? "dot-green" : "dot-yellow");
      text.textContent = connected ? "Monitoring active" : "Reconnecting...";
    }

    // Update session overlay status badge
    const statusBadge = document.getElementById("session-status-badge");
    if (statusBadge) {
      if (connected) {
        statusBadge.className = "session-status-badge active";
        statusBadge.innerHTML = `<span class="status-dot-active"></span> Session Active`;
      } else {
        statusBadge.className = "session-status-badge reconnecting";
        statusBadge.innerHTML = `<span class="status-dot-reconnecting"></span> Reconnecting...`;
      }
    }
  });

  await listen("session_ended", () => {
    // Session ended by server — show welcome and reset
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    currentSession = null;
    sessionStartTime = null;
    showScreen("screen-welcome");
    (document.getElementById("code-input") as HTMLInputElement).value = "";
  });

  await listen("interviewer_disconnected", () => {
    showNotification("Interviewer has disconnected");
    // Do NOT stop monitoring — interview may still be in progress
  });

  await listen<{ eventCount: number }>("heartbeat_sent", (event) => {
    const syncEl = document.getElementById("ready-event-sync");
    if (!syncEl) return;
    const count = event.payload.eventCount;
    if (count > 0) {
      syncEl.textContent = `${count} event${count === 1 ? "" : "s"} synced`;
      syncEl.style.opacity = "1";
      setTimeout(() => { syncEl.style.opacity = "0"; }, 2000);
    }
  });

  await listen("rerun_preflight", () => {
    if (currentSession) {
      showScreen("screen-preflight");
      runPreflight();
    }
  });

  await listen("interview_ended_by_tray", () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    lockdownActive = false;
    showInterviewEndedScreen();
  });

  // Listen for server-pushed messages forwarded via Rust event bus (if implemented)
  await listen<{ type: string; severity?: string; message?: string; timestamp?: string; connected?: boolean }>(
    "server_message",
    (event) => {
      const msg = event.payload;
      if (msg.type === "session_alert" && msg.severity && msg.message && msg.timestamp) {
        addEventLogEntry(msg.severity, msg.message, msg.timestamp);
      }
    }
  );
}

// ---- Utilities ----

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---- Boot ----

window.addEventListener("DOMContentLoaded", async () => {
  initWelcomeScreen();
  initPreflightScreen();
  initReadyScreen();
  await setupEvents();
});
