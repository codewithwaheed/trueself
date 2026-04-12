'use client'

import { useActionState, useRef, useEffect } from "react";
import { sendInvite } from "@/actions/auth";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";

export function InviteForm() {
  const [state, action, pending] = useActionState(sendInvite, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset form on successful invite
  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state?.success]);

  return (
    <div className="card border border-[var(--border-subtle)]">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-trust/10 flex items-center justify-center">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            className="text-trust"
          >
            <path
              d="M16 21V19C16 16.7909 14.2091 15 12 15H6C3.79086 15 2 16.7909 2 19V21"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M19 8V14M16 11H22"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-navy-100">
            Invite interviewer
          </h2>
          <p className="text-xs text-navy-500">
            They&apos;ll receive an email with a link to join your workspace.
          </p>
        </div>
      </div>

      {state?.success && (
        <div className="mb-4 p-3 rounded-xl bg-trust/10 border border-trust/20 animate-fade-in">
          <p className="text-sm text-trust-light flex items-center gap-2">
            <svg
              className="w-4 h-4 shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            {state.message}
          </p>
        </div>
      )}

      {state?.message && !state.success && (
        <div className="mb-4 p-3 rounded-xl bg-critical/10 border border-critical/20 animate-fade-in">
          <p className="text-sm text-critical-light flex items-center gap-2">
            <svg
              className="w-4 h-4 shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            {state.message}
          </p>
        </div>
      )}

      <form ref={formRef} action={action} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            label="Name"
            name="name"
            placeholder="Jane Smith"
            errors={state?.errors?.name}
            required
          />
          <FormField
            label="Email"
            name="email"
            type="email"
            placeholder="jane@company.com"
            errors={state?.errors?.email}
            required
          />
        </div>
        <div className="pt-1">
          <SubmitButton pending={pending} className="!w-auto !px-6">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            Send invitation
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
