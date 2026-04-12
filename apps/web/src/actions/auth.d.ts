import { type AuthFormState } from "@/lib/definitions";
export declare function signup(state: AuthFormState, formData: FormData): Promise<AuthFormState>;
export declare function login(state: AuthFormState, formData: FormData): Promise<AuthFormState>;
export declare function logout(): Promise<void>;
export declare function acceptInvite(state: AuthFormState, formData: FormData): Promise<AuthFormState>;
export declare function sendInvite(state: AuthFormState, formData: FormData): Promise<AuthFormState>;
export declare function completeOnboarding(): Promise<void>;
//# sourceMappingURL=auth.d.ts.map