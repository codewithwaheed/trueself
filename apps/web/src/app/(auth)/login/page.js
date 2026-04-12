'use client';
import { useActionState } from "react";
import { login } from "@/actions/auth";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
export default function LoginPage() {
    const [state, action, pending] = useActionState(login, undefined);
    return (<div className="animate-fade-in">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-navy-800 border border-[var(--border-subtle)] mb-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-navy-300">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M7 11V7C7 4.23858 9.23858 2 12 2C14.7614 2 17 4.23858 17 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="12" cy="16" r="1.5" fill="currentColor"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Welcome back</h1>
        <p className="text-navy-400 text-sm">
          Sign in to your TrueSelf dashboard.
        </p>
      </div>

      {/* Error banner */}
      {state?.message && !state.success && (<div className="mb-5 p-3.5 rounded-xl bg-critical/10 border border-critical/20 animate-fade-in">
          <p className="text-sm text-critical-light flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            {state.message}
          </p>
        </div>)}

      {/* Form */}
      <form action={action} className="space-y-4">
        <div className="card space-y-4 animate-fade-in-delay-1">
          <FormField label="Email" name="email" type="email" placeholder="jane@company.com" autoComplete="email" autoFocus errors={state?.errors?.email} required/>
          <FormField label="Password" name="password" type="password" placeholder="Enter your password" autoComplete="current-password" errors={state?.errors?.password} required/>
        </div>

        <div className="animate-fade-in-delay-2">
          <SubmitButton pending={pending}>
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
            Sign in
          </SubmitButton>
        </div>
      </form>

      {/* Footer link */}
      <p className="text-center text-sm text-navy-400 mt-6 animate-fade-in-delay-3">
        Don&apos;t have an account?{" "}
        <a href="/signup" className="text-trust hover:text-trust-light font-medium transition-colors">
          Get started
        </a>
      </p>
    </div>);
}
//# sourceMappingURL=page.js.map