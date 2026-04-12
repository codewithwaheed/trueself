import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/session";
import { apiFetch } from "@/lib/api";
import { InviteForm } from "./invite-form";
import type { TeamMember, InvitationInfo } from "@trueself/shared-types";

async function getTeamMembers(): Promise<TeamMember[]> {
  try {
    const res = await apiFetch("/api/auth/team");
    if (!res.ok) return [];
    const data = await res.json();
    return data.members ?? [];
  } catch {
    return [];
  }
}

async function getInvitations(): Promise<InvitationInfo[]> {
  try {
    const res = await apiFetch("/api/auth/invitations");
    if (!res.ok) return [];
    const data = await res.json();
    return data.invitations ?? [];
  } catch {
    return [];
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function RoleBadge({ role }: { role: string }) {
  if (role === "ADMIN") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-trust/10 text-trust border border-trust/20"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2Z" />
        </svg>
        Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-navy-800 text-navy-300 border border-[var(--border-subtle)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      Interviewer
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: "bg-warning/10 text-warning-light border-warning/20",
    ACCEPTED: "bg-trust/10 text-trust-light border-trust/20",
    EXPIRED: "bg-critical/10 text-critical-light border-critical/20",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${styles[status] ?? styles.PENDING}`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {status === "PENDING" && (
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
      )}
      {status.toLowerCase()}
    </span>
  );
}

export default async function TeamPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const [members, invitations] = await Promise.all([
    getTeamMembers(),
    getInvitations(),
  ]);

  const pendingInvitations = invitations.filter((i) => i.status === "PENDING");
  const pastInvitations = invitations.filter((i) => i.status !== "PENDING");

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-navy-400 text-sm mt-1">
          Manage interviewers and invitations for{" "}
          <span className="text-navy-300">{user.companyName}</span>.
        </p>
      </div>

      {/* Invite form */}
      <div className="mb-8 animate-fade-in">
        <InviteForm />
      </div>

      {/* Team members table */}
      <div className="card border border-[var(--border-subtle)] mb-6 animate-fade-in-delay-1">
        <div className="flex items-center justify-between mb-5">
          <h2
            className="text-[10px] font-semibold text-navy-400 uppercase tracking-widest"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Team members
          </h2>
          <span
            className="text-[10px] text-navy-500 tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </div>

        {members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-navy-800/60 flex items-center justify-center mb-3">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                className="text-navy-600"
              >
                <path
                  d="M17 21V19C17 16.7909 15.2091 15 13 15H5C2.79086 15 1 16.7909 1 19V21"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <p className="text-sm text-navy-400">No team members yet</p>
            <p className="text-xs text-navy-500 mt-1">
              Invite your first interviewer above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th
                    className="text-left text-[10px] font-semibold text-navy-500 uppercase tracking-wider pb-3 pr-4"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    Name
                  </th>
                  <th
                    className="text-left text-[10px] font-semibold text-navy-500 uppercase tracking-wider pb-3 pr-4"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    Email
                  </th>
                  <th
                    className="text-left text-[10px] font-semibold text-navy-500 uppercase tracking-wider pb-3 pr-4"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    Role
                  </th>
                  <th
                    className="text-right text-[10px] font-semibold text-navy-500 uppercase tracking-wider pb-3"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-[var(--border-subtle)] last:border-0 group"
                  >
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-navy-800 border border-[var(--border-subtle)] flex items-center justify-center text-xs font-bold text-navy-300 uppercase shrink-0 group-hover:border-trust/20 transition-colors">
                          {member.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-navy-100 truncate">
                          {member.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 pr-4">
                      <span
                        className="text-sm text-navy-400 truncate block max-w-[200px]"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {member.email}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="py-3.5 text-right">
                      <span
                        className="text-xs text-navy-500 tabular-nums"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {formatDate(member.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending invitations */}
      {pendingInvitations.length > 0 && (
        <div className="card border border-warning/10 mb-6 animate-fade-in-delay-2">
          <div className="flex items-center justify-between mb-5">
            <h2
              className="text-[10px] font-semibold text-navy-400 uppercase tracking-widest"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Pending invitations
            </h2>
            <span
              className="text-[10px] text-warning tabular-nums"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {pendingInvitations.length} pending
            </span>
          </div>

          <div className="space-y-2">
            {pendingInvitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-3 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)] hover:border-warning/10 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center shrink-0">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="text-warning"
                    >
                      <path
                        d="M3 8L10.89 13.26C11.2187 13.4793 11.6049 13.5963 12 13.5963C12.3951 13.5963 12.7813 13.4793 13.11 13.26L21 8M5 19H19C20.1046 19 21 17.1046 21 17V7C21 5.89543 20.1046 5 19 5H5C3.89543 5 3 5.89543 3 7V17C3 17.1046 3.89543 19 5 19Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy-200 truncate">
                      {inv.name || inv.email}
                    </p>
                    <p
                      className="text-xs text-navy-500 truncate"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {inv.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <StatusBadge status={inv.status} />
                  <span
                    className="text-[10px] text-navy-600"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    expires {formatDate(inv.expiresAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past invitations */}
      {pastInvitations.length > 0 && (
        <div className="card border border-[var(--border-subtle)] animate-fade-in-delay-3">
          <div className="flex items-center justify-between mb-5">
            <h2
              className="text-[10px] font-semibold text-navy-400 uppercase tracking-widest"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Invitation history
            </h2>
            <span
              className="text-[10px] text-navy-600 tabular-nums"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {pastInvitations.length} past
            </span>
          </div>

          <div className="space-y-2">
            {pastInvitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-3 rounded-xl bg-navy-800/20 border border-[var(--border-subtle)]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-navy-800/60 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-navy-500 uppercase">
                      {(inv.name || inv.email).charAt(0)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-navy-300 truncate">
                      {inv.name || inv.email}
                    </p>
                    <p
                      className="text-xs text-navy-600 truncate"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {inv.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <StatusBadge status={inv.status} />
                  <span
                    className="text-[10px] text-navy-600 tabular-nums"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {formatDate(inv.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
