import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "./constants";
// This secret must match the server's JWT_SECRET for token verification
const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const encodedKey = new TextEncoder().encode(SECRET);
export async function encryptSession(payload) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(encodedKey);
}
export async function decryptSession(session) {
    try {
        const { payload } = await jwtVerify(session, encodedKey, {
            algorithms: ["HS256"],
        });
        return payload;
    }
    catch {
        return null;
    }
}
export async function createSession(user, apiToken) {
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
export async function getSession() {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie)
        return null;
    return decryptSession(sessionCookie);
}
export async function deleteSession() {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
}
export async function getAuthUser() {
    const session = await getSession();
    if (!session)
        return null;
    return {
        id: session.userId,
        email: session.userEmail,
        name: session.userName,
        role: session.role,
        companyId: session.companyId,
        companyName: session.companyName,
        emailVerified: session.emailVerified,
        onboardingComplete: session.onboardingComplete,
    };
}
//# sourceMappingURL=session.js.map