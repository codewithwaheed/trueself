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
