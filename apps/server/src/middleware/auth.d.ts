import { Context, Next } from "hono";
import type { UserRole, SessionPayload } from "@trueself/shared-types";
export declare function signToken(payload: {
    userId: string;
    role: UserRole;
    companyId: string;
}): Promise<string>;
export declare function verifyToken(token: string): Promise<SessionPayload | null>;
export declare function requireAuth(c: Context, next: Next): Promise<(Response & import("hono").TypedResponse<{
    error: string;
}, 401, "json">) | undefined>;
export declare function requireAdmin(c: Context, next: Next): Promise<(Response & import("hono").TypedResponse<{
    error: string;
}, 403, "json">) | undefined>;
//# sourceMappingURL=auth.d.ts.map