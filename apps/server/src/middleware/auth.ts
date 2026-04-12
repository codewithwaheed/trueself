import { Context, Next } from "hono";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole, SessionPayload } from "@trueself/shared-types";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const encodedKey = new TextEncoder().encode(JWT_SECRET);

export async function signToken(payload: {
  userId: string;
  role: UserRole;
  companyId: string;
}): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

export async function verifyToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// Hono middleware that requires a valid JWT Bearer token
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const token = header.slice(7);
  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("userId", payload.userId);
  c.set("userRole", payload.role);
  c.set("companyId", payload.companyId);
  await next();
}

// Middleware that requires ADMIN role
export async function requireAdmin(c: Context, next: Next) {
  const role = c.get("userRole");
  if (role !== "ADMIN") {
    return c.json({ error: "Admin access required" }, 403);
  }
  await next();
}
