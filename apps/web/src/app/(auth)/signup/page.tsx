'use client'

import { useActionState } from "react";
import { signup } from "@/actions/auth";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, undefined);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-trust/10 mb-5 shield-pulse">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            className="text-trust"
          >
            <path
              d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2Z"
              fill="currentColor"
              opacity="0.2"
            />
            <path
              d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 8V12M12 16H12.01"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Create your workspace
        </h1>
        <p className="text-navy-400 text-sm">
          Set up your company on TrueSelf and start verifying interview
          integrity.
        </p>
      </div>

      {/* Error banner */}
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

      {/* Form */}
      <form action={action} className="space-y-4">
        <div className="card space-y-4 animate-fade-in-delay-1">
          <FormField
            label="Full name"
            name="name"
            placeholder="Jane Smith"
            autoComplete="name"
            autoFocus
            errors={state?.errors?.name}
            required
          />
          <FormField
            label="Work email"
            name="email"
            type="email"
            placeholder="jane@company.com"
            autoComplete="email"
            errors={state?.errors?.email}
            required
          />
          <FormField
            label="Password"
            name="password"
            type="password"
            placeholder="Min 8 characters, 1 letter, 1 number"
            autoComplete="new-password"
            errors={state?.errors?.password}
            required
          />
          <FormField
            label="Company name"
            name="companyName"
            placeholder="Acme Corp"
            autoComplete="organization"
            errors={state?.errors?.companyName}
            required
          />
        </div>

        <div className="animate-fade-in-delay-2">
          <SubmitButton pending={pending}>
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Create workspace
          </SubmitButton>
        </div>
      </form>

      {/* Footer link */}
      <p className="text-center text-sm text-navy-400 mt-6 animate-fade-in-delay-3">
        Already have an account?{" "}
        <a
          href="/login"
          className="text-trust hover:text-trust-light font-medium transition-colors"
        >
          Sign in
        </a>
      </p>
    </div>
  );
}
