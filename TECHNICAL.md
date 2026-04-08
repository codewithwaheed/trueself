# TrueSelf — Technical Architecture & Implementation Guide

## System Architecture Overview

```
┌──────────────────┐     WebSocket (WSS)      ┌──────────────────┐
│  TrueSelf Agent  │ ──────────────────────→  │  TrueSelf Server │
│  (Tauri/Rust)    │  heartbeats, alerts       │  (Hono + Node)   │
│  Candidate's PC  │ ←──────────────────────  │                  │
│                  │  config, session cmds      │  REST API        │
└──────────────────┘                           │  WebSocket Hub   │
                                               │  Trust Engine    │
┌──────────────────┐     WebSocket (WSS)      │                  │
│  Web Dashboard   │ ←──────────────────────  │                  │──→ PostgreSQL
│  (Next.js)       │  live trust data          │                  │
│  Interviewer's   │ ──────────────────────→  │                  │
│  Browser         │  REST API calls           └──────────────────┘
└──────────────────┘
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Agent | Tauri 2 (Rust backend + Web frontend) | Small binary (~10MB), native OS access, cross-platform |
| Agent UI | HTML/CSS/TS (Tauri webview) | Simple UI, no React overhead needed for 5 screens |
| Web Dashboard | Next.js 14+ (App Router) | Fast SSR, good auth patterns, Vercel deploy |
| Backend Server | Hono (Node.js) | Lightweight, fast, supports WebSocket alongside REST |
| Database | PostgreSQL | Relational data fits well, Prisma ORM, free on Neon/Supabase |
| ORM | Prisma | Type-safe, shared between server and Next.js |
| Real-time | WebSocket (ws library) | Persistent bidirectional connection for agent ↔ server ↔ dashboard |
| Auth | NextAuth.js (Auth.js v5) | Session-based auth for dashboard, JWT for API |
| Email | Resend or AWS SES | Transactional emails for candidate invites |
| Deployment | Vercel (web), Railway/Fly.io (server), Neon (DB) | Simple, scalable, affordable for MVP |
| Monorepo | Turborepo + pnpm workspaces | Shared types and DB layer across all apps |

---

## Repository Structure

```
trueself/
├── apps/
│   ├── web/                      # Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/              # App router pages
│   │   │   │   ├── (auth)/       # Login, signup, verify
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   ├── signup/page.tsx
│   │   │   │   │   └── invite/[token]/page.tsx
│   │   │   │   ├── dashboard/    # Authenticated routes
│   │   │   │   │   ├── page.tsx                    # Home
│   │   │   │   │   ├── sessions/page.tsx           # Session list
│   │   │   │   │   ├── sessions/new/page.tsx       # Create session
│   │   │   │   │   ├── sessions/[id]/page.tsx      # Session detail
│   │   │   │   │   ├── sessions/[id]/live/page.tsx # Live trust panel
│   │   │   │   │   ├── sessions/[id]/report/page.tsx
│   │   │   │   │   ├── team/page.tsx               # Admin: manage team
│   │   │   │   │   ├── settings/page.tsx           # Admin: company settings
│   │   │   │   │   └── reports/page.tsx            # Admin: all reports
│   │   │   │   └── layout.tsx
│   │   │   ├── components/
│   │   │   │   ├── trust-score-panel.tsx    # Main live monitoring widget
│   │   │   │   ├── trust-timeline.tsx       # Event timeline
│   │   │   │   ├── session-card.tsx         # Session list item
│   │   │   │   ├── preflight-status.tsx     # Shows agent preflight results
│   │   │   │   └── score-gauge.tsx          # Circular/bar score indicator
│   │   │   ├── hooks/
│   │   │   │   ├── use-session-websocket.ts # WebSocket hook for live data
│   │   │   │   └── use-trust-score.ts       # Trust score computation (client-side)
│   │   │   └── lib/
│   │   │       ├── api.ts                   # API client (fetch wrapper)
│   │   │       ├── auth.ts                  # NextAuth config
│   │   │       └── websocket.ts             # WebSocket client utility
│   │   ├── next.config.js
│   │   └── package.json
│   │
│   ├── agent/                    # Tauri desktop agent
│   │   ├── src/                  # Frontend (webview)
│   │   │   ├── index.html
│   │   │   ├── styles.css
│   │   │   └── main.ts           # UI logic, Tauri command invocations
│   │   ├── src-tauri/            # Rust backend
│   │   │   ├── src/
│   │   │   │   ├── lib.rs        # Tauri commands, app setup
│   │   │   │   ├── main.rs       # Entry point
│   │   │   │   ├── monitors/
│   │   │   │   │   ├── mod.rs
│   │   │   │   │   ├── processes.rs   # Process scanning
│   │   │   │   │   ├── screens.rs     # Display detection
│   │   │   │   │   ├── windows.rs     # Window/overlay detection
│   │   │   │   │   ├── network.rs     # Network connection scanning
│   │   │   │   │   └── clipboard.rs   # Clipboard event monitoring
│   │   │   │   ├── websocket.rs  # WebSocket client to server
│   │   │   │   ├── heartbeat.rs  # Heartbeat loop (3s interval)
│   │   │   │   ├── preflight.rs  # Preflight check runner
│   │   │   │   └── config.rs     # Agent configuration
│   │   │   ├── Cargo.toml
│   │   │   └── tauri.conf.json
│   │   └── package.json
│   │
│   └── server/                   # Backend API
│       ├── src/
│       │   ├── index.ts          # Server entry, HTTP + WebSocket
│       │   ├── routes/
│       │   │   ├── auth.ts       # Login, signup, JWT
│       │   │   ├── sessions.ts   # CRUD for interview sessions
│       │   │   ├── companies.ts  # Company management
│       │   │   ├── users.ts      # User/interviewer management
│       │   │   └── reports.ts    # Trust report generation
│       │   ├── ws/
│       │   │   ├── handler.ts    # WebSocket connection handler
│       │   │   ├── session-hub.ts # Routes agent data to dashboards
│       │   │   └── trust-engine.ts # Computes trust score from heartbeats
│       │   ├── services/
│       │   │   ├── email.ts      # Send candidate invite emails
│       │   │   ├── session-code.ts # Generate unique session codes
│       │   │   └── report.ts     # Generate post-interview reports
│       │   └── middleware/
│       │       ├── auth.ts       # JWT verification
│       │       └── rate-limit.ts
│       └── package.json
│
├── packages/
│   ├── shared-types/             # TypeScript interfaces
│   │   └── src/index.ts          # All shared types
│   └── db/                       # Prisma + PostgreSQL
│       ├── prisma/
│       │   └── schema.prisma     # Database schema
│       └── src/index.ts          # Prisma client export
│
├── docs/                         # This documentation (for Claude Code)
│   ├── PRD.md
│   ├── USER-FLOWS.md
│   └── TECHNICAL.md
│
├── turbo.json
├── pnpm-workspace.yaml
├── docker-compose.yml            # Local PostgreSQL
└── .env.example
```

---

## Database Schema

Full schema is in `packages/db/prisma/schema.prisma`. Key relationships:

```
Company 1──n User (admin or interviewer)
Company 1──n InterviewSession
User 1──n InterviewSession (as interviewer)
InterviewSession 1──n TrustEvent
```

**Session lifecycle:**
```
PENDING → ACTIVE → COMPLETED
                 → CANCELLED
```

- PENDING: created by interviewer, waiting for agent connection
- ACTIVE: agent connected, monitoring in progress
- COMPLETED: session ended normally
- CANCELLED: interviewer cancelled before session started

---

## API Endpoints

### Authentication
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/signup` | Register new user + company | None |
| POST | `/api/auth/login` | Login, returns JWT | None |
| POST | `/api/auth/invite/accept` | Accept team invite | None (invite token) |
| GET | `/api/auth/me` | Get current user | JWT |

### Companies
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/companies/{id}` | Get company details | Admin |
| PATCH | `/api/companies/{id}` | Update company settings | Admin |
| POST | `/api/companies/{id}/invite` | Invite interviewer | Admin |

### Sessions
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/sessions` | Create session | Interviewer |
| GET | `/api/sessions` | List sessions (filtered by role) | Interviewer |
| GET | `/api/sessions/{id}` | Get session with events | Interviewer |
| GET | `/api/sessions/code/{code}` | Validate session code | None (agent) |
| PATCH | `/api/sessions/{id}` | Update session (cancel, end) | Interviewer |
| POST | `/api/sessions/{id}/resend-email` | Resend candidate email | Interviewer |

### Reports
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/sessions/{id}/report` | Get trust report | Interviewer |
| GET | `/api/reports` | List all reports (admin) | Admin |

---

## WebSocket Protocol

### Connection
```
Agent connects:    ws://server/ws?sessionId={id}&role=agent
Dashboard connects: ws://server/ws?sessionId={id}&role=dashboard
```

### Message Types: Agent → Server

```typescript
// Heartbeat (every 3 seconds)
{
  type: "heartbeat",
  data: {
    sessionId: "clx...",
    timestamp: 1709234567890,
    screens: [{ id: 0, width: 2560, height: 1440, isPrimary: true, scaleFactor: 2 }],
    processes: [{ pid: 1234, name: "code", isFlagged: false }],
    suspiciousWindows: [],
    networkFlags: [],
    clipboardEvents: [],
    trustScore: 95  // agent-side preliminary score
  }
}

// Alert (immediate, on detection)
{
  type: "alert",
  data: {
    timestamp: 1709234567890,
    type: "ai_tool_detected",
    severity: "critical",
    message: "ChatGPT Desktop detected (PID: 5678)"
  }
}

// Preflight result
{
  type: "preflight_result",
  data: {
    passed: true,
    checks: [
      { name: "screens", passed: true, details: "1 display detected" },
      { name: "processes", passed: true, details: "No AI tools found" },
      { name: "connectivity", passed: true, details: "Server connected" },
      { name: "permissions", passed: true, details: "All granted" }
    ]
  }
}
```

### Message Types: Server → Agent

```typescript
// Session start acknowledgment
{ type: "session_start", sessionId: "clx..." }

// Session end
{ type: "session_end" }

// Config update (push new flagged process list)
{
  type: "config_update",
  config: {
    heartbeatIntervalMs: 3000,
    flaggedProcesses: ["chatgpt", "claude", ...],
    flaggedDomains: ["api.openai.com", ...],
    monitorClipboard: true,
    monitorNetwork: true
  }
}
```

### Message Types: Server → Dashboard

Server forwards all agent messages to connected dashboards, plus:

```typescript
// Agent connection status
{ type: "agent_status", connected: true }

// Computed trust score (server-side, authoritative)
{
  type: "trust_update",
  score: 82,
  breakdown: {
    screenCount: { score: 100, details: "1 screen" },
    aiTools: { score: 100, details: "None detected" },
    overlays: { score: 100, details: "Clear" },
    network: { score: 100, details: "Clean" },
    clipboard: { score: 95, details: "1 paste event (small)" }
  }
}
```

---

## Trust Score Engine

Located in `apps/server/src/ws/trust-engine.ts`.

### Scoring Algorithm

```typescript
const BASE_SCORE = 100;

const DEDUCTIONS = {
  ai_tool_detected:    -30,  // per tool
  overlay_detected:    -30,  // per overlay
  ai_network_flag:     -25,  // per unique domain
  second_screen:       -15,  // once
  additional_screen:   -10,  // per screen beyond 2
  large_clipboard:     -5,   // per event (>200 chars)
  agent_disconnected:  -20,  // while disconnected
  suspicious_window:   -15,  // per window
};

// Score = max(0, BASE_SCORE + sum(deductions))
// Some deductions recover when issue resolves:
//   - agent_disconnected: recovers on reconnect
//   - second_screen: recovers if disconnected
//   - ai_tool_detected: partially recovers if closed (+15 of -30)
// Some deductions are permanent for the session:
//   - clipboard events
//   - network flags (connection was made, even if stopped)
```

### State Management

The trust engine maintains per-session state:

```typescript
interface SessionTrustState {
  sessionId: string;
  currentScore: number;
  activeFlags: Map<string, TrustFlag>;   // currently active issues
  resolvedFlags: TrustFlag[];             // past issues (permanent record)
  eventLog: TrustEvent[];                 // full timeline
  lastHeartbeat: number;                  // timestamp
  heartbeatsMissed: number;               // for disconnect detection
}
```

---

## Agent Implementation Details

### Rust Crate Dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sysinfo = "0.32"                    # Process enumeration
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.24"          # WebSocket client
futures-util = "0.3"
chrono = "0.4"
url = "2"

# Platform-specific
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
  "Win32_UI_WindowsAndMessaging",    # EnumWindows, GetWindowLong
  "Win32_Graphics_Gdi",              # EnumDisplayDevices
  "Win32_NetworkManagement_IpHelper", # GetExtendedTcpTable
  "Win32_System_Threading",           # Process info
] }

[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.24"              # CGWindowListCopyWindowInfo
core-foundation = "0.10"
```

### Monitor Implementation Priority

For MVP, implement in this order:

1. **Process Monitor** (easiest, highest value) — `sysinfo` crate works cross-platform out of the box
2. **Screen Monitor** (easy) — Tauri's built-in `available_monitors()` API
3. **Network Monitor** (medium) — platform-specific APIs needed
4. **Window/Overlay Monitor** (hard) — platform-specific, most complex
5. **Clipboard Monitor** (medium) — `arboard` crate or platform APIs

### Heartbeat Loop

```rust
// Pseudocode for the main monitoring loop
async fn heartbeat_loop(app: AppHandle, ws: WebSocketStream) {
    let mut interval = tokio::time::interval(Duration::from_secs(3));

    loop {
        interval.tick().await;

        let heartbeat = AgentHeartbeat {
            session_id: current_session_id.clone(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            screens: monitors::screens::get_screens(&app),
            processes: monitors::processes::scan_processes(),
            suspicious_windows: monitors::windows::scan_windows(),
            network_flags: monitors::network::scan_connections(),
            clipboard_events: monitors::clipboard::get_recent_events(),
            trust_score: 0, // server computes authoritative score
        };

        let msg = serde_json::to_string(&WSMessage::Heartbeat(heartbeat)).unwrap();
        ws.send(Message::Text(msg)).await.ok();
    }
}
```

### Known AI Tool Process Names

Maintained in `src-tauri/src/monitors/processes.rs` and updatable via server config push:

```
chatgpt, claude, copilot, cursor, windsurf, codeium, tabnine,
interview-coder, interviewcoder, cody, continue,
obs, obs64, obs32, snap camera, snapcamera, manycam, mmhmm,
virtual camera, vcam, xsplit
```

### Known AI API Domains

Maintained in `src-tauri/src/monitors/network.rs`:

```
api.openai.com, cdn.openai.com,
api.anthropic.com, claude.ai,
generativelanguage.googleapis.com, gemini.google.com,
copilot.github.com, api.githubcopilot.com,
api.groq.com, api.together.xyz, api.mistral.ai,
api.cohere.ai, api.perplexity.ai, api.deepseek.com
```

---

## Authentication Flow

### Dashboard Auth (NextAuth.js)

```
Email/Password signup → bcrypt hash → store in User table
Login → verify password → issue JWT (stored in httpOnly cookie)
JWT payload: { userId, companyId, role }
API requests include JWT in Authorization header
```

### Agent Auth (Session Code)

```
Agent has no user account — authenticates via session code only:
1. Candidate enters 6-digit code
2. Agent calls GET /api/sessions/code/{code}
3. Server returns session details if valid
4. Agent opens WebSocket with sessionId as query param
5. Server validates sessionId exists and status is PENDING or ACTIVE
6. Connection established
```

No JWT needed for agent — the session code IS the auth. Session codes are single-use (one agent connection per code) and expire 24 hours after creation.

---

## Deployment Architecture (MVP)

```
Vercel (free tier)          → Next.js dashboard
Railway or Fly.io ($5/mo)   → Hono server (HTTP + WebSocket)
Neon (free tier)            → PostgreSQL database
Resend (free tier)          → Transactional emails
GitHub Releases             → Agent binaries (Windows/macOS/Linux)
```

**Total MVP hosting cost: ~$5/month**

### Agent Distribution

- Build Tauri for all platforms via GitHub Actions CI
- Upload binaries to GitHub Releases (or S3)
- Candidate download link points to latest release for their platform
- Auto-detect OS from User-Agent on download page

---

## Development Workflow

### Running locally

```bash
# Terminal 1: Start PostgreSQL
docker compose up -d

# Terminal 2: Start backend server
pnpm dev:server

# Terminal 3: Start web dashboard
pnpm dev:web

# Terminal 4: Start Tauri agent (in dev mode)
cd apps/agent && pnpm tauri dev
```

### Using Claude Code

Open Claude Code in the `trueself/` root directory. It will have full context of:
- All three apps
- Shared types (reference with @packages/shared-types/src/index.ts)
- Database schema (reference with @packages/db/prisma/schema.prisma)
- This documentation (reference with @docs/PRD.md, @docs/USER-FLOWS.md, @docs/TECHNICAL.md)

Recommended Claude Code workflow:
```
@docs/PRD.md @docs/TECHNICAL.md
Build the session creation API endpoint as described in the PRD (feature F2).
Use the shared types from @packages/shared-types/src/index.ts
and the Prisma schema from @packages/db/prisma/schema.prisma
```

---

## Implementation Order (MVP Sprint Plan)

### Sprint 1 (Week 1-2): Foundation
- [ ] Set up auth (NextAuth.js) with email/password
- [ ] Company creation + interviewer invite flow
- [ ] Session CRUD API endpoints
- [ ] Basic dashboard layout (sidebar + pages)
- [ ] Session list page

### Sprint 2 (Week 3-4): Agent Core
- [ ] Tauri agent UI (code entry → preflight → tray)
- [ ] Process monitor (Rust, sysinfo)
- [ ] Screen monitor (Rust, Tauri API)
- [ ] WebSocket client in agent
- [ ] Agent ↔ server WebSocket connection

### Sprint 3 (Week 5-6): Live Dashboard
- [ ] WebSocket hub on server (agent → dashboard routing)
- [ ] Trust score engine
- [ ] Live trust score panel component
- [ ] Event timeline component
- [ ] Real-time dashboard updates

### Sprint 4 (Week 7-8): Polish & Ship
- [ ] Window/overlay detection (platform-specific)
- [ ] Network monitoring
- [ ] Clipboard monitoring
- [ ] Candidate invite emails
- [ ] Post-interview report page
- [ ] Agent binary builds (CI/CD)
- [ ] Deploy to production
- [ ] Test end-to-end with real Zoom call
