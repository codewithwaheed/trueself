import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/session";
export default async function SessionsPage() {
    const user = await getAuthUser();
    if (!user) {
        redirect("/login");
    }
    return (<div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
          <p className="text-navy-400 text-sm mt-1">
            Monitor and manage your interview sessions.
          </p>
        </div>
        <button className="btn-primary !w-auto !px-5 gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5V19M5 12H19"/>
          </svg>
          New session
        </button>
      </div>

      {/* Empty state */}
      <div className="card border border-[var(--border-subtle)] animate-fade-in">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 rounded-2xl bg-navy-800/60 flex items-center justify-center mb-5">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-navy-600">
              <path d="M15 10L19.5528 7.72361C20.2177 7.39116 21 7.87465 21 8.61803V15.382C21 16.1253 20.2177 16.6088 19.5528 16.2764L15 14M5 18H13C14.1046 18 15 17.1046 15 16V8C15 6.89543 14.1046 6 13 6H5C3.89543 6 3 6.89543 3 8V16C3 17.1046 3.89543 18 5 18Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-navy-200 mb-1">
            No sessions yet
          </h2>
          <p className="text-sm text-navy-400 max-w-sm mb-6">
            Create your first interview monitoring session to start verifying
            candidate integrity in real-time.
          </p>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
            <div className="flex gap-2">
              {["Create session", "Share code with candidate", "Monitor live"].map((step, i) => (<div key={step} className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-navy-700 flex items-center justify-center text-[10px] font-bold text-navy-400" style={{ fontFamily: "var(--font-mono)" }}>
                      {i + 1}
                    </span>
                    <span className="text-xs text-navy-400">{step}</span>
                    {i < 2 && (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-navy-600">
                        <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>)}
                  </div>))}
            </div>
          </div>
        </div>
      </div>
    </div>);
}
//# sourceMappingURL=page.js.map