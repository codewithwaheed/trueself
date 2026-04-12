'use client'

import { useState, useEffect, useTransition } from "react";
import type { SessionListItem, TeamMember, UpdateSessionRequest } from "@trueself/shared-types";
import { InviteeMultiSelect, type SelectedInvitee } from "@/components/invitee-multi-select";
import { updateSession, cancelSession, resendInvite } from "@/actions/sessions";

interface SessionDetailDrawerProps {
  session: SessionListItem | null;
  onClose: () => void;
  onChanged: () => void;
  companyName: string;
  currentUserId: string;
  teamMembers: TeamMember[];
}

function buildInviteText(session: SessionListItem, companyName: string): string {
  const date = new Date(session.scheduledAt);
  const formatted = date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return `Hi ${session.candidateName},

Your interview with ${companyName} is scheduled for ${formatted}.

Join via: ${session.meetingLink}

Before the interview, please download and install the TrueSelf integrity agent:
→ https://trueself.io/download

When prompted, enter your session code: ${session.sessionCode}

The agent runs only during your scheduled interview session. It does not access personal files or data outside the session.`;
}

export function SessionDetailDrawer({
  session,
  onClose,
  onChanged,
  companyName,
  currentUserId,
  teamMembers,
}: SessionDetailDrawerProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [codeCopied, setCodeCopied] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Edit state
  const [editScheduledAt, setEditScheduledAt] = useState("");
  const [editMeetingLink, setEditMeetingLink] = useState("");
  const [editInvitees, setEditInvitees] = useState<SelectedInvitee[]>([]);
  const [isPending, startTransition] = useTransition();

  // Reset when session changes
  useEffect(() => {
    if (session) {
      setMode("view");
      setCodeCopied(false);
      setTextCopied(false);
      setEmailState("idle");
      setShowCancelConfirm(false);
      setActionError(null);
    }
  }, [session?.id]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function enterEditMode() {
    if (!session) return;
    // Pre-populate edit fields
    const dt = new Date(session.scheduledAt);
    // datetime-local value format: YYYY-MM-DDTHH:MM
    const pad = (n: number) => String(n).padStart(2, "0");
    setEditScheduledAt(
      `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
    );
    setEditMeetingLink(session.meetingLink);
    setEditInvitees(
      session.invitees.map((i) => ({ id: i.id, name: i.name, email: i.email }))
    );
    setActionError(null);
    setMode("edit");
  }

  function handleCopyCode() {
    if (!session) return;
    navigator.clipboard.writeText(session.sessionCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }).catch(() => {});
  }

  function handleCopyText() {
    if (!session) return;
    navigator.clipboard.writeText(buildInviteText(session, companyName)).then(() => {
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    }).catch(() => {});
  }

  async function handleSendEmail() {
    if (!session) return;
    setEmailState("sending");
    const result = await resendInvite(session.id);
    setEmailState(result.ok ? "sent" : "error");
  }

  function handleSaveEdit() {
    if (!session) return;
    setActionError(null);

    const payload: UpdateSessionRequest = {};
    if (editScheduledAt) payload.scheduledAt = new Date(editScheduledAt).toISOString();
    if (editMeetingLink) payload.meetingLink = editMeetingLink;
    payload.inviteeIds = editInvitees
      .filter((i) => i.id !== currentUserId)
      .map((i) => i.id);

    startTransition(async () => {
      const result = await updateSession(session.id, payload);
      if (result.error) {
        setActionError(result.error);
        return;
      }
      setMode("view");
      onChanged();
    });
  }

  function handleCancel() {
    if (!session) return;
    startTransition(async () => {
      const result = await cancelSession(session.id);
      if (result.error) {
        setActionError(result.error);
        setShowCancelConfirm(false);
        return;
      }
      onChanged();
      onClose();
    });
  }

  if (!session) return null;

  const isPending_ = session.status === "pending";
  const isOwner = session.invitees.some(
    (i) => i.id === currentUserId
  );

  const date = new Date(session.scheduledAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-[480px] bg-navy-900 border-l border-[var(--border-default)] shadow-2xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] shrink-0">
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              {mode === "edit" ? "Edit session" : session.candidateName}
            </h2>
            <p className="text-sm text-navy-400 mt-0.5">
              {mode === "edit" ? `for ${session.candidateName}` : session.candidateEmail}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-navy-400 hover:text-navy-200 hover:bg-navy-800 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {mode === "view" ? (
            <>
              {/* Session info */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-widest">Session info</h3>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500">Status</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${
                      session.status === "active" ? "bg-trust/10 text-trust" :
                      session.status === "pending" ? "bg-navy-700 text-navy-300" :
                      "bg-navy-800 text-navy-400"
                    }`}>{session.status}</span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500">Scheduled</span>
                    <span className="text-xs text-navy-200">{formattedDate} at {formattedTime}</span>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500 shrink-0">Meeting link</span>
                    <a
                      href={session.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-trust hover:underline truncate ml-4"
                    >
                      {session.meetingLink}
                    </a>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <span className="text-xs text-navy-500">Session code</span>
                    <button
                      onClick={handleCopyCode}
                      className="flex items-center gap-1.5 font-bold text-trust tracking-widest text-sm"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {session.sessionCode}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={codeCopied ? "text-trust" : "text-navy-500"}>
                        {codeCopied
                          ? <path d="M20 6L9 17L4 12" strokeLinecap="round" strokeLinejoin="round" />
                          : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>}
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Interviewers */}
                {session.invitees.length > 0 && (
                  <div className="p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)]">
                    <p className="text-xs text-navy-500 mb-2">Interviewers</p>
                    <div className="flex flex-wrap gap-2">
                      {session.invitees.map((inv) => (
                        <span key={inv.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-navy-700 text-navy-200 border border-[var(--border-subtle)]">
                          <span className="w-4 h-4 rounded-full bg-navy-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {inv.name.charAt(0).toUpperCase()}
                          </span>
                          {inv.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Email actions */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-widest">Invite</h3>

                <div className="p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] space-y-3">
                  {/* Preview */}
                  <p className="text-xs text-navy-500 leading-relaxed" style={{ fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
                    {buildInviteText(session, companyName).slice(0, 140)}…
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyText}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-navy-300 bg-navy-700 hover:bg-navy-600 transition-colors"
                    >
                      {textCopied ? "Copied ✓" : "Copy invite text"}
                    </button>

                    {emailState === "idle" && (
                      <button
                        onClick={handleSendEmail}
                        className="flex-1 btn-primary !py-2 text-xs"
                      >
                        Send via TrueSelf
                      </button>
                    )}
                    {emailState === "sending" && (
                      <button disabled className="flex-1 btn-primary !py-2 text-xs opacity-60">Sending…</button>
                    )}
                    {emailState === "sent" && (
                      <span className="flex-1 flex items-center justify-center gap-1 text-xs text-trust">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Sent
                      </span>
                    )}
                    {emailState === "error" && (
                      <button onClick={handleSendEmail} className="flex-1 btn-primary !py-2 text-xs">Retry send</button>
                    )}
                  </div>
                </div>
              </section>

              {/* Actions for pending + owner */}
              {isPending_ && isOwner && (
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-widest">Actions</h3>

                  {actionError && (
                    <p className="text-xs text-critical-light">{actionError}</p>
                  )}

                  {!showCancelConfirm ? (
                    <div className="flex gap-2">
                      <button
                        onClick={enterEditMode}
                        className="flex-1 btn-secondary text-sm"
                      >
                        Edit session
                      </button>
                      <button
                        onClick={() => setShowCancelConfirm(true)}
                        className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-critical-light border border-critical-light/30 hover:bg-critical-light/10 transition-colors"
                      >
                        Cancel session
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-navy-800/40 border border-critical-light/30 space-y-3">
                      <p className="text-sm text-navy-200">Cancel this session? This cannot be undone.</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowCancelConfirm(false)}
                          className="flex-1 btn-secondary text-sm"
                        >
                          Keep session
                        </button>
                        <button
                          onClick={handleCancel}
                          disabled={isPending}
                          className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-white bg-critical-light hover:opacity-90 transition-opacity disabled:opacity-60"
                        >
                          {isPending ? "Cancelling…" : "Yes, cancel"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          ) : (
            /* Edit mode */
            <section className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-navy-200">Interview date & time</label>
                <input
                  type="datetime-local"
                  value={editScheduledAt}
                  onChange={(e) => setEditScheduledAt(e.target.value)}
                  className="input-field focus-ring"
                  style={{ colorScheme: "dark" }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-navy-200">Meeting link</label>
                <input
                  type="url"
                  value={editMeetingLink}
                  onChange={(e) => setEditMeetingLink(e.target.value)}
                  className="input-field focus-ring"
                  placeholder="https://zoom.us/j/..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-navy-200">Interviewers</label>
                <InviteeMultiSelect
                  teamMembers={teamMembers}
                  selected={editInvitees}
                  currentUserId={currentUserId}
                  onChange={setEditInvitees}
                />
              </div>

              {actionError && (
                <p className="text-sm text-critical-light">{actionError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setMode("view"); setActionError(null); }}
                  className="btn-secondary flex-1"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isPending}
                  className="btn-primary flex-1"
                >
                  {isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
