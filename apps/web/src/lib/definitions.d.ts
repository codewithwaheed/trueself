import { z } from "zod";
export declare const SignupFormSchema: z.ZodObject<{
    name: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
    companyName: z.ZodString;
}, z.core.$strip>;
export declare const LoginFormSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export declare const InviteFormSchema: z.ZodObject<{
    email: z.ZodString;
    name: z.ZodString;
}, z.core.$strip>;
export declare const AcceptInviteFormSchema: z.ZodObject<{
    token: z.ZodString;
    name: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type AuthFormState = {
    errors?: Record<string, string[]>;
    message?: string;
    success?: boolean;
} | undefined;
//# sourceMappingURL=definitions.d.ts.map