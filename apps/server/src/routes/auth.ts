import { Hono } from "hono";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@trueself/db";
import type { AuthUser, AuthResponse } from "@trueself/shared-types";
import { signToken, requireAuth, requireAdmin } from "../middleware/auth";

type AuthVariables = {
  userId: string;
  userRole: string;
  companyId: string;
};

const auth = new Hono<{ Variables: AuthVariables }>();

// ---- Zod Schemas ----

const SignupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(2),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const InviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(2),
  password: z.string().min(8),
});

// ---- Helpers ----

function toAuthUser(
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    companyId: string;
    emailVerified: boolean;
    onboardingComplete: boolean;
    company: { name: string };
  }
): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as AuthUser["role"],
    companyId: user.companyId,
    companyName: user.company.name,
    emailVerified: user.emailVerified,
    onboardingComplete: user.onboardingComplete,
  };
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    + "-" + Math.random().toString(36).slice(2, 6);
}

// ---- Routes ----

// POST /api/auth/signup
auth.post("/signup", async (c) => {
  const body = await c.req.json();
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      400
    );
  }

  const { name, email, password, companyName } = parsed.data;

  // Check if email already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Create company and admin user in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: companyName,
        slug: generateSlug(companyName),
      },
    });

    const user = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "ADMIN",
        companyId: company.id,
        emailVerified: true, // Auto-verify for MVP
      },
      include: { company: true },
    });

    return user;
  });

  const token = await signToken({
    userId: result.id,
    role: "ADMIN",
    companyId: result.companyId,
  });

  const response: AuthResponse = {
    user: toAuthUser(result),
    token,
  };

  return c.json(response, 201);
});

// POST /api/auth/login
auth.post("/login", async (c) => {
  const body = await c.req.json();
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      400
    );
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { company: true },
  });

  if (!user || !user.passwordHash) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const token = await signToken({
    userId: user.id,
    role: user.role as "ADMIN" | "INTERVIEWER",
    companyId: user.companyId,
  });

  const response: AuthResponse = {
    user: toAuthUser(user),
    token,
  };

  return c.json(response);
});

// GET /api/auth/me
auth.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId") as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: true },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user: toAuthUser(user) });
});

// POST /api/auth/invitations — Admin invites an interviewer
auth.post("/invitations", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      400
    );
  }

  const { email, name } = parsed.data;
  const companyId = c.get("companyId") as string;
  const invitedBy = c.get("userId") as string;

  // Check if user already exists in this company
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return c.json({ error: "A user with this email already exists" }, 409);
  }

  // Check for pending invitation
  const existingInvite = await prisma.invitation.findFirst({
    where: { email, companyId, status: "PENDING" },
  });
  if (existingInvite) {
    return c.json({ error: "An invitation has already been sent to this email" }, 409);
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = await prisma.invitation.create({
    data: {
      email,
      name,
      token,
      companyId,
      invitedBy,
      expiresAt,
    },
  });

  // In production, send email. For MVP, log the invite link.
  const inviteLink = `${process.env.WEB_URL || "http://localhost:3000"}/invite/${token}`;
  console.log(`[INVITE] Send to ${email}: ${inviteLink}`);

  return c.json({
    invitation: {
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      token: invitation.token,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  }, 201);
});

// GET /api/auth/invitations — List invitations for company
auth.get("/invitations", requireAuth, requireAdmin, async (c) => {
  const companyId = c.get("companyId") as string;

  const invitations = await prisma.invitation.findMany({
    where: { companyId },
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      companyName: inv.company.name,
      role: inv.role,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    })),
  });
});

// GET /api/auth/invitations/:token — Get invitation details (public)
auth.get("/invitations/:token", async (c) => {
  const token = c.req.param("token");

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { company: true },
  });

  if (!invitation) {
    return c.json({ error: "Invitation not found" }, 404);
  }

  if (invitation.status !== "PENDING") {
    return c.json({ error: "Invitation has already been used" }, 410);
  }

  if (invitation.expiresAt < new Date()) {
    // Mark as expired
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    return c.json({ error: "Invitation has expired" }, 410);
  }

  return c.json({
    invitation: {
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      companyName: invitation.company.name,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    },
  });
});

// POST /api/auth/invitations/accept — Accept invitation and create account
auth.post("/invitations/accept", async (c) => {
  const body = await c.req.json();
  const parsed = AcceptInviteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      400
    );
  }

  const { token, name, password } = parsed.data;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { company: true },
  });

  if (!invitation) {
    return c.json({ error: "Invitation not found" }, 404);
  }

  if (invitation.status !== "PENDING") {
    return c.json({ error: "Invitation has already been used" }, 410);
  }

  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    return c.json({ error: "Invitation has expired" }, 410);
  }

  // Check if email already taken
  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
  });
  if (existingUser) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invitation.email,
        name,
        passwordHash,
        role: invitation.role,
        companyId: invitation.companyId,
        emailVerified: true,
        onboardingComplete: true, // Interviewers don't need onboarding
      },
      include: { company: true },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });

    return user;
  });

  const jwtToken = await signToken({
    userId: result.id,
    role: result.role as "ADMIN" | "INTERVIEWER",
    companyId: result.companyId,
  });

  const response: AuthResponse = {
    user: toAuthUser(result),
    token: jwtToken,
  };

  return c.json(response, 201);
});

// GET /api/team — List team members for company
auth.get("/team", requireAuth, async (c) => {
  const companyId = c.get("companyId") as string;

  const members = await prisma.user.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// PATCH /api/auth/onboarding-complete — Mark onboarding as done
auth.patch("/onboarding-complete", requireAuth, async (c) => {
  const userId = c.get("userId") as string;

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingComplete: true },
  });

  return c.json({ success: true });
});

export default auth;
