'use client'

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { NewSessionModal } from "@/components/new-session-modal";
import { SessionDetailDrawer } from "@/components/session-detail-drawer";
import { resendInvite, getTeamMembers } from "@/actions/sessions";
import type { SessionListItem, TeamMember } from "@trueself/shared-types";

const PAGE_SIZE = 10;

interface SessionsContentProps {
  initialSessions: SessionListItem[];
  companyName: string;
  currentUserId: string;
  currentUserName: string;
}

type TabKey = "upcoming" | "active" | "completed";

const STATUS_TAB: Record<SessionListItem["status"], TabKey> = {
  pending: "upcoming",
  active: "active",
  completed: "completed",
  cancelled: "completed",
};

const TAB_LABELS: Record<TabKey, string> = {
  upcoming: "Upcoming",
  active: "Active",
  completed: "Completed",
};

function StatusBadge({ status }: { status: SessionListItem["status"] }) {
  const styles: Record<SessionListItem["status"], string> = {
    pending: "bg-navy-700 text-navy-300",
    active: "bg-trust/10 text-trust",
    completed: "bg-navy-800 text-navy-400",
    cancelled: "bg-navy-800 text-navy-600",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${styles[status]}`}>
      {status}
    </span>
  );
}

function SessionRow({
  session,
  onResend,
  resending,
  onClick,
}: {
  session: SessionListItem;
  onResend: (id: string) => void;
  resending?: boolean;
  onClick: (session: SessionListItem) => void;
}) {
  const [codeCopied, setCodeCopied] = useState(false);

  function copyCode(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(session.sessionCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(() => {});
  }

  const date = new Date(session.scheduledAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      onClick={() => onClick(session)}
      className="flex items-center justify-between p-4 rounded-xl bg-navy-800/30 border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-navy-100 truncate">{session.candidateName}</p>
          <p className="text-xs text-navy-500 truncate">{session.candidateEmail}</p>
        </div>
      </div>

      <div className="flex items-center gap-6 shrink-0 ml-4">
        <div className="text-right hidden sm:block">
          <p className="text-xs text-navy-300">{formattedDate}</p>
          <p className="text-xs text-navy-500">{formattedTime}</p>
        </div>

        <button
          onClick={copyCode}
          title="Copy session code"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-navy-800 border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors"
        >
          <span className="text-xs font-bold text-trust tracking-widest" style={{ fontFamily: "var(--font-mono)" }}>
            {session.sessionCode}
          </span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={codeCopied ? "text-trust" : "text-navy-500"}>
            {codeCopied
              ? <path d="M20 6L9 17L4 12" strokeLinecap="round" strokeLinejoin="round" />
              : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>
            }
          </svg>
        </button>

        <StatusBadge status={session.status} />

        {session.status === "pending" && (
          <button
            onClick={(e) => { e.stopPropagation(); onResend(session.id); }}
            disabled={resending}
            className="text-xs text-navy-400 hover:text-navy-200 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Resend invite
          </button>
        )}

        {/* Right arrow affordance */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-navy-600 shrink-0">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function SessionsContent({
  initialSessions,
  companyName,
  currentUserId,
  currentUserName,
}: SessionsContentProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerSession, setDrawerSession] = useState<SessionListItem | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendToast, setResendToast] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const tabs: TabKey[] = ["upcoming", "active", "completed"];

  const filtered = useMemo(
    () => initialSessions.filter((s) => STATUS_TAB[s.status] === activeTab),
    [initialSessions, activeTab]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab);
    setPage(1);
  }

  async function handleResend(sessionId: string) {
    setResendingId(sessionId);
    const result = await resendInvite(sessionId);
    setResendingId(null);
    setResendToast(result.ok ? "Invite resent" : (result.error ?? "Failed to resend"));
    setTimeout(() => setResendToast(null), 3000);
  }

  function handleCreated() {
    router.refresh();
  }

  function handleChanged() {
    router.refresh();
  }

  async function handleOpenDrawer(session: SessionListItem) {
    setDrawerSession(session);
    // Lazy-load team members on first drawer open
    if (teamMembers.length === 0) {
      try {
        const members = await getTeamMembers();
        setTeamMembers(members);
      } catch {
        // drawer opens without team member search; user can still view session details
      }
    }
  }

  return (
    <>
      <NewSessionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
        companyName={companyName}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
      />

      <SessionDetailDrawer
        session={drawerSession}
        onClose={() => setDrawerSession(null)}
        onChanged={handleChanged}
        companyName={companyName}
        currentUserId={currentUserId}
        teamMembers={teamMembers}
      />

      {/* Toast */}
      {resendToast && (
        <div className="fixed bottom-6 right-6 z-40 px-4 py-2.5 rounded-xl bg-navy-800 border border-[var(--border-default)] text-sm text-navy-200 shadow-xl animate-fade-in">
          {resendToast}
        </div>
      )}

      <div className="max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
            <p className="text-navy-400 text-sm mt-1">Monitor and manage your interview sessions.</p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="btn-primary !w-auto !px-5 gap-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5V19M5 12H19" />
            </svg>
            New session
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] w-fit mb-6">
          {tabs.map((tab) => {
            const count = initialSessions.filter((s) => STATUS_TAB[s.status] === tab).length;
            return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab
                    ? "bg-navy-700 text-navy-100 shadow-sm"
                    : "text-navy-400 hover:text-navy-300"
                }`}
              >
                {TAB_LABELS[tab]}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-md ${
                    activeTab === tab ? "bg-navy-600 text-navy-300" : "bg-navy-800 text-navy-500"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Session list */}
        {filtered.length === 0 ? (
          <div className="card border border-[var(--border-subtle)]">
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-16 h-16 rounded-2xl bg-navy-800/60 flex items-center justify-center mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-navy-600">
                  <path d="M15 10L19.5528 7.72361C20.2177 7.39116 21 7.87465 21 8.61803V15.382C21 16.1253 20.2177 16.6088 19.5528 16.2764L15 14M5 18H13C14.1046 18 15 17.1046 15 16V8C15 6.89543 14.1046 6 13 6H5C3.89543 6 3 6.89543 3 8V16C3 17.1046 3.89543 18 5 18Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-navy-300 mb-1">
                {activeTab === "upcoming" ? "No upcoming sessions" : activeTab === "active" ? "No active sessions" : "No completed sessions"}
              </p>
              <p className="text-xs text-navy-500 max-w-xs">
                {activeTab === "upcoming"
                  ? "Create a session to start monitoring candidate integrity."
                  : activeTab === "active"
                  ? "Sessions become active when the candidate connects the TrueSelf agent."
                  : "Completed sessions will appear here with trust reports."}
              </p>
              {activeTab === "upcoming" && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="btn-primary !w-auto !px-5 mt-5"
                >
                  Create session
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {paginated.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onResend={handleResend}
                  resending={resendingId === session.id}
                  onClick={handleOpenDrawer}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-1">
                <p className="text-xs text-navy-500">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-800 border border-[var(--border-subtle)] hover:border-[var(--border-default)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-800 border border-[var(--border-subtle)] hover:border-[var(--border-default)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
