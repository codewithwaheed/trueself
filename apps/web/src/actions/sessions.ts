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
