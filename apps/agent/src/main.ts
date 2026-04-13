import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { AgentSessionInfo } from "@trueself/shared-types";

// ---- State ----

interface PreflightCheck {
  name: string;
  passed: boolean;
  details: string;
}

let currentSession: AgentSessionInfo | null = null;

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

async function runPreflight() {
  // Hide results and actions from previous run
  document.getElementById("preflight-result")!.classList.add("hidden");
  document.getElementById("result-pass")!.classList.add("hidden");
  document.getElementById("result-warn")!.classList.add("hidden");
  document.getElementById("preflight-actions")!.classList.add("hidden");
  document.getElementById("minimize-btn")!.classList.add("hidden");

  // Reset all to idle
  buildChecklist(CHECK_NAMES);

  // Run each check with a small stagger for visual effect
  let allPassed = true;

  try {
    const checks: PreflightCheck[] = await invoke("run_preflight");

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

  if (allPassed) {
    document.getElementById("result-pass")!.classList.remove("hidden");
    document.getElementById("minimize-btn")!.classList.remove("hidden");
  } else {
    document.getElementById("result-warn")!.classList.remove("hidden");
  }

  document.getElementById("preflight-actions")!.classList.remove("hidden");
}

function initPreflightScreen() {
  document.getElementById("minimize-btn")!.addEventListener("click", startMonitoring);
  document.getElementById("rerun-btn")!.addEventListener("click", runPreflight);
}

async function startMonitoring() {
  if (!currentSession) return;
  try {
    await invoke("start_monitoring", { sessionId: currentSession.id });
    showReadyScreen();
    await minimizeToTray();
  } catch (err) {
    console.error("start_monitoring error:", err);
  }
}

// ---- Screen 3: Ready ----

function showReadyScreen() {
  showScreen("screen-ready");
}

function initReadyScreen() {
  document.getElementById("back-to-tray-btn")!.addEventListener("click", minimizeToTray);
}

async function minimizeToTray() {
  const win = getCurrentWindow();
  await win.hide();
}

// ---- WS Status Events (from Rust backend) ----

async function setupEvents() {
  await listen<{ connected: boolean }>("ws_status", (event) => {
    const { connected } = event.payload;
    const dot = document.getElementById("ready-dot");
    const text = document.getElementById("ready-status-text");
    if (!dot || !text) return;

    dot.className = "dot " + (connected ? "dot-green" : "dot-yellow");
    text.textContent = connected ? "Monitoring active" : "Reconnecting...";
  });

  await listen("session_ended", () => {
    // Session ended by server — show welcome and reset
    currentSession = null;
    showScreen("screen-welcome");
    (document.getElementById("code-input") as HTMLInputElement).value = "";
  });

  await listen("rerun_preflight", () => {
    if (currentSession) {
      showScreen("screen-preflight");
      runPreflight();
    }
  });
}

// ---- Utilities ----

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
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
