import { Hono } from "hono";
import { z } from "zod";
import { prisma, SessionStatus } from "@trueself/db";
import type { SessionListItem, CreateSessionResponse, SessionDetail } from "@trueself/shared-types";
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
  scheduledAt: z.string().datetime({ message: "scheduledAt must be a valid ISO 8601 date" }),
  sendEmail: z.boolean().optional().default(false),
  inviteeIds: z.array(z.string()).optional().default([]),
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

const UpdateSessionSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  meetingLink: z.string().url("Invalid meeting URL").optional(),
  inviteeIds: z.array(z.string().min(1)).max(20).optional(),
}).refine(
  (d) => d.scheduledAt !== undefined || d.meetingLink !== undefined || d.inviteeIds !== undefined,
  { message: "At least one field must be provided" }
);

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
    select: { id: true, name: true, email: true, company: { select: { name: true } } },
  });

  if (!creatorUser) {
    return c.json({ error: "Authenticated user not found" }, 500);
  }

  const inviteeMap = new Map<string, { id: string; name: string; email: string }>();
  inviteeMap.set(creatorUser.id, { id: creatorUser.id, name: creatorUser.name, email: creatorUser.email });
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
      await sendCandidateInvite({
        to: candidateEmail,
        candidateName,
        interviewerName: creatorUser.name,
        companyName: creatorUser.company.name,
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

// GET /api/sessions — list sessions for caller
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
    interviewerId: s.interviewerId,
    invitees: s.sessionInvitees.map((si) => ({
      id: si.user.id,
      name: si.user.name,
      email: si.user.email,
    })),
  }));

  return c.json(result);
});

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

  if (session.status !== SessionStatus.PENDING) {
    return c.json({ error: "Only pending sessions can be cancelled" }, 409);
  }

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED" },
  });

  return c.json({ ok: true });
});

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

  if (session.status !== SessionStatus.PENDING) {
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

    // Replace invitees atomically: delete all then re-create
    await prisma.$transaction(async (tx) => {
      await tx.sessionInvitee.deleteMany({ where: { sessionId } });
      await tx.sessionInvitee.createMany({
        data: finalIds.map((uid) => ({ sessionId, userId: uid })),
      });
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
    interviewerId: session.interviewerId,
    invitees: session.sessionInvitees.map((si) => ({
      id: si.user.id,
      name: si.user.name,
      email: si.user.email,
    })),
  };

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
