import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/session";
export default async function SettingsPage() {
    const user = await getAuthUser();
    if (!user) {
        redirect("/login");
    }
    if (user.role !== "ADMIN") {
        redirect("/dashboard");
    }
    return (<div className="max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-navy-400 text-sm mt-1">
          Manage your workspace settings and preferences.
        </p>
      </div>

      {/* Company info */}
      <div className="card border border-[var(--border-subtle)] mb-6 animate-fade-in">
        <h2 className="text-[10px] font-semibold text-navy-400 uppercase tracking-widest mb-5" style={{ fontFamily: "var(--font-mono)" }}>
          Workspace
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)]">
            <div>
              <p className="text-xs text-navy-500 mb-1" style={{ fontFamily: "var(--font-mono)" }}>
                Company name
              </p>
              <p className="text-sm font-medium text-navy-100">
                {user.companyName}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-navy-800 border border-[var(--border-subtle)] flex items-center justify-center text-sm font-bold text-navy-400 uppercase">
              {user.companyName.charAt(0)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)]">
            <p className="text-xs text-navy-500 mb-1" style={{ fontFamily: "var(--font-mono)" }}>
              Plan
            </p>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-navy-100">Free Tier</p>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-trust/10 text-trust border border-trust/20" style={{ fontFamily: "var(--font-mono)" }}>
                Active
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Account info */}
      <div className="card border border-[var(--border-subtle)] mb-6 animate-fade-in-delay-1">
        <h2 className="text-[10px] font-semibold text-navy-400 uppercase tracking-widest mb-5" style={{ fontFamily: "var(--font-mono)" }}>
          Account
        </h2>

        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)]">
            <p className="text-xs text-navy-500 mb-1" style={{ fontFamily: "var(--font-mono)" }}>
              Name
            </p>
            <p className="text-sm font-medium text-navy-100">{user.name}</p>
          </div>

          <div className="p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)]">
            <p className="text-xs text-navy-500 mb-1" style={{ fontFamily: "var(--font-mono)" }}>
              Email
            </p>
            <p className="text-sm text-navy-200" style={{ fontFamily: "var(--font-mono)" }}>
              {user.email}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)]">
            <p className="text-xs text-navy-500 mb-1" style={{ fontFamily: "var(--font-mono)" }}>
              Role
            </p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-trust/10 text-trust border border-trust/20" style={{ fontFamily: "var(--font-mono)" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2Z"/>
              </svg>
              {user.role}
            </span>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="card border border-critical/10 animate-fade-in-delay-2">
        <h2 className="text-[10px] font-semibold text-critical uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)" }}>
          Danger zone
        </h2>
        <p className="text-sm text-navy-400 mb-4">
          Permanently delete your workspace and all associated data. This action
          cannot be undone.
        </p>
        <button disabled className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-critical/50 bg-critical/5 border border-critical/10 cursor-not-allowed">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6M8 6V4C8 2.89543 8.89543 2 10 2H14C15.1046 2 16 2.89543 16 4V6"/>
          </svg>
          Delete workspace
        </button>
      </div>
    </div>);
}
//# sourceMappingURL=page.js.map