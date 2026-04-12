import "server-only";
import type { AuthUser } from "@trueself/shared-types";
export interface WebSessionPayload {
    userId: string;
    role: string;
    companyId: string;
    apiToken: string;
    userName: string;
    userEmail: string;
    companyName: string;
    emailVerified: boolean;
    onboardingComplete: boolean;
}
export declare function encryptSession(payload: WebSessionPayload): Promise<string>;
export declare function decryptSession(session: string): Promise<WebSessionPayload | null>;
export declare function createSession(user: AuthUser, apiToken: string): Promise<void>;
export declare function getSession(): Promise<WebSessionPayload | null>;
export declare function deleteSession(): Promise<void>;
export declare function getAuthUser(): Promise<AuthUser | null>;
//# sourceMappingURL=session.d.ts.map