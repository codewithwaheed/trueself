'use server';
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SignupFormSchema, LoginFormSchema, AcceptInviteFormSchema, InviteFormSchema, } from "@/lib/definitions";
import { createSession, deleteSession, getSession } from "@/lib/session";
import { API_URL } from "@/lib/constants";
export async function signup(state, formData) {
    const parsed = SignupFormSchema.safeParse({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
        companyName: formData.get("companyName"),
    });
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }
    const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
        const err = await res.json();
        return { message: err.error || "Signup failed. Please try again." };
    }
    const data = await res.json();
    await createSession(data.user, data.token);
    redirect("/dashboard");
}
export async function login(state, formData) {
    const parsed = LoginFormSchema.safeParse({
        email: formData.get("email"),
        password: formData.get("password"),
    });
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }
    const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
        const err = await res.json();
        return { message: err.error || "Invalid email or password." };
    }
    const data = await res.json();
    await createSession(data.user, data.token);
    redirect("/dashboard");
}
export async function logout() {
    await deleteSession();
    redirect("/login");
}
export async function acceptInvite(state, formData) {
    const parsed = AcceptInviteFormSchema.safeParse({
        token: formData.get("token"),
        name: formData.get("name"),
        password: formData.get("password"),
    });
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }
    const res = await fetch(`${API_URL}/api/auth/invitations/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
        const err = await res.json();
        return { message: err.error || "Failed to accept invitation." };
    }
    const data = await res.json();
    await createSession(data.user, data.token);
    redirect("/dashboard");
}
export async function sendInvite(state, formData) {
    const parsed = InviteFormSchema.safeParse({
        email: formData.get("email"),
        name: formData.get("name"),
    });
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }
    const session = await getSession();
    if (!session) {
        return { message: "You must be logged in." };
    }
    const res = await fetch(`${API_URL}/api/auth/invitations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.apiToken}`,
        },
        body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
        const err = await res.json();
        return { message: err.error || "Failed to send invitation." };
    }
    revalidatePath("/dashboard/team");
    return { success: true, message: "Invitation sent successfully!" };
}
export async function completeOnboarding() {
    const session = await getSession();
    if (!session) {
        redirect("/login");
    }
    const res = await fetch(`${API_URL}/api/auth/onboarding-complete`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.apiToken}`,
        },
    });
    if (!res.ok) {
        redirect("/dashboard");
    }
    // Refresh the session cookie with updated onboarding status
    // Fetch fresh user data from the API to rebuild the session
    const meRes = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
            Authorization: `Bearer ${session.apiToken}`,
        },
    });
    if (meRes.ok) {
        const { user } = await meRes.json();
        await createSession(user, session.apiToken);
    }
    redirect("/dashboard");
}
//# sourceMappingURL=auth.js.map