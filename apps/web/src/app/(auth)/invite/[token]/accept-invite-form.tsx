'use client'

import { useActionState } from "react";
import { acceptInvite } from "@/actions/auth";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";

interface AcceptInviteFormProps {
  token: string;
  email: string;
  defaultName: string;
}

export function AcceptInviteForm({
  token,
  email,
  defaultName,
}: AcceptInviteFormProps) {
  const [state, action, pending] = useActionState(acceptInvite, undefined);

  return (
    <>
      {state?.message && !state.success && (
        <div className="mb-5 p-3.5 rounded-xl bg-critical/10 border border-critical/20 animate-fade-in">
          <p className="text-sm text-critical-light flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
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

      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div className="card space-y-4 animate-fade-in-delay-1">
          {/* Show email as read-only */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-navy-200">
              Email
            </label>
            <div className="input-field bg-navy-900/50 text-navy-400 cursor-not-allowed">
              {email}
            </div>
          </div>

          <FormField
            label="Full name"
            name="name"
            placeholder="Your name"
            defaultValue={defaultName}
            autoComplete="name"
            autoFocus
            errors={state?.errors?.name}
            required
          />
          <FormField
            label="Create password"
            name="password"
            type="password"
            placeholder="Min 8 characters, 1 letter, 1 number"
            autoComplete="new-password"
            errors={state?.errors?.password}
            required
          />
        </div>

        <div className="animate-fade-in-delay-2">
          <SubmitButton pending={pending}>
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Accept invitation
          </SubmitButton>
        </div>
      </form>
    </>
  );
}
