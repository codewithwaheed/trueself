---
name: Project Lockdown Feature
description: Multi-phase lockdown/monitoring feature — which phases are done and key architectural decisions
type: project
---

Phases 1 & 2 (Rust lockdown modules) were already done. Phases 3-6 implemented in a single session.

**What is done:**
- Phase 1-2: Rust lockdown modules in `apps/agent/src-tauri/src/lockdown/` (suspend, dns_sinkhole, privilege, mod)
- Phase 3: Shared types — LockdownStatus, SessionOverlayData, TrustUpdate, AgentStatusUpdate, WSMessageToDashboard added to `packages/shared-types/src/index.ts`; AgentHeartbeat extended with lockdownActive/sessionElapsedSeconds; WSMessageFromAgent and WSMessageToAgent extended with lockdown/session_start/session_alert types
- Phase 4: Agent frontend (`apps/agent/src/main.ts`, `index.html`, `src/styles.css`) — Suspend button per process row, Network Lockdown section with DNS activation + verification, gated Start Interview button, full session overlay (timer, event log, lockdown indicator, End Interview)
- Phase 5: Server watchdog (`apps/server/src/ws/watchdog.ts`) and trust engine (`apps/server/src/ws/trust-engine.ts`); `apps/server/src/index.ts` updated to use both
- Phase 6: Dashboard live session page at `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/live/page.tsx`; sessions list updated with View Live link

**Key architectural decisions:**
- Watchdog uses 10s gap to mark disconnect, 30s gap to persist TrustEvent; `agentEverConnected` Set in server tracks reconnects vs first connects
- Trust score weights: aiProcess=-40, overlay=-30, clipboard=-20, disconnect=-25, screens=-15
- Live page WS URL: `ws://localhost:3001?sessionId=<id>&role=dashboard`; uses exponential backoff up to 30s
- Session overlay replaces the old minimal ready screen (Screen 3) entirely; "Minimize to Tray" is now "Start Interview"
- Suspend button calls `invoke('suspend_processes', { pids: [pid] })` and marks rows `.process-suspended`; lockdown section appears only after all rows are handled
- Start Interview button is gated: if flagged procs exist, all must be closed/suspended AND if any are suspended, lockdown must be verified

**Why:** Lockdown is a core anti-cheating feature. The DNS sinkhole blocks cloud AI APIs at the network layer while SIGSTOP freezes local processes.

**How to apply:** When touching any of these files, check the gate logic in `updateStartInterviewBtnState()` in main.ts — it has multiple conditions that must all be preserved.
