# TrueSelf — User Flows

## Flow 1: Admin Onboarding

```
[Admin visits trueself.io]
  → Clicks "Get Started"
  → Sign up form: name, email, password, company name
  → Email verification (magic link or code)
  → Redirected to dashboard
  → Company workspace created automatically
  → Onboarding wizard:
      1. "Invite your first interviewer" (email input)
      2. "Create your first session" (optional, can skip)
  → Lands on Admin Dashboard home
```

**Pages involved:**
- `/signup` — registration form
- `/verify` — email verification
- `/dashboard` — main dashboard (role-aware)
- `/dashboard/settings` — company settings
- `/dashboard/team` — interviewer management

---

## Flow 2: Interviewer Joins Company

```
[Interviewer receives email invite]
  → Clicks "Join {Company Name} on TrueSelf"
  → Lands on signup page with company pre-filled
  → Creates account: name, email, password
  → Redirected to interviewer dashboard
  → Sees empty session list with "Create Session" CTA
```

**Pages involved:**
- `/invite/{token}` — invite landing page
- `/signup?invite={token}` — pre-filled signup
- `/dashboard` — interviewer view (sessions list)

---

## Flow 3: Interviewer Creates Interview Session

```
[Interviewer on dashboard]
  → Clicks "New Session"
  → Modal/form appears:
      - Candidate name (text)
      - Candidate email (email)
      - Scheduled date & time (datetime picker)
      - Meeting link (URL — their Zoom/Meet/Teams link)
  → Clicks "Create Session"
  → System generates 6-digit session code
  → System sends candidate email automatically
  → Session appears in "Upcoming" tab with code displayed
  → Interviewer can copy session code or resend email
```

**API calls:**
- `POST /api/sessions` — create session
- `POST /api/sessions/{id}/resend-email` — resend candidate invite

**Pages involved:**
- `/dashboard` — session list
- `/dashboard/sessions/new` — create session (could be modal)

---

## Flow 4: Candidate Installs Agent & Runs Preflight

```
[Candidate receives email]
  → Email contains:
      - Session code: 482910
      - Interview date/time
      - Download link for their OS
      - Brief instructions
  → Candidate clicks download link
  → Downloads TrueSelf Agent installer
  → Installs agent (standard OS installer)
  → Opens TrueSelf Agent

[Agent opens — Welcome Screen]
  → Shows "Enter your session code"
  → Input field for 6-digit code
  → Candidate types: 482910
  → Clicks "Verify"

[Agent validates code]
  → API call: GET /api/sessions/code/482910
  → If valid: shows session details (interviewer name, company, scheduled time)
  → If invalid: "Code not found. Please check and try again."
  → If expired: "This session has expired. Contact your interviewer."

[Agent runs preflight]
  → Automatic after code verification
  → Shows checklist with live status:
      □ Connecting to server...  → ✓ Connected
      □ Checking displays...     → ✓ 1 display (2560x1440)
      □ Scanning processes...    → ✓ No AI tools detected
      □ Verifying permissions... → ✓ All permissions granted
  → All pass: "You're ready! Minimize this app and join your interview."
  → Issues found: shows warnings with fix instructions
  → "Minimize to Tray" button

[Agent running in background]
  → Small tray icon (green = connected, yellow = warning, red = error)
  → Right-click tray: "Status", "Re-run Checks", "Quit"
  → Clicking "Quit" during active session shows warning:
      "Your interviewer will be notified if you close TrueSelf.
       Are you sure?"
```

**Agent screens:**
1. Welcome / code entry
2. Code verification / session details
3. Preflight checklist
4. Ready state (minimize prompt)
5. Tray icon (running state)

---

## Flow 5: Interview In Progress

```
[Timeline — what happens in parallel]

CANDIDATE:
  → Opens Zoom/Meet/Teams as normal
  → Joins interview call
  → TrueSelf agent runs silently in system tray
  → Agent sends heartbeat every 3 seconds

INTERVIEWER:
  → Opens Zoom/Meet/Teams as normal
  → Opens TrueSelf dashboard in a browser tab
  → Navigates to the active session
  → Sees live trust score panel
  → Conducts interview normally, glancing at trust panel periodically

SYSTEM (backend):
  → Receives agent heartbeats via WebSocket
  → Computes trust score
  → Forwards data to interviewer dashboard via WebSocket
  → Persists critical events to database
  → If critical event: sends visual/audio alert to dashboard

[Scenario: Candidate opens ChatGPT]
  Agent: detects "chatgpt" in process list
  Agent → Server: alert { type: "ai_tool_detected", severity: "critical", message: "ChatGPT Desktop detected" }
  Server → Dashboard: forwards alert
  Dashboard: trust score drops, red banner appears, sound plays
  Interviewer: sees "⚠ CRITICAL: ChatGPT detected at 14:45"

[Scenario: Candidate connects second monitor]
  Agent: screen count changes from 1 to 2
  Agent → Server: alert { type: "screen_change", severity: "warning" }
  Dashboard: trust score drops, yellow banner appears
  Interviewer: sees "⚠ Second display connected at 15:02"

[Scenario: Candidate uses AI overlay]
  Agent: detects transparent always-on-top window from unknown process
  Agent → Server: alert { type: "overlay_detected", severity: "critical" }
  Dashboard: trust score drops, red banner
  Interviewer: sees "⚠ CRITICAL: Suspicious overlay detected at 15:10"

[Scenario: Agent disconnects]
  Server: no heartbeat for 10 seconds
  Server → Dashboard: { type: "agent_status", connected: false }
  Dashboard: shows "Agent disconnected" warning, trust score drops
  If reconnects within 30s: warning clears, partial score recovery
  If > 30s: stays flagged in report
```

---

## Flow 6: Interviewer Views Live Dashboard

```
[Interviewer during active session]
  → Dashboard URL: /dashboard/sessions/{id}/live
  → Page layout (designed to be narrow — sidebar alongside Zoom):

  TOP BAR:
    Candidate name | Session code | Duration timer | End Session button

  TRUST SCORE SECTION:
    Large circular or bar indicator: 82/100
    Color: green (80-100), yellow (50-79), red (0-49)

  LIVE CHECKS (always visible):
    Each check shows: icon + label + status + last update time
    ✓ Screens: 1 detected
    ✓ AI Tools: None
    ✓ Overlays: Clear
    ✓ Network: Clean
    ⚠ Clipboard: 1 flag
    ✓ Agent: Connected

  TIMELINE (scrollable):
    Reverse chronological list of all events
    Each event: timestamp + severity icon + message
    Critical events highlighted in red
    Can click event for details

  ACTIONS:
    "End Session" → confirms → generates report
    "Flag Moment" → interviewer manually marks a suspicious moment
```

---

## Flow 7: Post-Interview Report

```
[Session ends — either interviewer clicks "End" or scheduled end time]
  → Server marks session as completed
  → Server generates trust report
  → Agent receives session_end message
  → Agent shows: "Interview session ended. You can close TrueSelf. Thank you!"
  → Agent stops monitoring

[Interviewer views report]
  → Dashboard: /dashboard/sessions/{id}/report
  → Report contains:
      - Overall trust score with color indicator
      - Score breakdown by category (bar chart)
      - Session timeline (visual timeline with events plotted)
      - Key moments (critical events highlighted)
      - Session metadata (duration, candidate, interviewer)
  → "Share Report" button → generates shareable link (requires company auth)
  → "Export PDF" button (P1)

[Admin views all reports]
  → Dashboard: /dashboard/reports
  → Table of all completed sessions with scores
  → Filter by interviewer, date range, score range
  → Click to view individual reports
```

---

## Flow 8: Edge Cases & Error Handling

### Candidate Never Installs Agent
```
  → Interview happens on Zoom without TrueSelf
  → Interviewer sees "Agent not connected" on dashboard
  → Session report shows: "Agent was never connected. No trust data available."
  → Company can set policy: "Require agent before interview starts"
```

### Candidate Closes Agent Mid-Interview
```
  → Agent sends disconnect signal (if graceful close)
  → Or: server detects no heartbeat for 10 seconds
  → Dashboard: "Agent disconnected at {time}"
  → Trust score drops significantly
  → If candidate re-opens agent: reconnects to same session
  → Report flags the gap with duration
```

### Multiple Interviewers Viewing Same Session
```
  → Multiple dashboard tabs can connect to same session via WebSocket
  → All see the same live data
  → Useful for panel interviews
```

### Candidate Has Legitimate Second Screen
```
  → Preflight warns about multiple screens
  → Candidate can proceed (it's a warning, not a block)
  → Interviewer sees the warning and can decide if acceptable
  → Some companies may require single screen — configurable per company (P2)
```

### Internet Connectivity Issues
```
  → Agent buffers heartbeats locally if connection drops
  → On reconnect: sends buffered data with original timestamps
  → Dashboard shows gap period with "connectivity issue" label
  → Distinct from "agent closed" — no trust penalty for brief network issues
```

---

## Page Map (Web Dashboard)

```
PUBLIC:
  /                          → Landing page / marketing
  /signup                    → Registration
  /login                     → Login
  /invite/{token}            → Accept team invite
  /verify                    → Email verification

AUTHENTICATED (Admin + Interviewer):
  /dashboard                 → Home (upcoming sessions, recent activity)
  /dashboard/sessions        → All sessions list
  /dashboard/sessions/new    → Create new session
  /dashboard/sessions/{id}   → Session detail (upcoming: edit, active: redirect to live)
  /dashboard/sessions/{id}/live    → Live trust score panel
  /dashboard/sessions/{id}/report  → Post-interview report

ADMIN ONLY:
  /dashboard/team            → Manage interviewers
  /dashboard/team/invite     → Invite new interviewer
  /dashboard/settings        → Company settings
  /dashboard/reports         → All reports overview
```

---

## Agent Screen Map (Tauri Desktop)

```
1. WELCOME
   → Session code input
   → "Enter Code" button
   → "Need help?" link

2. VERIFICATION
   → Shows session details (company, interviewer, time)
   → "Start Preflight" button

3. PREFLIGHT
   → Checklist with live status updates
   → "Re-run" button if issues found
   → "Ready" state with "Minimize to Tray" button

4. TRAY (running state)
   → Green/yellow/red tray icon
   → Right-click menu: Status, Re-run Checks, Quit
   → Click: opens status window

5. STATUS WINDOW (from tray click)
   → Current session info
   → Connection status
   → Time elapsed
   → "I'm having issues" help link

6. SESSION ENDED
   → "Interview complete. Thank you!"
   → "Close TrueSelf" button
   → Optional: "Uninstall" link
```
