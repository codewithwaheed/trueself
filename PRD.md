# TrueSelf — Product Requirements Document

## Vision

TrueSelf is an anti-AI cheating agent that ensures interview integrity for remote hiring. It runs alongside existing meeting platforms (Zoom, Google Meet, Teams) as a lightweight desktop agent on the candidate's machine, streaming real-time trust signals to an interviewer dashboard.

## Problem

Remote interviews are increasingly compromised by AI cheating tools. Candidates use ChatGPT, Claude, AI overlay tools (like Interview Coder), hidden second screens, and other tricks to fake competence. Companies hire unqualified people, waste onboarding time, and lose money. Existing proctoring tools are built for exams, not live interviews, and none detect modern AI overlays.

## Target Users

- **Primary buyer:** HR/hiring managers at tech-focused SMBs and mid-size companies (50-500 employees) doing remote technical interviews
- **Secondary user:** Interviewers (engineers, managers) who conduct the interviews
- **End user (monitored):** Candidates applying for roles

## Core Value Proposition

"Know your candidate is real." TrueSelf is the only tool that detects AI overlay cheating tools, monitors for hidden screens, and flags AI API usage — all while the candidate uses their normal Zoom/Meet/Teams call.

---

## Product Components

### 1. TrueSelf Agent (Tauri Desktop App)
- Installed by the candidate before the interview
- Runs silently in system tray during the interview
- Monitors: processes, screens, windows, network, clipboard
- Sends real-time data to TrueSelf server via WebSocket
- ~10MB download, cross-platform (Windows, macOS, Linux)

### 2. TrueSelf Web Dashboard (Next.js)
- Used by admins and interviewers
- Admin: company setup, interviewer management, session creation
- Interviewer: live trust score panel (opened alongside Zoom), post-interview reports
- Candidate: enters session code, sees preflight status

### 3. TrueSelf Backend Server (Hono + PostgreSQL)
- REST API for CRUD operations
- WebSocket server bridging agent data to dashboard
- Trust score computation engine
- Session management and event persistence

---

## User Roles & Permissions

| Role | Can Do |
|------|--------|
| Admin | Create company workspace, invite interviewers, view all sessions, manage settings, view reports |
| Interviewer | Create sessions, view live trust panel, view own session reports |
| Candidate | Download agent, enter session code, run preflight check (no dashboard access) |

---

## Feature Specifications

### F1: Company Onboarding (Admin)
**Priority:** P0 (MVP)

- Admin signs up with email + password (or Google OAuth)
- Creates company workspace with name and slug
- Gets a unique company page: `app.trueself.io/{slug}`
- Invites interviewers via email
- Interviewer receives invite, creates account linked to company

**Acceptance Criteria:**
- Admin can create workspace in < 2 minutes
- Invited interviewer can join with one click from email
- Company slug is unique and URL-safe

### F2: Session Creation (Interviewer)
**Priority:** P0 (MVP)

- Interviewer clicks "New Session" on dashboard
- Fills in: candidate name, candidate email, scheduled date/time, meeting link (Zoom/Meet/Teams URL)
- System generates a unique 6-digit session code
- System sends candidate an email with:
  - Session code
  - Download link for TrueSelf agent
  - Instructions: "Install and run TrueSelf before your interview"
  - Scheduled time reminder

**Acceptance Criteria:**
- Session creation takes < 30 seconds
- Session code is unique and easy to type (no ambiguous characters)
- Candidate email is sent within 1 minute of session creation
- Email includes platform-specific download link (Windows/macOS/Linux)

### F3: Agent Installation & Preflight (Candidate)
**Priority:** P0 (MVP)

**Installation Flow:**
1. Candidate clicks download link from email
2. Downloads platform-appropriate installer (~10MB)
3. Installs and opens TrueSelf Agent
4. Agent shows a clean, non-intimidating UI with session code input
5. Candidate enters 6-digit session code
6. Agent validates code against server (REST API call)
7. Agent runs preflight checks

**Preflight Checks:**
- Screen count detected and reported
- Running processes scanned for AI tools
- Network connectivity to TrueSelf server verified
- System permissions verified (accessibility permissions on macOS)

**Preflight Result Display:**
```
✓ Connection: Server connected
✓ Screens: 1 display detected (2560x1440)
✓ Processes: No AI tools detected
✓ Permissions: All granted

Ready for your interview! The agent will run in the background.
[Minimize to Tray]
```

If issues found:
```
✓ Connection: Server connected
⚠ Screens: 2 displays detected — please disconnect external monitor or notify your interviewer
✓ Processes: No AI tools detected
✗ Permissions: Screen recording permission needed — click to grant

[Re-run Checks]
```

**Acceptance Criteria:**
- Preflight completes in < 10 seconds
- Clear, non-technical language for all check results
- Candidate can re-run checks after fixing issues
- Agent minimizes to system tray with a small icon
- Agent does NOT require admin/root privileges to install

### F4: Real-Time Monitoring (Agent → Server → Dashboard)
**Priority:** P0 (MVP)

**Agent sends heartbeat every 3 seconds containing:**

1. **Screen Monitor**
   - Number of connected displays
   - Resolution and scale factor of each
   - Alerts if screen count changes during session

2. **Process Monitor**
   - Scans running processes against known AI tool list
   - Flagged tools: ChatGPT (desktop), Claude (desktop), GitHub Copilot, Cursor, Windsurf, Codeium, Tabnine, Interview Coder, and more
   - Also flags virtual camera software: OBS, Snap Camera, ManyCam
   - New process launches during session are flagged

3. **Window Overlay Monitor**
   - Enumerates all windows with their z-order
   - Detects transparent (alpha < 1.0) always-on-top windows
   - Flags windows that match overlay tool patterns
   - Reports window title + process name for each suspicious window

4. **Network Monitor**
   - Checks active TCP connections against flagged domains
   - Flagged: api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, copilot.github.com, api.groq.com, api.mistral.ai, api.together.xyz, api.cohere.ai
   - Reports destination + port + protocol

5. **Clipboard Monitor**
   - Detects paste events
   - Records: content length (in characters), source application, timestamp
   - NEVER records actual clipboard content (privacy)
   - Flags large pastes (>200 chars) from external applications

**Acceptance Criteria:**
- Heartbeat delivery latency < 500ms
- Agent CPU usage < 5% on modern hardware
- Agent memory usage < 100MB
- All monitoring works without admin/root privileges (where possible)
- Agent gracefully handles permission denials

### F5: Live Trust Score Dashboard (Interviewer)
**Priority:** P0 (MVP)

**Interviewer opens dashboard in a browser tab alongside their Zoom/Meet/Teams window.**

**Dashboard Layout:**
```
┌─────────────────────────────────────────┐
│ TrueSelf — Session #482910              │
│ Candidate: Sarah Ahmed                   │
│ Status: Active (32:14 elapsed)           │
├─────────────────────────────────────────┤
│                                         │
│  TRUST SCORE    ████████░░  82/100      │
│                                         │
├─────────────────────────────────────────┤
│ LIVE CHECKS                             │
│                                         │
│ ✓ Screens: 1 detected (2560x1440)      │
│ ✓ AI Tools: None running                │
│ ✓ Overlays: No suspicious windows       │
│ ✓ Network: No AI API connections        │
│ ⚠ Clipboard: Large paste at 14:32      │
│   (847 chars from "Code Editor")        │
│ ✓ Agent: Connected (last ping 1s ago)   │
│                                         │
├─────────────────────────────────────────┤
│ TIMELINE                                │
│                                         │
│ 14:32 ⚠ Large clipboard paste (847ch)  │
│ 14:15 ✓ Session started                 │
│ 14:14 ✓ Preflight passed                │
│ 14:12 ✓ Agent connected                 │
│                                         │
└─────────────────────────────────────────┘
```

**Trust Score Computation:**
- Starts at 100
- Deductions:
  - AI tool detected: -30 (critical)
  - AI overlay detected: -30 (critical)
  - AI API network connection: -25 (critical)
  - Second screen connected: -15 (warning)
  - Large clipboard paste: -5 per event (warning)
  - Agent disconnected: -20 (critical, while disconnected)
  - Suspicious window detected: -15 (warning)
- Score recovers partially when issues are resolved (e.g., AI tool closed)
- Minimum score: 0

**Acceptance Criteria:**
- Dashboard updates in real-time (< 1 second delay)
- Color-coded severity: green (OK), yellow (warning), red (critical)
- Timeline shows all events in reverse chronological order
- Dashboard works on any modern browser (no plugins needed)
- Sound/visual alert on critical events

### F6: Post-Interview Trust Report
**Priority:** P1 (post-MVP)

- Generated automatically when session ends
- Contains: overall score, breakdown by category, full event timeline, session duration, key moments
- Exportable as PDF
- Shareable via link with hiring team
- Stored in company dashboard for reference

**Acceptance Criteria:**
- Report available within 1 minute of session end
- Includes visual timeline chart
- Shareable link requires company authentication

### F7: Session Management
**Priority:** P0 (MVP)

- Interviewer can view all their sessions (upcoming, active, completed)
- Filter by status, date, candidate name
- Cancel upcoming sessions
- End active sessions manually
- View reports for completed sessions

**Acceptance Criteria:**
- Session list loads in < 2 seconds
- Real-time status updates for active sessions
- Clear visual distinction between session states

### F8: Agent Auto-Update
**Priority:** P2 (future)

- Agent checks for updates on launch
- Silent background update mechanism
- New AI tool signatures pushed without full app update
- Version compatibility check with server

### F9: Admin Analytics
**Priority:** P2 (future)

- Total sessions conducted
- Average trust scores
- Most common flags
- Interviewer activity

---

## Non-Functional Requirements

### Performance
- Agent heartbeat: every 3 seconds
- WebSocket latency: < 500ms end-to-end
- Dashboard render: < 100ms per update
- API response time: < 200ms for all endpoints
- Agent binary size: < 15MB
- Agent CPU: < 5% average
- Agent RAM: < 100MB

### Security
- All communication over TLS (HTTPS/WSS)
- Session codes expire after 24 hours
- Agent does not store any candidate data locally
- Clipboard content is NEVER captured — only metadata (length, source)
- Agent process list is hashed before storage (privacy)
- JWT-based authentication for dashboard
- Rate limiting on all API endpoints

### Privacy
- Agent only collects: process names, screen info, window metadata, network destinations, clipboard metadata
- Agent NEVER collects: screen content, keystrokes, file contents, clipboard text, webcam, audio
- All data encrypted in transit and at rest
- Data retention: 90 days default, configurable per company
- GDPR-compliant: candidate can request data deletion

### Compatibility
- Agent: Windows 10+, macOS 12+, Ubuntu 22.04+
- Dashboard: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
- Works alongside: Zoom, Google Meet, Microsoft Teams, Webex, any browser-based meeting tool

---

## Out of Scope (MVP)

- Webcam/gaze tracking (v2)
- Audio analysis (v2)
- Video recording (v2)
- Screen recording (v2)
- AI-powered behavioral analysis (v2)
- Mobile app (v2)
- SSO/SAML enterprise auth (v2)
- Custom branding per company (v2)
- API for third-party integrations (v2)
- Billing/subscription management (use Stripe, v1.1)

---

## Success Metrics

- **Activation:** 80% of invited candidates install and run agent successfully
- **Reliability:** Agent uptime > 99.5% during sessions
- **Detection:** Catch > 90% of known AI overlay tools
- **Latency:** < 1 second from agent event to dashboard display
- **NPS:** Interviewer NPS > 40 within first 3 months
