'use client'

import { useState, useTransition, useEffect, useRef } from "react";
import { createSession, resendInvite, getTeamMembers } from "@/actions/sessions";
import type { CreateSessionResponse, TeamMember } from "@trueself/shared-types";
import { InviteeMultiSelect, type SelectedInvitee } from "@/components/invitee-multi-select";

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  companyName: string;
  currentUserId: string;
  currentUserName: string;
}

function buildInviteText(
  session: CreateSessionResponse,
  companyName: string
): string {
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

export function NewSessionModal({ open, onClose, onCreated, companyName, currentUserId, currentUserName }: NewSessionModalProps) {
  const [step, setStep] = useState<"form" | "success">("form");
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [codeCopyState, setCodeCopyState] = useState<"idle" | "copied">("idle");
  const [textCopyState, setTextCopyState] = useState<"idle" | "copied">("idle");
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [isPending, startTransition] = useTransition();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedInvitees, setSelectedInvitees] = useState<SelectedInvitee[]>([]);
  const [plannedDurationMinutes, setPlannedDurationMinutes] = useState<number>(60);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep("form");
      setSession(null);
      setFormError(null);
      setCodeCopyState("idle");
      setTextCopyState("idle");
      setEmailState("idle");
      setSendEmail(true);
      setPlannedDurationMinutes(60);
      setSelectedInvitees([{ id: currentUserId, name: currentUserName, email: "" }]);
      getTeamMembers().then(setTeamMembers);
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function handleClose() {
    onClose();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = e.currentTarget;
    const rawScheduled = (form.elements.namedItem("scheduledAt") as HTMLInputElement).value;

    const data = {
      candidateName: (form.elements.namedItem("candidateName") as HTMLInputElement).value.trim(),
      candidateEmail: (form.elements.namedItem("candidateEmail") as HTMLInputElement).value.trim(),
      meetingLink: (form.elements.namedItem("meetingLink") as HTMLInputElement).value.trim(),
      scheduledAt: new Date(rawScheduled).toISOString(),
      sendEmail,
      plannedDurationMinutes,
      inviteeIds: selectedInvitees
        .filter((i) => i.id !== currentUserId)
        .map((i) => i.id),
    };

    startTransition(async () => {
      const result = await createSession(data);
      if (result.error) {
        setFormError(result.error);
        return;
      }
      setSession(result.session!);
      setStep("success");
      if (sendEmail && !result.emailError) {
        setEmailState("sent");
      } else if (result.emailError) {
        setEmailState("error");
      }
    });
  }

  async function handleSendEmail() {
    if (!session) return;
    setEmailState("sending");
    const result = await resendInvite(session.id);
    setEmailState(result.ok ? "sent" : "error");
  }

  function handleCopy() {
    if (!session) return;
    const text = buildInviteText(session, companyName);
    navigator.clipboard.writeText(text).then(() => {
      setTextCopyState("copied");
      setTimeout(() => setTextCopyState("idle"), 2000);
    });
  }

  function handleDone() {
    onCreated();
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal panel */}
      <div className="relative w-full max-w-md animate-fade-in">
        <div className="card border border-[var(--border-default)] shadow-2xl">

          {step === "form" && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 id="modal-title" className="text-lg font-bold tracking-tight">New session</h2>
                  <p className="text-sm text-navy-400 mt-0.5">Set up an interview monitoring session</p>
                </div>
                <button
                  onClick={handleClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-navy-400 hover:text-navy-200 hover:bg-navy-800 transition-colors"
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-navy-200">Candidate name</label>
                  <input
                    ref={firstInputRef}
                    name="candidateName"
                    type="text"
                    required
                    placeholder="Jane Smith"
                    className="input-field focus-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-navy-200">Candidate email</label>
                  <input
                    name="candidateEmail"
                    type="email"
                    required
                    placeholder="jane@example.com"
                    className="input-field focus-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-navy-200">Interview date & time</label>
                  <input
                    name="scheduledAt"
                    type="datetime-local"
                    required
                    className="input-field focus-ring"
                    style={{ colorScheme: "dark" }}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-navy-200">Duration</label>
                  <select
                    value={plannedDurationMinutes}
                    onChange={(e) => setPlannedDurationMinutes(Number(e.target.value))}
                    className="input-field focus-ring"
                  >
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes</option>
                    <option value={90}>90 minutes</option>
                    <option value={120}>120 minutes</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-navy-200">Meeting link</label>
                  <input
                    name="meetingLink"
                    type="url"
                    required
                    placeholder="https://zoom.us/j/..."
                    className="input-field focus-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-navy-200">Interviewers</label>
                  <InviteeMultiSelect
                    teamMembers={teamMembers}
                    selected={selectedInvitees}
                    currentUserId={currentUserId}
                    onChange={setSelectedInvitees}
                  />
                </div>

                {/* Send email checkbox */}
                <label className="flex items-start gap-3 p-3 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] cursor-pointer hover:border-[var(--border-default)] transition-colors">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="mt-0.5 accent-[var(--color-trust)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-navy-200">Send invite email to candidate</p>
                    <p className="text-xs text-navy-500 mt-0.5">TrueSelf will email the session code and instructions. Uncheck to copy and send yourself.</p>
                  </div>
                </label>

                {formError && (
                  <p className="text-sm text-critical-light flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="shrink-0">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {formError}
                  </p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="btn-secondary !w-auto flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="btn-primary flex-1"
                  >
                    {isPending ? "Creating…" : "Create session"}
                  </button>
                </div>
              </form>
            </>
          )}

          {step === "success" && session && (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-xl bg-trust/10 flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-trust">
                    <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h2 id="modal-title" className="text-lg font-bold tracking-tight">Session created</h2>
                  <p className="text-sm text-navy-400 mt-0.5">for {session.candidateName}</p>
                </div>
              </div>

              {/* Session code */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-navy-800/60 border border-[var(--border-default)] mb-4">
                <div>
                  <p className="text-xs text-navy-500 uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-mono)" }}>Session code</p>
                  <p className="text-3xl font-bold tracking-[0.2em] text-trust" style={{ fontFamily: "var(--font-mono)" }}>
                    {session.sessionCode}
                  </p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(session.sessionCode).then(() => {
                      setCodeCopyState("copied");
                      setTimeout(() => setCodeCopyState("idle"), 2000);
                    }).catch(() => {
                      // clipboard write failed silently — user still sees the code
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-700 hover:bg-navy-600 transition-colors"
                >
                  {codeCopyState === "copied" ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-trust"><path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                      Copy
                    </>
                  )}
                </button>
              </div>

              {/* Copy invite text */}
              <div className="p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] mb-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-navy-200">Copy invite text</p>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-navy-300 bg-navy-700 hover:bg-navy-600 transition-colors"
                  >
                    {textCopyState === "copied" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-navy-500 leading-relaxed" style={{ fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
                  {buildInviteText(session, companyName).slice(0, 120)}…
                </p>
                <p className="text-xs text-navy-600 mt-1">Paste into your Zoom/Teams/Calendar invite</p>
              </div>

              {/* Email status / send button */}
              <div className="p-4 rounded-xl bg-navy-800/40 border border-[var(--border-subtle)] mb-6">
                {emailState === "sent" && (
                  <div className="flex items-center gap-2 text-sm text-trust">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Invite sent to {session.candidateEmail}
                  </div>
                )}
                {emailState === "idle" && (
                  <>
                    <p className="text-sm text-navy-400 mb-2">Send invite email via TrueSelf</p>
                    <button
                      onClick={handleSendEmail}
                      className="btn-primary !w-auto !px-4 !py-2 text-sm"
                    >
                      Send email to {session.candidateEmail}
                    </button>
                  </>
                )}
                {emailState === "sending" && (
                  <p className="text-sm text-navy-400">Sending…</p>
                )}
                {emailState === "error" && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-critical-light">Email failed to send</p>
                    <button
                      onClick={handleSendEmail}
                      className="text-xs text-navy-300 underline hover:text-navy-100"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleDone}
                className="btn-primary"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
