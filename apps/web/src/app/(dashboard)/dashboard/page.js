import { redirect } from "next/navigation";
import { getAuthUser, getSession } from "@/lib/session";
import { OnboardingWizard } from "@/components/onboarding-wizard";
async function getStats(apiToken) {
    try {
        // For now, return placeholder stats. In production, these would come from API endpoints.
        return {
            totalSessions: 0,
            activeSessions: 0,
            teamMembers: 0,
            avgTrustScore: 0,
        };
    }
    catch {
        return {
            totalSessions: 0,
            activeSessions: 0,
            teamMembers: 0,
            avgTrustScore: 0,
        };
    }
}
export default async function DashboardPage() {
    const user = await getAuthUser();
    const session = await getSession();
    if (!user || !session) {
        redirect("/login");
    }
    const showOnboarding = user.role === "ADMIN" && !user.onboardingComplete;
    const stats = await getStats(session.apiToken);
    return (<>
      {showOnboarding && <OnboardingWizard userName={user.name}/>}

      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            Good {getGreeting()},{" "}
            <span className="text-trust">{user.name.split(" ")[0]}</span>
          </h1>
          <p className="text-navy-400 text-sm mt-1">
            {user.role === "ADMIN"
            ? "Here's an overview of your interview integrity program."
            : "Here's your interview monitoring dashboard."}
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Sessions" value={stats.totalSessions.toString()} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15 10L19.5528 7.72361C20.2177 7.39116 21 7.87465 21 8.61803V15.382C21 16.1253 20.2177 16.6088 19.5528 16.2764L15 14M5 18H13C14.1046 18 15 17.1046 15 16V8C15 6.89543 14.1046 6 13 6H5C3.89543 6 3 6.89543 3 8V16C3 17.1046 3.89543 18 5 18Z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>}/>
          <StatCard label="Active Now" value={stats.activeSessions.toString()} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6V12L16 14" strokeLinecap="round"/>
              </svg>} highlight/>
          {user.role === "ADMIN" && (<StatCard label="Team Members" value={stats.teamMembers.toString()} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 21V19C17 16.7909 15.2091 15 13 15H5C2.79086 15 1 16.7909 1 19V21" strokeLinecap="round"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21V19C22.9986 17.177 21.765 15.5857 20 15.13" strokeLinecap="round"/>
                  <path d="M16 3.13C17.7699 3.58317 19.0078 5.17787 19.0078 7.005C19.0078 8.83213 17.7699 10.4268 16 10.88" strokeLinecap="round"/>
                </svg>}/>)}
          <StatCard label="Avg Trust Score" value={stats.avgTrustScore > 0 ? `${stats.avgTrustScore}%` : "--"} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2Z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>}/>
        </div>

        {/* Quick actions */}
        <div className="card border border-[var(--border-subtle)]">
          <h2 className="text-sm font-semibold text-navy-300 uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)" }}>
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a href="/dashboard/sessions" className="flex items-center gap-4 p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] hover:border-trust/30 hover:bg-navy-800/60 transition-all group">
              <div className="w-10 h-10 rounded-xl bg-trust/10 flex items-center justify-center group-hover:bg-trust/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-trust">
                  <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-navy-100">
                  Create session
                </p>
                <p className="text-xs text-navy-500">
                  Set up a new interview monitoring session
                </p>
              </div>
            </a>
            {user.role === "ADMIN" && (<a href="/dashboard/team" className="flex items-center gap-4 p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] hover:border-trust/30 hover:bg-navy-800/60 transition-all group">
                <div className="w-10 h-10 rounded-xl bg-navy-700 flex items-center justify-center group-hover:bg-navy-600 transition-colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-navy-300">
                    <path d="M16 21V19C16 16.7909 14.2091 15 12 15H6C3.79086 15 2 16.7909 2 19V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M19 8V14M16 11H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-navy-100">
                    Invite interviewer
                  </p>
                  <p className="text-xs text-navy-500">
                    Add a team member to your workspace
                  </p>
                </div>
              </a>)}
          </div>
        </div>

        {/* Empty state for recent sessions */}
        <div className="mt-6 card border border-[var(--border-subtle)]">
          <h2 className="text-sm font-semibold text-navy-300 uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)" }}>
            Recent Sessions
          </h2>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-navy-800/60 flex items-center justify-center mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-navy-600">
                <path d="M15 10L19.5528 7.72361C20.2177 7.39116 21 7.87465 21 8.61803V15.382C21 16.1253 20.2177 16.6088 19.5528 16.2764L15 14M5 18H13C14.1046 18 15 17.1046 15 16V8C15 6.89543 14.1046 6 13 6H5C3.89543 6 3 6.89543 3 8V16C3 17.1046 3.89543 18 5 18Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-sm text-navy-400 mb-1">
              No sessions yet
            </p>
            <p className="text-xs text-navy-500 max-w-xs">
              Create your first interview session to start monitoring candidate
              integrity in real-time.
            </p>
          </div>
        </div>
      </div>
    </>);
}
function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12)
        return "morning";
    if (hour < 18)
        return "afternoon";
    return "evening";
}
function StatCard({ label, value, icon, highlight, }) {
    return (<div className={`card border ${highlight
            ? "border-trust/20 bg-trust/[0.03]"
            : "border-[var(--border-subtle)]"}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold" style={{ fontFamily: "var(--font-mono)" }}>
          {label}
        </span>
        <span className={highlight ? "text-trust" : "text-navy-500"}>
          {icon}
        </span>
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
    </div>);
}
//# sourceMappingURL=page.js.map