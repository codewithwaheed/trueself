import { Hono } from "hono";
type AuthVariables = {
    userId: string;
    userRole: string;
    companyId: string;
};
declare const sessions: Hono<{
    Variables: AuthVariables;
}, import("hono/types").BlankSchema, "/">;
export default sessions;
//# sourceMappingURL=sessions.d.ts.map