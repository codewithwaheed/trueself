import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { API_URL } from "@/lib/constants";
import { SessionsContent } from "./sessions-content";
import type { SessionListItem } from "@trueself/shared-types";

async function fetchSessions(apiToken: string): Promise<SessionListItem[]> {
  try {
    const res = await fetch(`${API_URL}/api/sessions`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: "no-store",
    });
    if (res.status === 401) redirect("/login");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function SessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const sessions = await fetchSessions(session.apiToken);

  return (
    <SessionsContent
      initialSessions={sessions}
      companyName={session.companyName}
      currentUserId={session.userId}
      currentUserName={session.userName}
    />
  );
}
