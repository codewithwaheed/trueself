# Session Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-interviewer invitations, session editing/cancellation, a detail drawer, and client-side pagination to the sessions module.

**Architecture:** A new `SessionInvitee` join table links users to sessions as co-interviewers. The server gains GET/:id, PATCH/:id, and PATCH/:id/cancel endpoints. The web adds a `SessionDetailDrawer` component with view/edit modes, an `InviteeMultiSelect` picker used in both creation and editing, and client-side pagination in `SessionsContent`.

**Tech Stack:** Prisma (PostgreSQL), Hono, Zod, Next.js 14 App Router, React server actions, Tailwind CSS, TypeScript.

---

## File Map

**Create:**
- `apps/web/src/components/invitee-multi-select.tsx` — reusable chip-based invitee picker
- `apps/web/src/components/session-detail-drawer.tsx` — slide-over drawer with view and edit modes

**Modify:**
- `packages/db/prisma/schema.prisma` — add `SessionInvitee` model + relations
- `packages/shared-types/src/index.ts` — add `SessionInvitee`, `SessionDetail`, `UpdateSessionRequest`; extend `SessionListItem` and `CreateSessionResponse` with `invitees`
- `apps/server/src/routes/sessions.ts` — update POST + GET; add GET /:id, PATCH /:id, PATCH /:id/cancel
- `apps/web/src/actions/sessions.ts` — add `getTeamMembers`, `getSessionDetail`, `updateSession`, `cancelSession`; update `createSession`
- `apps/web/src/components/new-session-modal.tsx` — add `InviteeMultiSelect` to the form step
- `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx` — add pagination, drawer state, clickable rows

---

## Task 1: Add SessionInvitee to the Database Schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the SessionInvitee model and update relations**

Open `packages/db/prisma/schema.prisma`. Make these changes:

Add `sessionInvitees SessionInvitee[]` to the `User` model (after the `sessions` field):
```prisma
model User {
  id                 String             @id @default(cuid())
  email              String             @unique
  name               String
  passwordHash       String?
  role               Role               @default(INTERVIEWER)
  companyId          String
  company            Company            @relation(fields: [companyId], references: [id])
  sessions           InterviewSession[]
  sessionInvitees    SessionInvitee[]
  emailVerified      Boolean            @default(false)
  onboardingComplete Boolean            @default(false)
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
}
```

Add `sessionInvitees SessionInvitee[]` to the `InterviewSession` model (after `trustEvents`):
```prisma
model InterviewSession {
  id             String           @id @default(cuid())
  sessionCode    String           @unique
  companyId      String
  company        Company          @relation(fields: [companyId], references: [id])
  interviewerId  String
  interviewer    User             @relation(fields: [interviewerId], references: [id])
  candidateEmail String
  candidateName  String?
  meetingLink    String
  scheduledAt    DateTime
  startedAt      DateTime?
  endedAt        DateTime?
  status         SessionStatus    @default(PENDING)
  trustEvents    TrustEvent[]
  sessionInvitees SessionInvitee[]
  trustReport    Json?
  overallScore   Int?
  createdAt      DateTime         @default(now())
}
```

Add the new model at the end of the file:
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

- [ ] **Step 2: Run the migration**

```bash
cd /path/to/repo
pnpm db:push
```

Expected: `Your database is now in sync with your schema.`

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add SessionInvitee join table for co-interviewer support"
```

---

## Task 2: Add Shared Types

**Files:**
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Add SessionInvitee type and UpdateSessionRequest**

In `packages/shared-types/src/index.ts`, find the `// ---- Interview Session Types ----` section and add after the `InterviewSession` interface:

```ts
export interface SessionInvitee {
  id: string;
  name: string;
  email: string;
}

export interface UpdateSessionRequest {
  scheduledAt?: string;  // ISO 8601
  meetingLink?: string;
  inviteeIds?: string[]; // full replacement list; server always re-adds creator
}
```

- [ ] **Step 2: Extend SessionListItem with invitees**

Update `SessionListItem`:
```ts
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
  invitees: SessionInvitee[];
}
```

- [ ] **Step 3: Extend CreateSessionResponse with invitees**

Update `CreateSessionResponse`:
```ts
export interface CreateSessionResponse {
  id: string;
  sessionCode: string;
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string;
  status: "pending" | "active" | "completed" | "cancelled";
  createdAt: string;
  invitees: SessionInvitee[];
}
```

- [ ] **Step 4: Add SessionDetail type**

Add after `SessionListItem`:
```ts
export interface SessionDetail extends SessionListItem {
  // SessionListItem already includes invitees — no extra fields needed yet
}
```

- [ ] **Step 5: Extend CreateSessionRequest with inviteeIds**

Update `CreateSessionRequest`:
```ts
export interface CreateSessionRequest {
  candidateName: string;
  candidateEmail: string;
  meetingLink: string;
  scheduledAt: string; // ISO 8601
  sendEmail?: boolean;
  inviteeIds?: string[];
}
```

- [ ] **Step 6: Build shared-types to verify no type errors**

```bash
cd packages/shared-types && pnpm build
```

Expected: no errors, compiled output updated.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/index.ts
git commit -m "feat(types): add SessionInvitee, SessionDetail, UpdateSessionRequest; extend session types"
```

---

## Task 3: Update Server — POST /api/sessions and GET /api/sessions

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`

- [ ] **Step 1: Update CreateSessionSchema to accept inviteeIds**

In `apps/server/src/routes/sessions.ts`, update the `CreateSessionSchema`:

```ts
const CreateSessionSchema = z.object({
  candidateName: z.string().min(1, "Candidate name is required"),
  candidateEmail: z.string().email("Invalid email address"),
  meetingLink: z.string().url("Invalid meeting URL"),
  scheduledAt: z.string().datetime({ message: "scheduledAt must be a valid ISO 8601 date" }),
  sendEmail: z.boolean().optional().default(false),
  inviteeIds: z.array(z.string()).optional().default([]),
});
```

- [ ] **Step 2: Update the toSessionResponse helper to include invitees**

Replace the `toSessionResponse` function:

```ts
function toSessionResponse(
  session: {
    id: string;
    sessionCode: string;
    candidateName: string | null;
    candidateEmail: string;
    meetingLink: string;
    scheduledAt: Date;
    status: string;
    createdAt: Date;
  },
  invitees: { id: string; name: string; email: string }[] = []
): CreateSessionResponse {
  return {
    id: session.id,
    sessionCode: session.sessionCode,
    candidateName: session.candidateName ?? "",
    candidateEmail: session.candidateEmail,
    meetingLink: session.meetingLink,
    scheduledAt: session.scheduledAt.toISOString(),
    status: session.status.toLowerCase() as CreateSessionResponse["status"],
    createdAt: session.createdAt.toISOString(),
    invitees,
  };
}
```

- [ ] **Step 3: Update POST /api/sessions to create invitees**

Replace the `sessions.post("/", ...)` handler body. The key change is wrapping session creation and invitee insertion in a transaction, then returning invitees in the response:

```ts
sessions.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateSessionSchema.safeParse(body);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const firstError = Object.values(errors)[0]?.[0] ?? "Invalid input";
    return c.json({ error: firstError, fieldErrors: errors }, 400);
  }

  const { candidateName, candidateEmail, meetingLink, scheduledAt, sendEmail, inviteeIds } = parsed.data;
  const interviewerId = c.get("userId");
  const companyId = c.get("companyId");

  const sessionCode = await generateUniqueCode();

  // Validate inviteeIds belong to the same company
  const validInvitees = inviteeIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: inviteeIds }, companyId },
        select: { id: true, name: true, email: true },
      })
    : [];

  // Always include the creator; deduplicate
  const creatorUser = await prisma.user.findUnique({
    where: { id: interviewerId },
    select: { id: true, name: true, email: true },
  });

  const inviteeMap = new Map<string, { id: string; name: string; email: string }>();
  if (creatorUser) inviteeMap.set(creatorUser.id, creatorUser);
  for (const u of validInvitees) inviteeMap.set(u.id, u);
  const allInvitees = [...inviteeMap.values()];

  const session = await prisma.interviewSession.create({
    data: {
      sessionCode,
      companyId,
      interviewerId,
      candidateName,
      candidateEmail,
      meetingLink,
      scheduledAt: new Date(scheduledAt),
      sessionInvitees: {
        create: allInvitees.map((u) => ({ userId: u.id })),
      },
    },
  });

  if (sendEmail) {
    try {
      const interviewer = creatorUser
        ? await prisma.user.findUnique({ where: { id: interviewerId }, include: { company: true } })
        : null;
      if (!interviewer) {
        return c.json({ ...toSessionResponse(session, allInvitees), emailError: true }, 201);
      }
      await sendCandidateInvite({
        to: candidateEmail,
        candidateName,
        interviewerName: interviewer.name,
        companyName: interviewer.company.name,
        sessionCode,
        meetingLink,
        scheduledAt: new Date(scheduledAt),
      });
    } catch (err) {
      console.error("[sessions] Email send failed:", err);
      return c.json({ ...toSessionResponse(session, allInvitees), emailError: true }, 201);
    }
  }

  return c.json(toSessionResponse(session, allInvitees), 201);
});
```

- [ ] **Step 4: Update GET /api/sessions to include invitees and filter by invitee membership**

Replace the `sessions.get("/", ...)` handler:

```ts
sessions.get("/", async (c) => {
  const userId = c.get("userId");
  const userRole = c.get("userRole");
  const companyId = c.get("companyId");

  const where =
    userRole === "ADMIN"
      ? { companyId }
      : {
          companyId,
          OR: [
            { interviewerId: userId },
            { sessionInvitees: { some: { userId } } },
          ],
        };

  const rows = await prisma.interviewSession.findMany({
    where,
    orderBy: { scheduledAt: "desc" },
    include: {
      sessionInvitees: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  const result: SessionListItem[] = rows.map((s) => ({
    id: s.id,
    sessionCode: s.sessionCode,
    candidateName: s.candidateName ?? "",
    candidateEmail: s.candidateEmail,
    meetingLink: s.meetingLink,
    scheduledAt: s.scheduledAt.toISOString(),
    status: s.status.toLowerCase() as SessionListItem["status"],
    overallScore: s.overallScore,
    createdAt: s.createdAt.toISOString(),
    invitees: s.sessionInvitees.map((si) => ({
      id: si.user.id,
      name: si.user.name,
      email: si.user.email,
    })),
  }));

  return c.json(result);
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/sessions.ts
git commit -m "feat(server): update POST and GET /sessions to support co-interviewer invitees"
```

---

## Task 4: Add Server — GET /api/sessions/:id, PATCH /api/sessions/:id, PATCH /api/sessions/:id/cancel

**Files:**
- Modify: `apps/server/src/routes/sessions.ts`

- [ ] **Step 1: Add GET /api/sessions/:id**

Add before the existing `POST /:id/resend-email` handler:

```ts
// GET /api/sessions/:id — get session detail
sessions.get("/:id", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");
  const userRole = c.get("userRole");
  const companyId = c.get("companyId");

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      sessionInvitees: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!session || session.companyId !== companyId) {
    return c.json({ error: "Session not found" }, 404);
  }

  const isOwner = session.interviewerId === userId;
  const isInvitee = session.sessionInvitees.some((si) => si.userId === userId);
  if (!isOwner && !isInvitee && userRole !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const result: SessionDetail = {
    id: session.id,
    sessionCode: session.sessionCode,
    candidateName: session.candidateName ?? "",
    candidateEmail: session.candidateEmail,
    meetingLink: session.meetingLink,
    scheduledAt: session.scheduledAt.toISOString(),
    status: session.status.toLowerCase() as SessionDetail["status"],
    overallScore: session.overallScore,
    createdAt: session.createdAt.toISOString(),
    invitees: session.sessionInvitees.map((si) => ({
      id: si.user.id,
      name: si.user.name,
      email: si.user.email,
    })),
  };

  return c.json(result);
});
```

You will also need to import `SessionDetail` in the import line at the top of the file:
```ts
import type { SessionListItem, CreateSessionResponse, SessionDetail } from "@trueself/shared-types";
```

- [ ] **Step 2: Add UpdateSessionSchema and PATCH /api/sessions/:id**

Add the schema constant near the other schemas at the top of the file:
```ts
const UpdateSessionSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  meetingLink: z.string().url("Invalid meeting URL").optional(),
  inviteeIds: z.array(z.string()).optional(),
});
```

Add the handler before `POST /:id/resend-email`:
```ts
// PATCH /api/sessions/:id — edit a pending session
sessions.patch("/:id", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");
  const userRole = c.get("userRole");
  const companyId = c.get("companyId");

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.companyId !== companyId) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (session.interviewerId !== userId && userRole !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (session.status !== "PENDING") {
    return c.json({ error: "Only pending sessions can be edited" }, 409);
  }

  const body = await c.req.json();
  const parsed = UpdateSessionSchema.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const firstError = Object.values(errors)[0]?.[0] ?? "Invalid input";
    return c.json({ error: firstError, fieldErrors: errors }, 400);
  }

  const { scheduledAt, meetingLink, inviteeIds } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (scheduledAt) updateData.scheduledAt = new Date(scheduledAt);
  if (meetingLink) updateData.meetingLink = meetingLink;

  if (inviteeIds !== undefined) {
    // Validate new invitees belong to same company
    const validInvitees = inviteeIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: inviteeIds }, companyId },
          select: { id: true },
        })
      : [];

    // Always keep the creator
    const ownerIncluded = validInvitees.some((u) => u.id === session.interviewerId);
    const finalIds = ownerIncluded
      ? validInvitees.map((u) => u.id)
      : [session.interviewerId, ...validInvitees.map((u) => u.id)];

    // Replace invitees: delete all then re-create
    await prisma.sessionInvitee.deleteMany({ where: { sessionId } });
    await prisma.sessionInvitee.createMany({
      data: finalIds.map((uid) => ({ sessionId, userId: uid })),
    });
  }

  const updated = await prisma.interviewSession.update({
    where: { id: sessionId },
    data: updateData,
    include: {
      sessionInvitees: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  return c.json(toSessionResponse(
    updated,
    updated.sessionInvitees.map((si) => ({ id: si.user.id, name: si.user.name, email: si.user.email }))
  ));
});
```

- [ ] **Step 3: Add PATCH /api/sessions/:id/cancel**

Add before `POST /:id/resend-email`:
```ts
// PATCH /api/sessions/:id/cancel — cancel a pending session
sessions.patch("/:id/cancel", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");
  const userRole = c.get("userRole");
  const companyId = c.get("companyId");

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.companyId !== companyId) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (session.interviewerId !== userId && userRole !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (session.status !== "PENDING") {
    return c.json({ error: "Only pending sessions can be cancelled" }, 409);
  }

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED" },
  });

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/sessions.ts
git commit -m "feat(server): add GET/:id, PATCH/:id, PATCH/:id/cancel session endpoints"
```

---

## Task 5: Update Web Server Actions

**Files:**
- Modify: `apps/web/src/actions/sessions.ts`

- [ ] **Step 1: Replace the file content**

Replace the entire file `apps/web/src/actions/sessions.ts` with:

```ts
'use server'

import { getSession } from "@/lib/session";
import { API_URL } from "@/lib/constants";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionDetail,
  TeamMember,
  UpdateSessionRequest,
} from "@trueself/shared-types";

export async function createSession(
  data: CreateSessionRequest
): Promise<{ session?: CreateSessionResponse; emailError?: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { error: "Not authenticated" };

  const res = await fetch(`${API_URL}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.apiToken}`,
    },
    body: JSON.stringify(data),
  });

  const body = await res.json();

  if (!res.ok) {
    return { error: body.error || "Failed to create session" };
  }

  return { session: body as CreateSessionResponse, emailError: body.emailError === true };
}

export async function resendInvite(
  sessionId: string
): Promise<{ ok?: boolean; error?: string }> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return { error: "Invalid session ID" };

  const session = await getSession();
  if (!session) return { error: "Not authenticated" };

  const res = await fetch(`${API_URL}/api/sessions/${sessionId}/resend-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.apiToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.json();
    return { error: body.error || "Failed to resend email" };
  }

  return { ok: true };
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const session = await getSession();
  if (!session) return [];

  const res = await fetch(`${API_URL}/api/auth/team`, {
    headers: { Authorization: `Bearer ${session.apiToken}` },
    cache: "no-store",
  });

  if (!res.ok) return [];

  const body = await res.json();
  return body.members as TeamMember[];
}

export async function getSessionDetail(
  sessionId: string
): Promise<{ session?: SessionDetail; error?: string }> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return { error: "Invalid session ID" };

  const session = await getSession();
  if (!session) return { error: "Not authenticated" };

  const res = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${session.apiToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json();
    return { error: body.error || "Session not found" };
  }

  return { session: (await res.json()) as SessionDetail };
}

export async function updateSession(
  sessionId: string,
  data: UpdateSessionRequest
): Promise<{ ok?: boolean; error?: string }> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return { error: "Invalid session ID" };

  const session = await getSession();
  if (!session) return { error: "Not authenticated" };

  const res = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.apiToken}`,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json();
    return { error: body.error || "Failed to update session" };
  }

  return { ok: true };
}

export async function cancelSession(
  sessionId: string
): Promise<{ ok?: boolean; error?: string }> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return { error: "Invalid session ID" };

  const session = await getSession();
  if (!session) return { error: "Not authenticated" };

  const res = await fetch(`${API_URL}/api/sessions/${sessionId}/cancel`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.apiToken}` },
  });

  if (!res.ok) {
    const body = await res.json();
    return { error: body.error || "Failed to cancel session" };
  }

  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/actions/sessions.ts
git commit -m "feat(web): add getTeamMembers, getSessionDetail, updateSession, cancelSession actions"
```

---

## Task 6: Build InviteeMultiSelect Component

**Files:**
- Create: `apps/web/src/components/invitee-multi-select.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/invitee-multi-select.tsx`:

```tsx
'use client'

import { useState, useMemo, useRef, useEffect } from "react";
import type { TeamMember } from "@trueself/shared-types";

export interface SelectedInvitee {
  id: string;
  name: string;
  email: string;
}

interface InviteeMultiSelectProps {
  teamMembers: TeamMember[];
  selected: SelectedInvitee[];
  currentUserId: string;
  onChange: (invitees: SelectedInvitee[]) => void;
}

export function InviteeMultiSelect({
  teamMembers,
  selected,
  currentUserId,
  onChange,
}: InviteeMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedIds = new Set(selected.map((s) => s.id));

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return teamMembers.filter(
      (m) =>
        !selectedIds.has(m.id) &&
        (m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    );
  }, [query, teamMembers, selectedIds]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function add(member: TeamMember) {
    onChange([...selected, { id: member.id, name: member.name, email: member.email }]);
    setQuery("");
    setOpen(false);
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Chips */}
      <div className="flex flex-wrap gap-2">
        {selected.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-navy-700 text-navy-200 border border-[var(--border-subtle)]"
          >
            {s.name}
            {s.id !== currentUserId && (
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="text-navy-500 hover:text-navy-200 transition-colors"
                aria-label={`Remove ${s.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search team members…"
          className="input-field focus-ring text-sm"
          autoComplete="off"
        />

        {open && filtered.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-xl bg-navy-800 border border-[var(--border-default)] shadow-xl overflow-hidden">
            {filtered.slice(0, 8).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => add(m)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-navy-700 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-navy-700 flex items-center justify-center text-xs font-bold text-navy-300 shrink-0">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy-100 truncate">{m.name}</p>
                    <p className="text-xs text-navy-500 truncate">{m.email}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/invitee-multi-select.tsx
git commit -m "feat(web): add InviteeMultiSelect component"
```

---

## Task 7: Update NewSessionModal to Include Invitee Picker

**Files:**
- Modify: `apps/web/src/components/new-session-modal.tsx`

- [ ] **Step 1: Add team member fetching and invitee state**

In `new-session-modal.tsx`:

1. Add import at the top:
```ts
import { InviteeMultiSelect, type SelectedInvitee } from "@/components/invitee-multi-select";
import { getTeamMembers } from "@/actions/sessions";
import type { TeamMember } from "@trueself/shared-types";
```

2. Add `currentUserId` and `currentUserName` to `NewSessionModalProps`:
```ts
interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  companyName: string;
  currentUserId: string;
  currentUserName: string;
}
```

3. Inside the `NewSessionModal` function, add state for team members and invitees after the existing state declarations:
```ts
const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
const [selectedInvitees, setSelectedInvitees] = useState<SelectedInvitee[]>([]);
```

4. In the `useEffect` that runs when `open` changes, after `setSendEmail(true)`, add:
```ts
// Pre-select current user as non-removable chip
setSelectedInvitees([{ id: currentUserId, name: currentUserName, email: "" }]);
// Fetch team members (email not needed for display here but kept for type compat)
getTeamMembers().then(setTeamMembers);
```

5. In the reset block of the same effect also reset:
```ts
setSelectedInvitees([{ id: currentUserId, name: currentUserName, email: "" }]);
```

- [ ] **Step 2: Pass inviteeIds on submit**

In `handleSubmit`, update the `data` object:
```ts
const data = {
  candidateName: (form.elements.namedItem("candidateName") as HTMLInputElement).value.trim(),
  candidateEmail: (form.elements.namedItem("candidateEmail") as HTMLInputElement).value.trim(),
  meetingLink: (form.elements.namedItem("meetingLink") as HTMLInputElement).value.trim(),
  scheduledAt: new Date(rawScheduled).toISOString(),
  sendEmail,
  inviteeIds: selectedInvitees
    .filter((i) => i.id !== currentUserId)
    .map((i) => i.id),
};
```

- [ ] **Step 3: Add InviteeMultiSelect to the form JSX**

In the form JSX, add this section after the meeting link field and before the send email checkbox:

```tsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-navy-200">Interviewers</label>
  <InviteeMultiSelect
    teamMembers={teamMembers}
    selected={selectedInvitees}
    currentUserId={currentUserId}
    onChange={setSelectedInvitees}
  />
</div>
```

- [ ] **Step 4: Update sessions page.tsx to pass currentUserId and currentUserName**

> Note: `sessions-content.tsx` will be fully replaced in Task 9 with all prop changes already included. Only `page.tsx` needs updating here.

In `apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx`, update:
```tsx
return (
  <SessionsContent
    initialSessions={sessions}
    companyName={session.companyName}
    currentUserId={session.userId}
    currentUserName={session.name}
  />
);
```

Note: confirm that `session.id` and `session.name` are available from `getSession()`. The `AuthUser` type in `@trueself/shared-types` has both `id` and `name` fields. Check `apps/web/src/lib/session.ts` if the return shape differs.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/new-session-modal.tsx \
        apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx
git commit -m "feat(web): add invitee multi-select to new session modal"
```

---

## Task 8: Build SessionDetailDrawer Component

**Files:**
- Create: `apps/web/src/components/session-detail-drawer.tsx`

- [ ] **Step 1: Create the drawer component**

Create `apps/web/src/components/session-detail-drawer.tsx`:

```tsx
'use client'

import { useState, useEffect, useTransition } from "react";
import type { SessionListItem, TeamMember, UpdateSessionRequest } from "@trueself/shared-types";
import { InviteeMultiSelect, type SelectedInvitee } from "@/components/invitee-multi-select";
import { updateSession, cancelSession, resendInvite } from "@/actions/sessions";

interface SessionDetailDrawerProps {
  session: SessionListItem | null;
  onClose: () => void;
  onChanged: () => void;
  companyName: string;
  currentUserId: string;
  teamMembers: TeamMember[];
}

function buildInviteText(session: SessionListItem, companyName: string): string {
  const date = new Date(session.scheduledAt);
  const formatted = date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return `Hi ${session.candidateName},

Your interview with ${companyName} is scheduled for ${formatted}.

Join via: ${session.meetingLink}

Before the interview, please download and install the TrueSelf integrity agent:
→ https://trueself.io/download

When prompted, enter your session code: ${session.sessionCode}

The agent runs only during your scheduled interview session. It does not access personal files or data outside the session.`;
}

export function SessionDetailDrawer({
  session,
  onClose,
  onChanged,
  companyName,
  currentUserId,
  teamMembers,
}: SessionDetailDrawerProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [codeCopied, setCodeCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Edit state
  const [editScheduledAt, setEditScheduledAt] = useState("");
  const [editMeetingLink, setEditMeetingLink] = useState("");
  const [editInvitees, setEditInvitees] = useState<SelectedInvitee[]>([]);
  const [isPending, startTransition] = useTransition();

  // Reset when session changes
  useEffect(() => {
    if (session) {
      setMode("view");
      setCodeCopied(false);
      setTextCopied(false);
      setEmailState("idle");
      setShowCancelConfirm(false);
      setActionError(null);
    }
  }, [session?.id]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function enterEditMode() {
    if (!session) return;
    // Pre-populate edit fields
    const dt = new Date(session.scheduledAt);
    // datetime-local value format: YYYY-MM-DDTHH:MM
    const pad = (n: number) => String(n).padStart(2, "0");
    setEditScheduledAt(
      `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
    );
    setEditMeetingLink(session.meetingLink);
    setEditInvitees(
      session.invitees.map((i) => ({ id: i.id, name: i.name, email: i.email }))
    );
    setActionError(null);
    setMode("edit");
  }

  function handleCopyCode() {
    if (!session) return;
    navigator.clipboard.writeText(session.sessionCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(() => {});
  }

  function handleCopyText() {
    if (!session) return;
    navigator.clipboard.writeText(buildInviteText(session, companyName)).then(() => {
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    }).catch(() => {});
  }

  async function handleSendEmail() {
    if (!session) return;
    setEmailState("sending");
    const result = await resendInvite(session.id);
    setEmailState(result.ok ? "sent" : "error");
  }

  function handleSaveEdit() {
    if (!session) return;
    setActionError(null);

    const payload: UpdateSessionRequest = {};
    if (editScheduledAt) payload.scheduledAt = new Date(editScheduledAt).toISOString();
    if (editMeetingLink) payload.meetingLink = editMeetingLink;
    payload.inviteeIds = editInvitees
      .filter((i) => i.id !== currentUserId)
      .map((i) => i.id);

    startTransition(async () => {
      const result = await updateSession(session.id, payload);
      if (result.error) {
        setActionError(result.error);
        return;
      }
      setMode("view");
      onChanged();
    });
  }

  function handleCancel() {
    if (!session) return;
    startTransition(async () => {
      const result = await cancelSession(session.id);
      if (result.error) {
        setActionError(result.error);
        setShowCancelConfirm(false);
        return;
      }
      onChanged();
      onClose();
    });
  }

  if (!session) return null;

  const isPending_ = session.status === "pending";
  const isOwner = session.invitees.some(
    (i) => i.id === currentUserId
  );

  const date = new Date(session.scheduledAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-[480px] bg-navy-900 border-l border-[var(--border-default)] shadow-2xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] shrink-0">
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              {mode === "edit" ? "Edit session" : session.candidateName}
            </h2>
            <p className="text-sm text-navy-400 mt-0.5">
              {mode === "edit" ? `for ${session.candidateName}` : session.candidateEmail}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-navy-400 hover:text-navy-200 hover:bg-navy-800 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {mode === "view" ? (
            <>
              {/* Session info */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-widest">Session info</h3>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500">Status</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${
                      session.status === "active" ? "bg-trust/10 text-trust" :
                      session.status === "pending" ? "bg-navy-700 text-navy-300" :
                      "bg-navy-800 text-navy-400"
                    }`}>{session.status}</span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500">Scheduled</span>
                    <span className="text-xs text-navy-200">{formattedDate} at {formattedTime}</span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500 shrink-0">Meeting link</span>
                    <a
                      href={session.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-trust hover:underline truncate ml-4"
                    >
                      {session.meetingLink}
                    </a>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500">Session code</span>
                    <button
                      onClick={handleCopyCode}
                      className="flex items-center gap-1.5 font-bold text-trust tracking-widest text-sm"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {session.sessionCode}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={codeCopied ? "text-trust" : "text-navy-500"}>
                        {codeCopied
                          ? <path d="M20 6L9 17L4 12" strokeLinecap="round" strokeLinejoin="round" />
                          : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>}
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Interviewers */}
                {session.invitees.length > 0 && (
                  <div className="p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <p className="text-xs text-navy-500 mb-2">Interviewers</p>
                    <div className="flex flex-wrap gap-2">
                      {session.invitees.map((inv) => (
                        <span key={inv.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-navy-700 text-navy-200 border border-[var(--border-subtle)]">
                          <span className="w-4 h-4 rounded-full bg-navy-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {inv.name.charAt(0).toUpperCase()}
                          </span>
                          {inv.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Email actions */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-widest">Invite</h3>

                <div className="p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] space-y-3">
                  {/* Preview */}
                  <p className="text-xs text-navy-500 leading-relaxed" style={{ fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
                    {buildInviteText(session, companyName).slice(0, 140)}…
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyText}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-navy-300 bg-navy-700 hover:bg-navy-600 transition-colors"
                    >
                      {textCopied ? "Copied ✓" : "Copy invite text"}
                    </button>

                    {emailState === "idle" && (
                      <button
                        onClick={handleSendEmail}
                        className="flex-1 btn-primary !py-2 text-xs"
                      >
                        Send via TrueSelf
                      </button>
                    )}
                    {emailState === "sending" && (
                      <button disabled className="flex-1 btn-primary !py-2 text-xs opacity-60">Sending…</button>
                    )}
                    {emailState === "sent" && (
                      <span className="flex-1 flex items-center justify-center gap-1 text-xs text-trust">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Sent
                      </span>
                    )}
                    {emailState === "error" && (
                      <button onClick={handleSendEmail} className="flex-1 btn-primary !py-2 text-xs">Retry send</button>
                    )}
                  </div>
                </div>
              </section>

              {/* Actions for pending + owner */}
              {isPending_ && isOwner && (
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-widest">Actions</h3>

                  {actionError && (
                    <p className="text-xs text-critical-light">{actionError}</p>
                  )}

                  {!showCancelConfirm ? (
                    <div className="flex gap-2">
                      <button
                        onClick={enterEditMode}
                        className="flex-1 btn-secondary text-sm"
                      >
                        Edit session
                      </button>
                      <button
                        onClick={() => setShowCancelConfirm(true)}
                        className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-critical-light border border-critical-light/30 hover:bg-critical-light/10 transition-colors"
                      >
                        Cancel session
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-navy-800/40 border border-critical-light/30 space-y-3">
                      <p className="text-sm text-navy-200">Cancel this session? This cannot be undone.</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowCancelConfirm(false)}
                          className="flex-1 btn-secondary text-sm"
                        >
                          Keep session
                        </button>
                        <button
                          onClick={handleCancel}
                          disabled={isPending}
                          className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-white bg-critical-light hover:opacity-90 transition-opacity disabled:opacity-60"
                        >
                          {isPending ? "Cancelling…" : "Yes, cancel"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          ) : (
            /* Edit mode */
            <section className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-navy-200">Interview date & time</label>
                <input
                  type="datetime-local"
                  value={editScheduledAt}
                  onChange={(e) => setEditScheduledAt(e.target.value)}
                  className="input-field focus-ring"
                  style={{ colorScheme: "dark" }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-navy-200">Meeting link</label>
                <input
                  type="url"
                  value={editMeetingLink}
                  onChange={(e) => setEditMeetingLink(e.target.value)}
                  className="input-field focus-ring"
                  placeholder="https://zoom.us/j/..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-navy-200">Interviewers</label>
                <InviteeMultiSelect
                  teamMembers={teamMembers}
                  selected={editInvitees}
                  currentUserId={currentUserId}
                  onChange={setEditInvitees}
                />
              </div>

              {actionError && (
                <p className="text-sm text-critical-light">{actionError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setMode("view"); setActionError(null); }}
                  className="btn-secondary flex-1"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isPending}
                  className="btn-primary flex-1"
                >
                  {isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/session-detail-drawer.tsx
git commit -m "feat(web): add SessionDetailDrawer component with view and edit modes"
```

---

## Task 9: Update SessionsContent with Pagination, Clickable Rows, and Drawer

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx`

- [ ] **Step 1: Replace the full file content**

Replace `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx` with:

```tsx
'use client'

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { NewSessionModal } from "@/components/new-session-modal";
import { SessionDetailDrawer } from "@/components/session-detail-drawer";
import { resendInvite, getTeamMembers } from "@/actions/sessions";
import type { SessionListItem, TeamMember } from "@trueself/shared-types";

const PAGE_SIZE = 10;

interface SessionsContentProps {
  initialSessions: SessionListItem[];
  companyName: string;
  currentUserId: string;
  currentUserName: string;
}

type TabKey = "upcoming" | "active" | "completed";

const STATUS_TAB: Record<SessionListItem["status"], TabKey> = {
  pending: "upcoming",
  active: "active",
  completed: "completed",
  cancelled: "completed",
};

const TAB_LABELS: Record<TabKey, string> = {
  upcoming: "Upcoming",
  active: "Active",
  completed: "Completed",
};

function StatusBadge({ status }: { status: SessionListItem["status"] }) {
  const styles: Record<SessionListItem["status"], string> = {
    pending: "bg-navy-700 text-navy-300",
    active: "bg-trust/10 text-trust",
    completed: "bg-navy-800 text-navy-400",
    cancelled: "bg-navy-800 text-navy-600",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${styles[status]}`}>
      {status}
    </span>
  );
}

function SessionRow({
  session,
  onResend,
  onClick,
}: {
  session: SessionListItem;
  onResend: (id: string) => void;
  onClick: (session: SessionListItem) => void;
}) {
  const [codeCopied, setCodeCopied] = useState(false);

  function copyCode(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(session.sessionCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(() => {});
  }

  const date = new Date(session.scheduledAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      onClick={() => onClick(session)}
      className="flex items-center justify-between p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-navy-100 truncate">{session.candidateName}</p>
          <p className="text-xs text-navy-500 truncate">{session.candidateEmail}</p>
        </div>
      </div>

      <div className="flex items-center gap-6 shrink-0 ml-4">
        <div className="text-right hidden sm:block">
          <p className="text-xs text-navy-300">{formattedDate}</p>
          <p className="text-xs text-navy-500">{formattedTime}</p>
        </div>

        <button
          onClick={copyCode}
          title="Copy session code"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-navy-800 border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors"
        >
          <span className="text-xs font-bold text-trust tracking-widest" style={{ fontFamily: "var(--font-mono)" }}>
            {session.sessionCode}
          </span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={codeCopied ? "text-trust" : "text-navy-500"}>
            {codeCopied
              ? <path d="M20 6L9 17L4 12" strokeLinecap="round" strokeLinejoin="round" />
              : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>
            }
          </svg>
        </button>

        <StatusBadge status={session.status} />

        {session.status === "pending" && (
          <button
            onClick={(e) => { e.stopPropagation(); onResend(session.id); }}
            className="text-xs text-navy-400 hover:text-navy-200 transition-colors whitespace-nowrap"
          >
            Resend invite
          </button>
        )}

        {/* Right arrow affordance */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-navy-600 shrink-0">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function SessionsContent({
  initialSessions,
  companyName,
  currentUserId,
  currentUserName,
}: SessionsContentProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerSession, setDrawerSession] = useState<SessionListItem | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendToast, setResendToast] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const tabs: TabKey[] = ["upcoming", "active", "completed"];

  const filtered = useMemo(
    () => initialSessions.filter((s) => STATUS_TAB[s.status] === activeTab),
    [initialSessions, activeTab]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab);
    setPage(1);
  }

  async function handleResend(sessionId: string) {
    setResendingId(sessionId);
    const result = await resendInvite(sessionId);
    setResendingId(null);
    setResendToast(result.ok ? "Invite resent" : (result.error ?? "Failed to resend"));
    setTimeout(() => setResendToast(null), 3000);
  }

  function handleCreated() {
    router.refresh();
  }

  function handleChanged() {
    router.refresh();
  }

  async function handleOpenDrawer(session: SessionListItem) {
    setDrawerSession(session);
    // Lazy-load team members on first drawer open
    if (teamMembers.length === 0) {
      const members = await getTeamMembers();
      setTeamMembers(members);
    }
  }

  return (
    <>
      <NewSessionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
        companyName={companyName}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
      />

      <SessionDetailDrawer
        session={drawerSession}
        onClose={() => setDrawerSession(null)}
        onChanged={handleChanged}
        companyName={companyName}
        currentUserId={currentUserId}
        teamMembers={teamMembers}
      />

      {/* Toast */}
      {resendToast && (
        <div className="fixed bottom-6 right-6 z-40 px-4 py-2.5 rounded-xl bg-navy-800 border border-[var(--border-default)] text-sm text-navy-200 shadow-xl animate-fade-in">
          {resendToast}
        </div>
      )}

      <div className="max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
            <p className="text-navy-400 text-sm mt-1">Monitor and manage your interview sessions.</p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="btn-primary !w-auto !px-5 gap-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5V19M5 12H19" />
            </svg>
            New session
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] w-fit mb-6">
          {tabs.map((tab) => {
            const count = initialSessions.filter((s) => STATUS_TAB[s.status] === tab).length;
            return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab
                    ? "bg-navy-700 text-navy-100 shadow-sm"
                    : "text-navy-400 hover:text-navy-300"
                }`}
              >
                {TAB_LABELS[tab]}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-md ${
                    activeTab === tab ? "bg-navy-600 text-navy-300" : "bg-navy-800 text-navy-500"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Session list */}
        {filtered.length === 0 ? (
          <div className="card border border-[var(--border-subtle)]">
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-16 h-16 rounded-2xl bg-navy-800/60 flex items-center justify-center mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-navy-600">
                  <path d="M15 10L19.5528 7.72361C20.2177 7.39116 21 7.87465 21 8.61803V15.382C21 16.1253 20.2177 16.6088 19.5528 16.2764L15 14M5 18H13C14.1046 18 15 17.1046 15 16V8C15 6.89543 14.1046 6 13 6H5C3.89543 6 3 6.89543 3 8V16C3 17.1046 3.89543 18 5 18Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-navy-300 mb-1">
                {activeTab === "upcoming" ? "No upcoming sessions" : activeTab === "active" ? "No active sessions" : "No completed sessions"}
              </p>
              <p className="text-xs text-navy-500 max-w-xs">
                {activeTab === "upcoming"
                  ? "Create a session to start monitoring candidate integrity."
                  : activeTab === "active"
                  ? "Sessions become active when the candidate connects the TrueSelf agent."
                  : "Completed sessions will appear here with trust reports."}
              </p>
              {activeTab === "upcoming" && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="btn-primary !w-auto !px-5 mt-5"
                >
                  Create session
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {paginated.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onResend={resendingId === session.id ? () => {} : handleResend}
                  onClick={handleOpenDrawer}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-1">
                <p className="text-xs text-navy-500">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-800 border border-[var(--border-subtle)] hover:border-[var(--border-default)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-800 border border-[var(--border-subtle)] hover:border-[var(--border-default)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx
git commit -m "feat(web): add pagination, drawer integration, and clickable rows to SessionsContent"
```

---

## Task 10: Smoke Test End-to-End

- [ ] **Step 1: Start services**

```bash
docker compose up -d   # PostgreSQL
pnpm dev:server        # API on :3001
pnpm dev:web           # Dashboard on :3000
```

- [ ] **Step 2: Verify session creation with invitees**

1. Log in as an interviewer with at least one other team member in the company
2. Click "New session" — verify the Interviewers section appears with the current user as a pre-selected non-removable chip
3. Search for a team member — verify dropdown appears and selection adds a chip
4. Submit the form — verify session is created and both users appear under invitees when the drawer opens

- [ ] **Step 3: Verify detail drawer**

1. Click a session row — verify the drawer opens with session info, invite section, and (for pending sessions) action buttons
2. Click "Copy invite text" — verify clipboard receives the full template
3. Click "Send via TrueSelf" — verify email state changes to "sent" (or "error" if email not configured)

- [ ] **Step 4: Verify edit mode**

1. Open a pending session drawer and click "Edit session"
2. Change the scheduled time and click "Save changes"
3. Verify the drawer returns to view mode and the list refreshes with updated time

- [ ] **Step 5: Verify cancel**

1. Open a pending session drawer and click "Cancel session"
2. Verify the confirmation prompt appears
3. Confirm cancellation — verify the session disappears from Upcoming and appears in Completed as "cancelled"

- [ ] **Step 6: Verify pagination**

1. Create or seed more than 10 sessions
2. Verify "Previous"/"Next" controls appear and "1–10 of N" counter is correct
3. Verify page resets to 1 when switching tabs

- [ ] **Step 7: Verify co-interviewer visibility**

1. Log in as a co-interviewer (not the session owner)
2. Verify the session appears in their Sessions list
3. Verify they can open the drawer and see all session info
4. Verify "Edit session" and "Cancel session" buttons do NOT appear (only owner can edit/cancel)

- [ ] **Step 8: Final commit (if any cleanup needed)**

```bash
git add -p   # stage only intentional changes
git commit -m "fix: address issues found during smoke testing"
```
