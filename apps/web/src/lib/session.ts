import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "./constants";
import type { AuthUser } from "@trueself/shared-types";

// This secret must match the server's JWT_SECRET for token verification
const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const encodedKey = new TextEncoder().encode(SECRET);

export interface WebSessionPayload {
  userId: string;
  role: string;
  companyId: string;
  // The API token to pass to server requests
  apiToken: string;
  // Cached user info to avoid DB calls in middleware
  userName: string;
  userEmail: string;
  companyName: string;
  emailVerified: boolean;
  onboardingComplete: boolean;
}

export async function encryptSession(
  payload: WebSessionPayload
): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

export async function decryptSession(
  session: string
): Promise<WebSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload as unknown as WebSessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(
  user: AuthUser,
  apiToken: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encryptSession({
    userId: user.id,
    role: user.role,
    companyId: user.companyId,
    apiToken,
    userName: user.name,
    userEmail: user.email,
    companyName: user.companyName,
    emailVerified: user.emailVerified,
    onboardingComplete: user.onboardingComplete,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "lax",
    path: "/",
  });
}

export async function getSession(): Promise<WebSessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  return decryptSession(sessionCookie);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await getSession();
  if (!session) return null;

  return {
    id: session.userId,
    email: session.userEmail,
    name: session.userName,
    role: session.role as AuthUser["role"],
    companyId: session.companyId,
    companyName: session.companyName,
    emailVerified: session.emailVerified,
    onboardingComplete: session.onboardingComplete,
  };
}
