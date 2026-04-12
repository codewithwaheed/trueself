import "server-only";
import { API_URL } from "./constants";
import { getSession } from "./session";

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const session = await getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (session?.apiToken) {
    headers["Authorization"] = `Bearer ${session.apiToken}`;
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
}
