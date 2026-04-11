# Session Creation Flow — Design Spec

**Date:** 2026-04-11
**Status:** Approved
**Scope:** Full-stack — server routes, email, shared types, web UI

---

## Overview

Interviewers can create interview monitoring sessions and invite candidates in two ways:
1. **Copy invite** — a pre-formatted plain-text email block the interviewer pastes into their existing calendar/Zoom/Teams invite flow (zero added friction to their current process).
2. **Direct email** — TrueSelf sends a formatted HTML email to the candidate via Resend.

Both modes deliver the same information: session code, meeting link, agent download instructions.

---

## Architecture

### Layers affected

| Layer | Change |
|---|---|
| `packages/shared-types` | Add `CreateSessionRequest`, `CreateSessionResponse`, `SessionListItem` |
| `apps/server/src/routes/sessions.ts` | New router: create, list, resend-email |
| `apps/server/src/lib/email.ts` | Resend wrapper + HTML template |
| `apps/server/src/index.ts` | Mount sessions router; keep unauthenticated `GET /api/sessions/code/:code` stub |
| `apps/web/src/actions/sessions.ts` | Server actions: createSession, getSessions, resendInvite |
| `apps/web/src/components/new-session-modal.tsx` | Two-step modal: form → success |
| `apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx` | Wire modal, add session list with tabs |

### Data flow

```
[Interviewer fills form]
  → createSession server action
  → POST /api/sessions (auth via apiToken header)
  → Zod validate → generate unique 6-digit code → DB write
  → if sendEmail=true → Resend.send(candidateInviteEmail)
  → return CreateSessionResponse { session, sessionCode }
  → modal transitions to success step
  → interviewer copies text OR sends email from success step
  → Done button → modal closes → sessions list refreshes
```

---

## Server

### New router: `apps/server/src/routes/sessions.ts`

All three routes require `requireAuth` middleware (JWT Bearer token).

**`POST /api/sessions`**

Zod schema:
```ts
{
  candidateName: z.string().min(1),
  candidateEmail: z.string().email(),
  meetingLink: z.string().url(),
  scheduledAt: z.string().datetime(),
  sendEmail: z.boolean().optional().default(false),
}
```

Logic:
- Generate 6-digit code with uniqueness retry (up to 5 attempts, check DB each time)
- Write `InterviewSession` to DB with `interviewerId` and `companyId` from JWT
- If `sendEmail=true`, call `sendCandidateInvite()`
- Return full session object

**`GET /api/sessions`**

- INTERVIEWER role: filter by `interviewerId`
- ADMIN role: filter by `companyId` (all company sessions)
- Order by `scheduledAt` desc
- Returns `SessionListItem[]`

**`POST /api/sessions/:id/resend-email`**

- Verify session belongs to caller's company (security check)
- Call `sendCandidateInvite()` with session data
- Return `{ ok: true }`

### Unchanged (stays in `index.ts`)

`GET /api/sessions/code/:code` — unauthenticated, used by the Tauri agent.
`GET /api/sessions/:id` — existing stub, stays in `index.ts` for now (used by agent/future detail page).

---

## Email

### `apps/server/src/lib/email.ts`

Wraps `resend` npm package. Single exported function:

```ts
sendCandidateInvite({
  to: string,
  candidateName: string,
  interviewerName: string,
  companyName: string,
  sessionCode: string,
  meetingLink: string,
  scheduledAt: Date,
}): Promise<void>
```

**Email content:**
- Subject: `Your interview with {companyName} — session details`
- Candidate name greeting
- Scheduled date/time (human-readable)
- Meeting link as a CTA button
- Session code in a large monospace block with label "Your TrueSelf session code"
- Instructions: "Download TrueSelf Agent at [trueself.io/download], launch it before your interview, and enter this code when prompted."
- Reassurance footer: "TrueSelf only monitors activity during your scheduled interview window. It does not access personal files or data."

**Environment variable required:** `RESEND_API_KEY`
**From address:** `interviews@{RESEND_FROM_DOMAIN}` (env var `RESEND_FROM_DOMAIN`, default `trueself.io`)

### Copy-invite text (client-side)

Generated in-browser from session data — no API call. Plain text format:

```
Hi {candidateName},

Your interview with {companyName} is scheduled for {date} at {time}.

Join via: {meetingLink}

Before the interview, please download and install the TrueSelf integrity agent:
→ https://trueself.io/download

When prompted, enter your session code: {sessionCode}

The agent runs only during your scheduled interview session.
```

---

## Shared Types

New types added to `packages/shared-types/src/index.ts`:

```ts
export interface CreateSessionRequest {
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string; // ISO 8601
  sendEmail?: boolean;
}

export interface CreateSessionResponse {
  id: string;
  sessionCode: string;
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string;
  status: "pending" | "active" | "completed" | "cancelled";
  createdAt: string;
}

export interface SessionListItem {
  id: string;
  sessionCode: string;
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string;
  status: "pending" | "active" | "completed" | "cancelled";
  overallScore: number | null;
  createdAt: string;
}
```

---

## Web UI

### Server actions: `apps/web/src/actions/sessions.ts`

Three functions, all using `apiToken` from the web session (same pattern as `apps/web/src/actions/auth.ts`):

- `createSession(data: CreateSessionRequest): Promise<CreateSessionResponse>`
- `getSessions(): Promise<SessionListItem[]>`
- `resendInvite(sessionId: string): Promise<void>`

### `NewSessionModal` component

Client component at `apps/web/src/components/new-session-modal.tsx`.

**Props:** `{ open: boolean, onClose: () => void, onCreated: () => void }`

**Internal state:**
```ts
step: "form" | "success"
session: CreateSessionResponse | null
sendEmail: boolean  // tracks checkbox
copyState: "idle" | "copied"
emailSentState: "idle" | "sending" | "sent" | "error"
```

**Form step (step = "form"):**
- Fields: Candidate Name (text), Candidate Email (email), Interview Date & Time (datetime-local), Meeting Link (url)
- Checkbox: "Send invite email automatically" (default: checked)
- Submit button: "Create Session" — calls `createSession` server action
- On success: set `session` state, transition to `step = "success"`

**Success step (step = "success"):**
- Header: "Session created"
- Large session code display (monospace, copyable via one click)
- Two action blocks:

  *Copy invite block:*
  - Label: "Copy invite text"
  - Expandable text area showing the pre-formatted plain text
  - "Copy" button → writes to clipboard → shows "Copied ✓" for 2s

  *Send email block (shown only if `sendEmail` was false OR as a "Resend" option):*
  - If `sendEmail` was true: shows "Invite sent to {email} ✓"
  - If `sendEmail` was false: shows "Send invite email" button → calls `resendInvite` → shows "Sent ✓"

- "Done" button: calls `onCreated()` (triggers list refresh) then `onClose()`

### Sessions page updates

**Tabs:** Upcoming (PENDING) | Active | Completed
Filter sessions client-side by status after a single `getSessions()` fetch.

**Session row (table or card list):**
- Candidate name + email
- Scheduled date/time (formatted)
- Session code with copy icon
- Status badge (color-coded)
- Action menu: "Resend invite" only (cancel is out of scope for this build)

**Empty state per tab:** Contextual message (e.g. "No upcoming sessions — create one to get started").

**"New session" button** in page header opens `NewSessionModal`. On `onCreated`, re-fetch sessions list (via router.refresh() or revalidatePath).

---

## Error Handling

- Server returns structured `{ error: string }` on 400/401/404/500
- Server actions surface errors to the UI via return value (not thrown)
- Modal form shows inline field errors from Zod (passed back in response)
- Email send failure is non-fatal: session is still created, error is surfaced in the success step with a "Retry" option

---

## Environment Variables

New variables required:

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | Yes | — | Resend API key |
| `RESEND_FROM_DOMAIN` | No | `trueself.io` | From domain for emails |

---

## Out of Scope

- Cancel session endpoint (status update) — listed as a future action but not in this build
- Session detail / live monitoring page — separate feature
- Agent download page (`trueself.io/download`) — external, referenced in email copy only
