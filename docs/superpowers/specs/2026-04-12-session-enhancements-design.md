# Session Module Enhancements — Design Spec

**Date:** 2026-04-12
**Status:** Approved

---

## Overview

Enhance the session module with four capabilities:
1. Multi-interviewer invitations on session creation
2. Edit and cancel upcoming sessions
3. Session detail drawer with email actions
4. Client-side pagination (10 per page)

---

## 1. Database Changes

Add a `SessionInvitee` join table to support multiple co-interviewers per session.

```prisma
model SessionInvitee {
  id        String           @id @default(cuid())
  sessionId String
  session   InterviewSession @relation(fields: [sessionId], references: [id])
  userId    String
  user      User             @relation(fields: [userId], references: [id])
  createdAt DateTime         @default(now())

  @@unique([sessionId, userId])
}
```

- `InterviewSession.interviewerId` remains as the **owner** (creator). Not removed.
- On session creation, the creator is automatically inserted as the first `SessionInvitee`.
- Existing sessions without invitee rows are unaffected — owner access is still derived from `interviewerId`.
- Add `sessionInvitees SessionInvitee[]` relation to both `InterviewSession` and `User` models.

---

## 2. Shared Types

New and updated types in `packages/shared-types/src/index.ts`:

```ts
export interface SessionInvitee {
  id: string;
  name: string;
  email: string;
}

// Add to SessionListItem and CreateSessionResponse:
invitees: SessionInvitee[];

export interface UpdateSessionRequest {
  scheduledAt?: string;  // ISO 8601
  meetingLink?: string;
  inviteeIds?: string[];  // full replacement list (creator always re-added server-side)
}

export interface SessionDetail extends SessionListItem {
  invitees: SessionInvitee[];
}
```

---

## 3. API Changes

### Changed endpoints

**`POST /api/sessions`**
- New optional field: `inviteeIds: string[]`
- After creating the session, insert `SessionInvitee` rows for creator + all provided IDs in the same transaction.
- Validation: all `inviteeIds` must belong to the same company. Unknown IDs are silently ignored.

**`GET /api/sessions`**
- Query includes sessions where `interviewerId = userId` OR `SessionInvitee.userId = userId`.
- Each item in the response includes `invitees: SessionInvitee[]`.

### New endpoints

**`GET /api/sessions/:id`**
- Returns full session detail including `invitees[]`.
- Auth: user must be owner or invitee, or ADMIN of the same company.

**`PATCH /api/sessions/:id`**
- Accepts `UpdateSessionRequest` (scheduledAt, meetingLink, inviteeIds).
- Only allowed when `status === PENDING`. Returns 409 otherwise.
- `inviteeIds` replaces the full invitee list; creator is always re-added server-side.
- Auth: owner or ADMIN only (not co-interviewers).

**`PATCH /api/sessions/:id/cancel`**
- Sets `status = CANCELLED`. Only allowed on `PENDING` sessions.
- Returns 409 if session is not pending.
- Auth: owner or ADMIN only.

### Unchanged
- `POST /api/sessions/:id/resend-email` — no changes.

---

## 4. UI Components

### 4.1 Create Session Modal — Invitee Multi-Select

Add an "Interviewers" section below the existing form fields:

- Current user rendered as a pre-selected, non-removable chip.
- Text input filters team members (fetched once via `getTeamMembers()` server action when modal opens).
- Matching members shown in a dropdown below the input; click to add as chip.
- Each added chip has an × to remove.
- On submit, selected `inviteeIds` (excluding current user, added server-side) sent with the form data.

### 4.2 Session List — Pagination

- Client-side: all sessions fetched once, sliced into pages of 10.
- Prev/Next buttons + page indicator ("1–10 of 24") rendered below the list.
- Page resets to 1 when switching tabs.
- No pagination controls shown if total sessions in tab ≤ 10.

### 4.3 Session Row — Clickable

- Entire row is clickable and opens the detail drawer.
- "Resend invite" and "Copy code" buttons stop click propagation so they do not open the drawer.
- Visual affordance: row gets a subtle right-arrow indicator or stronger hover state.

### 4.4 Session Detail Drawer

Slides in from the right, ~480px wide, overlays the sessions list with a backdrop.

**View mode — three sections:**

1. **Session info**
   - Candidate name, email, scheduled date/time, meeting link, session code (copyable chip), status badge
   - Invitees list: avatar/initials chips for each co-interviewer

2. **Email actions**
   - "Send via TrueSelf" button — calls `POST /api/sessions/:id/resend-email`
   - "Copy invite text" button — copies full template to clipboard
   - Template preview (truncated, monospace) shown below the buttons
   - Send state: idle / sending / sent / error (same pattern as creation modal)

3. **Session actions** (pending only)
   - "Edit session" button — switches drawer to edit mode
   - "Cancel session" button — shows inline confirmation ("Are you sure? This cannot be undone") before calling cancel endpoint

**Edit mode (inline within drawer):**
- Fields: scheduled time (`datetime-local`), meeting link (`url`), invitee multi-select (same chip UI as creation)
- "Save changes" and "Discard" buttons
- On save: calls `PATCH /api/sessions/:id`, closes edit mode, calls `router.refresh()`
- Errors shown inline within the drawer (not toast)

---

## 5. State Management

| State | Location | Notes |
|---|---|---|
| `sessions` | `SessionsContent` | Full list from server, refreshed via `router.refresh()` |
| `page` | `SessionsContent` | Per-tab page number, resets on tab change |
| `drawerSession` | `SessionsContent` | Session open in drawer, `null` = closed |
| `drawerMode` | `SessionsContent` | `"view"` or `"edit"` |
| `teamMembers` | Modal / Drawer (local) | Fetched once on open via server action |
| `selectedInvitees` | Modal / Drawer (local) | `{ id, name, email }[]` |

---

## 6. Server Actions (web)

New/updated actions in `apps/web/src/actions/sessions.ts`:

- `createSession(data)` — updated to include `inviteeIds`
- `getTeamMembers()` — fetch all users in the caller's company (for invitee search)
- `getSessionDetail(id)` — fetch full session detail for the drawer
- `updateSession(id, data)` — call `PATCH /api/sessions/:id`
- `cancelSession(id)` — call `PATCH /api/sessions/:id/cancel`

---

## 7. Out of Scope

- Co-interviewer email notifications on session creation (future)
- Server-side pagination (deferred, revisit if team size grows)
- Editing candidate name or email after creation
- Invitee permissions beyond "can view the session"
