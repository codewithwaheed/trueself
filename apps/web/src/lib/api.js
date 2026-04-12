import "server-only";
import { API_URL } from "./constants";
import { getSession } from "./session";
export async function apiFetch(path, options = {}) {
    const session = await getSession();
    const headers = {
        "Content-Type": "application/json",
        ...options.headers,
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
//# sourceMappingURL=api.js.map