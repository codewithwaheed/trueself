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
