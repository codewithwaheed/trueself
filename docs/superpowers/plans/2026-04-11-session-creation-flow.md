# Session Creation Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build end-to-end session creation — modal form, session code generation, copy-invite text, and direct Resend email — with a live sessions list (Upcoming / Active / Completed tabs) on the dashboard.

**Architecture:** Server actions (called directly from client) handle mutations; the sessions page is a server component that fetches initial data and passes it to a client `SessionsContent` component; `router.refresh()` triggers re-fetch after creation. Email is sent server-side via Resend at creation time or on-demand via a resend endpoint.

**Tech Stack:** Hono (server routes), Resend (email), Zod (validation), Next.js App Router (server components + server actions + client components), Tailwind/custom CSS classes from globals.css (`card`, `btn-primary`, `btn-secondary`, `input-field`, `focus-ring`).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/shared-types/src/index.ts` | Add `CreateSessionRequest`, `CreateSessionResponse`, `SessionListItem` |
| Modify | `apps/server/package.json` | Add `resend` dependency |
| Create | `apps/server/src/lib/email.ts` | Resend wrapper + HTML email template |
| Create | `apps/server/src/routes/sessions.ts` | Hono sessions router (create, list, resend-email) |
| Modify | `apps/server/src/index.ts` | Mount sessions router; remove old inline stubs |
| Modify | `apps/server/.env` | Add `RESEND_API_KEY` and `RESEND_FROM_DOMAIN` |
| Create | `apps/web/src/actions/sessions.ts` | Server actions: createSession, resendInvite |
| Create | `apps/web/src/components/new-session-modal.tsx` | Two-step modal: form → success |
| Create | `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx` | Client component: tabs, session list, modal trigger |
| Modify | `apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx` | Server component: auth + data fetch + render SessionsContent |

---

## Task 1: Add Shared Types

**Files:**
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Add the three new interfaces** after the existing `InterviewSession` interface (around line 89).

  Open `packages/shared-types/src/index.ts` and add after the closing brace of `InterviewSession`:

  ```ts
  // ---- Session API Types ----

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

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd packages/shared-types && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/shared-types/src/index.ts
  git commit -m "feat(shared-types): add session creation and list types"
  ```

---

## Task 2: Install Resend and Create Email Library

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/lib/email.ts`
- Modify: `apps/server/.env`

- [ ] **Step 1: Install the resend package**

  ```bash
  cd apps/server && pnpm add resend
  ```

  Expected: `resend` appears in `apps/server/package.json` dependencies.

- [ ] **Step 2: Add env vars to `apps/server/.env`**

  Append to the file:
  ```
  RESEND_API_KEY="re_your_key_here"
  RESEND_FROM_DOMAIN="trueself.io"
  ```

  > Note: Replace `re_your_key_here` with a real Resend API key from resend.com. For local testing without a key, the `sendCandidateInvite` function will log the email instead of sending it (handled in Step 3).

- [ ] **Step 3: Create `apps/server/src/lib/email.ts`**

  ```ts
  import { Resend } from "resend";

  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN || "trueself.io";
  const FROM_ADDRESS = `TrueSelf Interviews <interviews@${FROM_DOMAIN}>`;

  export interface CandidateInviteParams {
    to: string;
    candidateName: string;
    interviewerName: string;
    companyName: string;
    sessionCode: string;
    meetingLink: string;
    scheduledAt: Date;
  }

  export async function sendCandidateInvite(params: CandidateInviteParams): Promise<void> {
    const {
      to,
      candidateName,
      interviewerName,
      companyName,
      sessionCode,
      meetingLink,
      scheduledAt,
    } = params;

    const formattedDate = scheduledAt.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedTime = scheduledAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#0a0e1a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#d8dfe9;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a;padding:40px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0f1629;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:#161d35;padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="font-size:18px;font-weight:700;color:#f1f5f9;letter-spacing:-0.5px;">TrueSelf</span>
              <span style="font-size:12px;color:#3d4f7a;margin-left:8px;font-weight:500;">Interview Integrity</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:14px;color:#5a6e9a;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Interview Invitation</p>
              <h1 style="margin:0 0 24px;font-size:24px;font-weight:700;color:#f1f5f9;line-height:1.3;">Hi ${candidateName},</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#8494b8;line-height:1.6;">
                <strong style="color:#d8dfe9;">${interviewerName}</strong> from <strong style="color:#d8dfe9;">${companyName}</strong> has scheduled an interview with you.
              </p>
              <!-- Interview details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#161d35;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid rgba(255,255,255,0.06);">
                <tr>
                  <td style="padding:6px 0;">
                    <span style="font-size:12px;color:#3d4f7a;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Date &amp; Time</span><br>
                    <span style="font-size:15px;color:#f1f5f9;font-weight:500;">${formattedDate} at ${formattedTime}</span>
                  </td>
                </tr>
              </table>
              <!-- Meeting link -->
              <p style="margin:0 0 12px;font-size:14px;color:#8494b8;">Join your interview:</p>
              <a href="${meetingLink}" style="display:inline-block;background:#10b981;color:#0a0e1a;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;text-decoration:none;margin-bottom:32px;">Join Meeting</a>
              <!-- Session code -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#161d35;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(16,185,129,0.2);">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 12px;font-size:12px;color:#3d4f7a;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Your TrueSelf Session Code</p>
                    <p style="margin:0 0 16px;font-size:36px;font-weight:700;color:#10b981;letter-spacing:0.15em;font-family:'Courier New',monospace;">${sessionCode}</p>
                    <p style="margin:0;font-size:13px;color:#5a6e9a;line-height:1.5;">
                      Download the TrueSelf Agent before your interview.<br>
                      Launch it and enter this code when prompted.
                    </p>
                  </td>
                </tr>
              </table>
              <!-- Download CTA -->
              <p style="margin:0 0 12px;font-size:14px;color:#8494b8;">Download the TrueSelf Agent:</p>
              <a href="https://trueself.io/download" style="display:inline-block;background:transparent;color:#10b981;font-weight:600;font-size:14px;padding:10px 20px;border-radius:10px;text-decoration:none;border:1px solid rgba(16,185,129,0.3);">Download Agent</a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0;font-size:12px;color:#2a3660;line-height:1.6;">
                TrueSelf only monitors activity during your scheduled interview window. It does not access personal files, browsing history, or data outside the session.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>
    `;

    if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === "re_your_key_here") {
      console.log("[email] No RESEND_API_KEY set — would have sent to:", to);
      console.log("[email] Session code:", sessionCode);
      return;
    }

    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `Your interview with ${companyName} — session details`,
      html,
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }
  }
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd apps/server && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/lib/email.ts apps/server/package.json pnpm-lock.yaml
  git commit -m "feat(server): add Resend email library for candidate invites"
  ```

---

## Task 3: Create Sessions Router

**Files:**
- Create: `apps/server/src/routes/sessions.ts`

- [ ] **Step 1: Create `apps/server/src/routes/sessions.ts`**

  ```ts
  import { Hono } from "hono";
  import { z } from "zod";
  import { prisma } from "@trueself/db";
  import type { SessionListItem, CreateSessionResponse } from "@trueself/shared-types";
  import { requireAuth } from "../middleware/auth";
  import { sendCandidateInvite } from "../lib/email";

  type AuthVariables = {
    userId: string;
    userRole: string;
    companyId: string;
  };

  const sessions = new Hono<{ Variables: AuthVariables }>();

  sessions.use("*", requireAuth);

  // ---- Zod Schemas ----

  const CreateSessionSchema = z.object({
    candidateName: z.string().min(1, "Candidate name is required"),
    candidateEmail: z.string().email("Invalid email address"),
    meetingLink: z.string().url("Invalid meeting URL"),
    scheduledAt: z.string().min(1, "Scheduled time is required"),
    sendEmail: z.boolean().optional().default(false),
  });

  // ---- Helpers ----

  async function generateUniqueCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const existing = await prisma.interviewSession.findUnique({
        where: { sessionCode: code },
      });
      if (!existing) return code;
    }
    throw new Error("Failed to generate unique session code");
  }

  function toSessionResponse(session: {
    id: string;
    sessionCode: string;
    candidateName: string | null;
    candidateEmail: string;
    meetingLink: string;
    scheduledAt: Date;
    status: string;
    createdAt: Date;
  }): CreateSessionResponse {
    return {
      id: session.id,
      sessionCode: session.sessionCode,
      candidateName: session.candidateName ?? "",
      candidateEmail: session.candidateEmail,
      meetingLink: session.meetingLink,
      scheduledAt: session.scheduledAt.toISOString(),
      status: session.status.toLowerCase() as CreateSessionResponse["status"],
      createdAt: session.createdAt.toISOString(),
    };
  }

  // ---- Routes ----

  // POST /api/sessions — create a new session
  sessions.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateSessionSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      const firstError = Object.values(errors)[0]?.[0] ?? "Invalid input";
      return c.json({ error: firstError, fieldErrors: errors }, 400);
    }

    const { candidateName, candidateEmail, meetingLink, scheduledAt, sendEmail } = parsed.data;
    const interviewerId = c.get("userId");
    const companyId = c.get("companyId");

    const sessionCode = await generateUniqueCode();

    const session = await prisma.interviewSession.create({
      data: {
        sessionCode,
        companyId,
        interviewerId,
        candidateName,
        candidateEmail,
        meetingLink,
        scheduledAt: new Date(scheduledAt),
      },
    });

    if (sendEmail) {
      try {
        const interviewer = await prisma.user.findUnique({
          where: { id: interviewerId },
          include: { company: true },
        });
        if (interviewer) {
          await sendCandidateInvite({
            to: candidateEmail,
            candidateName,
            interviewerName: interviewer.name,
            companyName: interviewer.company.name,
            sessionCode,
            meetingLink,
            scheduledAt: new Date(scheduledAt),
          });
        }
      } catch (err) {
        console.error("[sessions] Email send failed:", err);
        // Non-fatal: session is created, email error surfaces in response
        return c.json({ ...toSessionResponse(session), emailError: true }, 201);
      }
    }

    return c.json(toSessionResponse(session), 201);
  });

  // GET /api/sessions — list sessions for caller
  sessions.get("/", async (c) => {
    const userId = c.get("userId");
    const userRole = c.get("userRole");
    const companyId = c.get("companyId");

    const where =
      userRole === "ADMIN"
        ? { companyId }
        : { interviewerId: userId, companyId };

    const rows = await prisma.interviewSession.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
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
    }));

    return c.json(result);
  });

  // POST /api/sessions/:id/resend-email — resend candidate invite
  sessions.post("/:id/resend-email", async (c) => {
    const sessionId = c.req.param("id");
    const companyId = c.get("companyId");
    const interviewerId = c.get("userId");

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { interviewer: { include: { company: true } } },
    });

    if (!session || session.companyId !== companyId) {
      return c.json({ error: "Session not found" }, 404);
    }

    try {
      await sendCandidateInvite({
        to: session.candidateEmail,
        candidateName: session.candidateName ?? "there",
        interviewerName: session.interviewer.name,
        companyName: session.interviewer.company.name,
        sessionCode: session.sessionCode,
        meetingLink: session.meetingLink,
        scheduledAt: session.scheduledAt,
      });
    } catch (err) {
      console.error("[sessions] Resend email failed:", err);
      return c.json({ error: "Failed to send email" }, 500);
    }

    return c.json({ ok: true });
  });

  export default sessions;
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd apps/server && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/server/src/routes/sessions.ts
  git commit -m "feat(server): add sessions router with create, list, resend-email"
  ```

---

## Task 4: Mount Sessions Router in index.ts

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Replace the inline session stubs and mount the sessions router**

  In `apps/server/src/index.ts`:

  1. Add the import after the existing `authRoutes` import:
     ```ts
     import sessionsRoutes from "./routes/sessions";
     ```

  2. Replace the three inline session stub blocks (lines 27–61 — the `app.post("/api/sessions", ...)`, `app.get("/api/sessions/code/:code", ...)`, and `app.get("/api/sessions/:id", ...)` blocks) with:

     ```ts
     // ---- Sessions Routes (authenticated) ----
     app.route("/api/sessions", sessionsRoutes);

     // Agent: look up session by code (unauthenticated — agent uses this before auth)
     app.get("/api/sessions/code/:code", async (c) => {
       const session = await prisma.interviewSession.findUnique({
         where: { sessionCode: c.req.param("code") },
       });
       if (!session) return c.json({ error: "Not found" }, 404);
       return c.json(session);
     });

     // Agent/dashboard: get session details + events (unauthenticated for now — agent uses this)
     app.get("/api/sessions/:id", async (c) => {
       const session = await prisma.interviewSession.findUnique({
         where: { id: c.req.param("id") },
         include: { trustEvents: { orderBy: { timestamp: "asc" } } },
       });
       if (!session) return c.json({ error: "Not found" }, 404);
       return c.json(session);
     });
     ```

  > Note: The two unauthenticated routes (`/code/:code` and `/:id`) must come AFTER `app.route("/api/sessions", sessionsRoutes)` so the router handles `/api/sessions` (POST/GET list) first, and Hono falls through to the literal path handlers for the specific patterns. Actually, Hono routes match in order — put `app.route` first, then the two specific GET stubs, since `/:id` could conflict with the sessions router's routes. The sessions router handles `POST /` and `GET /` (list), so the `/:id` and `/code/:code` stubs won't conflict.

- [ ] **Step 2: Start the server and verify health**

  ```bash
  pnpm dev:server
  ```

  In another terminal:
  ```bash
  curl http://localhost:3001/health
  ```

  Expected: `{"status":"ok"}`

- [ ] **Step 3: Smoke test the sessions endpoint (requires a valid JWT)**

  Get a token by logging in first:
  ```bash
  TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"your@email.com","password":"yourpassword"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  echo $TOKEN
  ```

  Create a session:
  ```bash
  curl -s -X POST http://localhost:3001/api/sessions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "candidateName": "Test Candidate",
      "candidateEmail": "candidate@test.com",
      "meetingLink": "https://zoom.us/j/123456",
      "scheduledAt": "2026-04-15T10:00:00.000Z",
      "sendEmail": false
    }'
  ```

  Expected: `{"id":"...","sessionCode":"######","candidateName":"Test Candidate",...}` with HTTP 201.

  List sessions:
  ```bash
  curl -s http://localhost:3001/api/sessions \
    -H "Authorization: Bearer $TOKEN"
  ```

  Expected: JSON array containing the session just created.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/server/src/index.ts
  git commit -m "feat(server): mount sessions router, keep unauthenticated agent stubs"
  ```

---

## Task 5: Web Server Actions

**Files:**
- Create: `apps/web/src/actions/sessions.ts`

- [ ] **Step 1: Create `apps/web/src/actions/sessions.ts`**

  ```ts
  'use server'

  import { getSession } from "@/lib/session";
  import { API_URL } from "@/lib/constants";
  import type { CreateSessionRequest, CreateSessionResponse } from "@trueself/shared-types";

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
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd apps/web && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/actions/sessions.ts
  git commit -m "feat(web): add session server actions (createSession, resendInvite)"
  ```

---

## Task 6: Build the NewSessionModal Component

**Files:**
- Create: `apps/web/src/components/new-session-modal.tsx`

- [ ] **Step 1: Create `apps/web/src/components/new-session-modal.tsx`**

  ```tsx
  'use client'

  import { useState, useTransition, useEffect, useRef } from "react";
  import { createSession, resendInvite } from "@/actions/sessions";
  import type { CreateSessionResponse } from "@trueself/shared-types";

  interface NewSessionModalProps {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    companyName: string;
  }

  function buildInviteText(
    session: CreateSessionResponse,
    companyName: string
  ): string {
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

  export function NewSessionModal({ open, onClose, onCreated, companyName }: NewSessionModalProps) {
    const [step, setStep] = useState<"form" | "success">("form");
    const [session, setSession] = useState<CreateSessionResponse | null>(null);
    const [sendEmail, setSendEmail] = useState(true);
    const [formError, setFormError] = useState<string | null>(null);
    const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
    const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
    const [isPending, startTransition] = useTransition();
    const firstInputRef = useRef<HTMLInputElement>(null);

    // Reset state when modal opens
    useEffect(() => {
      if (open) {
        setStep("form");
        setSession(null);
        setFormError(null);
        setCopyState("idle");
        setEmailState("idle");
        setSendEmail(true);
        setTimeout(() => firstInputRef.current?.focus(), 50);
      }
    }, [open]);

    // Close on Escape
    useEffect(() => {
      if (!open) return;
      function onKey(e: KeyboardEvent) {
        if (e.key === "Escape") handleClose();
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    function handleClose() {
      onClose();
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setFormError(null);
      const form = e.currentTarget;
      const rawScheduled = (form.elements.namedItem("scheduledAt") as HTMLInputElement).value;

      const data = {
        candidateName: (form.elements.namedItem("candidateName") as HTMLInputElement).value.trim(),
        candidateEmail: (form.elements.namedItem("candidateEmail") as HTMLInputElement).value.trim(),
        meetingLink: (form.elements.namedItem("meetingLink") as HTMLInputElement).value.trim(),
        scheduledAt: new Date(rawScheduled).toISOString(),
        sendEmail,
      };

      startTransition(async () => {
        const result = await createSession(data);
        if (result.error) {
          setFormError(result.error);
          return;
        }
        setSession(result.session!);
        setStep("success");
        if (sendEmail && !result.emailError) {
          setEmailState("sent");
        } else if (result.emailError) {
          setEmailState("error");
        }
      });
    }

    async function handleSendEmail() {
      if (!session) return;
      setEmailState("sending");
      const result = await resendInvite(session.id);
      setEmailState(result.ok ? "sent" : "error");
    }

    function handleCopy() {
      if (!session) return;
      const text = buildInviteText(session, companyName);
      navigator.clipboard.writeText(text).then(() => {
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 2000);
      });
    }

    function handleDone() {
      onCreated();
      onClose();
    }

    if (!open) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label={step === "form" ? "Create session" : "Session created"}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />

        {/* Modal panel */}
        <div className="relative w-full max-w-md animate-fade-in">
          <div className="card border border-[var(--border-default)] shadow-2xl">

            {step === "form" && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">New session</h2>
                    <p className="text-sm text-navy-400 mt-0.5">Set up an interview monitoring session</p>
                  </div>
                  <button
                    onClick={handleClose}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-navy-400 hover:text-navy-200 hover:bg-navy-800 transition-colors"
                    aria-label="Close"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-navy-200">Candidate name</label>
                    <input
                      ref={firstInputRef}
                      name="candidateName"
                      type="text"
                      required
                      placeholder="Jane Smith"
                      className="input-field focus-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-navy-200">Candidate email</label>
                    <input
                      name="candidateEmail"
                      type="email"
                      required
                      placeholder="jane@example.com"
                      className="input-field focus-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-navy-200">Interview date & time</label>
                    <input
                      name="scheduledAt"
                      type="datetime-local"
                      required
                      className="input-field focus-ring"
                      style={{ colorScheme: "dark" }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-navy-200">Meeting link</label>
                    <input
                      name="meetingLink"
                      type="url"
                      required
                      placeholder="https://zoom.us/j/..."
                      className="input-field focus-ring"
                    />
                  </div>

                  {/* Send email checkbox */}
                  <label className="flex items-start gap-3 p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] cursor-pointer hover:border-[var(--border-default)] transition-colors">
                    <input
                      type="checkbox"
                      checked={sendEmail}
                      onChange={(e) => setSendEmail(e.target.checked)}
                      className="mt-0.5 accent-[var(--color-trust)]"
                    />
                    <div>
                      <p className="text-sm font-medium text-navy-200">Send invite email to candidate</p>
                      <p className="text-xs text-navy-500 mt-0.5">TrueSelf will email the session code and instructions. Uncheck to copy and send yourself.</p>
                    </div>
                  </label>

                  {formError && (
                    <p className="text-sm text-critical-light flex items-center gap-1.5">
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="shrink-0">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {formError}
                    </p>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="btn-secondary !w-auto flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="btn-primary flex-1"
                    >
                      {isPending ? "Creating…" : "Create session"}
                    </button>
                  </div>
                </form>
              </>
            )}

            {step === "success" && session && (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-9 h-9 rounded-xl bg-trust/10 flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-trust">
                      <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">Session created</h2>
                    <p className="text-sm text-navy-400 mt-0.5">for {session.candidateName}</p>
                  </div>
                </div>

                {/* Session code */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-navy-800/60 border border-[var(--border-default)] mb-4">
                  <div>
                    <p className="text-xs text-navy-500 uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-mono)" }}>Session code</p>
                    <p className="text-3xl font-bold tracking-[0.2em] text-trust" style={{ fontFamily: "var(--font-mono)" }}>
                      {session.sessionCode}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(session.sessionCode);
                      setCopyState("copied");
                      setTimeout(() => setCopyState("idle"), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-700 hover:bg-navy-600 transition-colors"
                  >
                    {copyState === "copied" ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-trust"><path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Copied
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>

                {/* Copy invite text */}
                <div className="p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-navy-200">Copy invite text</p>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-700 hover:bg-navy-600 transition-colors"
                    >
                      {copyState === "copied" ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-navy-500 leading-relaxed" style={{ fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
                    {buildInviteText(session, companyName).slice(0, 120)}…
                  </p>
                  <p className="text-xs text-navy-600 mt-1">Paste into your Zoom/Teams/Calendar invite</p>
                </div>

                {/* Email status / send button */}
                <div className="p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] mb-6">
                  {emailState === "sent" && (
                    <div className="flex items-center gap-2 text-sm text-trust">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Invite sent to {session.candidateEmail}
                    </div>
                  )}
                  {emailState === "idle" && (
                    <>
                      <p className="text-sm text-navy-400 mb-2">Send invite email via TrueSelf</p>
                      <button
                        onClick={handleSendEmail}
                        className="btn-primary !w-auto !px-4 !py-2 text-sm"
                      >
                        Send email to {session.candidateEmail}
                      </button>
                    </>
                  )}
                  {emailState === "sending" && (
                    <p className="text-sm text-navy-400">Sending…</p>
                  )}
                  {emailState === "error" && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-critical-light">Email failed to send</p>
                      <button
                        onClick={handleSendEmail}
                        className="text-xs text-navy-300 underline hover:text-navy-100"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleDone}
                  className="btn-primary"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd apps/web && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/new-session-modal.tsx
  git commit -m "feat(web): add NewSessionModal two-step component"
  ```

---

## Task 7: Sessions Content Client Component

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx`

- [ ] **Step 1: Create `apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx`**

  ```tsx
  'use client'

  import { useState } from "react";
  import { useRouter } from "next/navigation";
  import { NewSessionModal } from "@/components/new-session-modal";
  import { resendInvite } from "@/actions/sessions";
  import type { SessionListItem } from "@trueself/shared-types";

  interface SessionsContentProps {
    initialSessions: SessionListItem[];
    companyName: string;
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
  }: {
    session: SessionListItem;
    onResend: (id: string) => void;
  }) {
    const [codeCopied, setCodeCopied] = useState(false);

    function copyCode() {
      navigator.clipboard.writeText(session.sessionCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
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
      <div className="flex items-center justify-between p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors">
        <div className="flex items-center gap-4 min-w-0">
          {/* Candidate info */}
          <div className="min-w-0">
            <p className="text-sm font-medium text-navy-100 truncate">{session.candidateName}</p>
            <p className="text-xs text-navy-500 truncate">{session.candidateEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-6 shrink-0 ml-4">
          {/* Scheduled date */}
          <div className="text-right hidden sm:block">
            <p className="text-xs text-navy-300">{formattedDate}</p>
            <p className="text-xs text-navy-500">{formattedTime}</p>
          </div>

          {/* Session code */}
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

          {/* Status */}
          <StatusBadge status={session.status} />

          {/* Actions */}
          {session.status === "pending" && (
            <button
              onClick={() => onResend(session.id)}
              className="text-xs text-navy-400 hover:text-navy-200 transition-colors whitespace-nowrap"
            >
              Resend invite
            </button>
          )}
        </div>
      </div>
    );
  }

  export function SessionsContent({ initialSessions, companyName }: SessionsContentProps) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<TabKey>("upcoming");
    const [modalOpen, setModalOpen] = useState(false);
    const [resendingId, setResendingId] = useState<string | null>(null);
    const [resendToast, setResendToast] = useState<string | null>(null);

    const tabs: TabKey[] = ["upcoming", "active", "completed"];

    const filtered = initialSessions.filter(
      (s) => STATUS_TAB[s.status] === activeTab
    );

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

    return (
      <>
        <NewSessionModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
          companyName={companyName}
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
                  onClick={() => setActiveTab(tab)}
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
            <div className="space-y-2">
              {filtered.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onResend={resendingId === session.id ? () => {} : handleResend}
                />
              ))}
            </div>
          )}
        </div>
      </>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd apps/web && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/app/(dashboard)/dashboard/sessions/sessions-content.tsx
  git commit -m "feat(web): add SessionsContent client component with tabs and session list"
  ```

---

## Task 8: Update Sessions Page (Server Component)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx`

- [ ] **Step 1: Replace the entire content of `apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx`**

  ```tsx
  import { redirect } from "next/navigation";
  import { getAuthUser, getSession } from "@/lib/session";
  import { API_URL } from "@/lib/constants";
  import { SessionsContent } from "./sessions-content";
  import type { SessionListItem } from "@trueself/shared-types";

  async function fetchSessions(apiToken: string): Promise<SessionListItem[]> {
    try {
      const res = await fetch(`${API_URL}/api/sessions`, {
        headers: { Authorization: `Bearer ${apiToken}` },
        cache: "no-store",
      });
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  }

  export default async function SessionsPage() {
    const user = await getAuthUser();
    const session = await getSession();

    if (!user || !session) {
      redirect("/login");
    }

    const sessions = await fetchSessions(session.apiToken);

    return (
      <SessionsContent
        initialSessions={sessions}
        companyName={user.companyName}
      />
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd apps/web && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Start both server and web, and do a full end-to-end manual test**

  In one terminal:
  ```bash
  pnpm dev:server
  ```

  In another terminal:
  ```bash
  pnpm dev:web
  ```

  Open http://localhost:3000/dashboard/sessions in a browser.

  **Verify:**
  - [ ] Sessions page loads with tabs (Upcoming / Active / Completed) and empty state
  - [ ] "New session" button opens the modal
  - [ ] Form has all four fields + checkbox
  - [ ] Submitting with "Send invite email" checked creates session and transitions to success step
  - [ ] Session code is displayed large and copyable
  - [ ] "Copy invite text" copies pre-formatted plain text to clipboard
  - [ ] If RESEND_API_KEY is set: candidate receives email. If not: check server logs for `[email] No RESEND_API_KEY set`.
  - [ ] Clicking "Done" closes modal and session appears in Upcoming tab
  - [ ] Session code in the row is clickable and copies to clipboard
  - [ ] "Resend invite" link appears in Upcoming rows and triggers the resend endpoint

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/app/(dashboard)/dashboard/sessions/page.tsx
  git commit -m "feat(web): update sessions page to fetch and display real session list"
  ```

---

## Summary

All commits in order:
1. `feat(shared-types): add session creation and list types`
2. `feat(server): add Resend email library for candidate invites`
3. `feat(server): add sessions router with create, list, resend-email`
4. `feat(server): mount sessions router, keep unauthenticated agent stubs`
5. `feat(web): add session server actions (createSession, resendInvite)`
6. `feat(web): add NewSessionModal two-step component`
7. `feat(web): add SessionsContent client component with tabs and session list`
8. `feat(web): update sessions page to fetch and display real session list`
