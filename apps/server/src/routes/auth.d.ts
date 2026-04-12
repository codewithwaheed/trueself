import { Hono } from "hono";
type AuthVariables = {
    userId: string;
    userRole: string;
    companyId: string;
};
declare const auth: Hono<{
    Variables: AuthVariables;
}, import("hono/types").BlankSchema, "/">;
export default auth;
//# sourceMappingURL=auth.d.ts.map