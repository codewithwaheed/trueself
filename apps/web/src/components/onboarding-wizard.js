'use client';
import { useState, useActionState } from "react";
import { sendInvite, completeOnboarding } from "@/actions/auth";
import { FormField } from "./form-field";
import { SubmitButton } from "./submit-button";
export function OnboardingWizard({ userName }) {
    const [step, setStep] = useState(0);
    const [inviteState, inviteAction, invitePending] = useActionState(sendInvite, undefined);
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 animate-fade-in">
        <div className="card border border-[var(--border-default)] shadow-2xl shadow-black/20">
          {/* Progress bar */}
          <div className="flex gap-2 mb-8">
            {[0, 1].map((i) => (<div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-trust" : "bg-navy-800"}`}/>))}
          </div>

          {step === 0 && (<div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-trust/10 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-trust">
                    <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 5C13.66 5 15 6.34 15 8C15 9.66 13.66 11 12 11C10.34 11 9 9.66 9 8C9 6.34 10.34 5 12 5ZM12 19.2C9.5 19.2 7.29 17.92 6 15.98C6.03 13.99 10 12.9 12 12.9C13.99 12.9 17.97 13.99 18 15.98C16.71 17.92 14.5 19.2 12 19.2Z" fill="currentColor"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold">
                    Welcome, {userName.split(" ")[0]}!
                  </h2>
                  <p className="text-sm text-navy-400">Step 1 of 2</p>
                </div>
              </div>

              <p className="text-navy-300 text-sm mb-6 mt-4">
                Invite your first interviewer to start using TrueSelf.
                They&apos;ll receive an email with a link to set up their
                account.
              </p>

              {inviteState?.success && (<div className="mb-4 p-3.5 rounded-xl bg-trust/10 border border-trust/20 animate-fade-in">
                  <p className="text-sm text-trust-light flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                    </svg>
                    {inviteState.message}
                  </p>
                </div>)}

              {inviteState?.message && !inviteState.success && (<div className="mb-4 p-3.5 rounded-xl bg-critical/10 border border-critical/20 animate-fade-in">
                  <p className="text-sm text-critical-light">
                    {inviteState.message}
                  </p>
                </div>)}

              <form action={inviteAction} className="space-y-4">
                <FormField label="Interviewer name" name="name" placeholder="John Doe" errors={inviteState?.errors?.name} required/>
                <FormField label="Interviewer email" name="email" type="email" placeholder="john@company.com" errors={inviteState?.errors?.email} required/>
                <div className="flex gap-3 pt-2">
                  <SubmitButton pending={invitePending}>
                    Send invite
                  </SubmitButton>
                  <button type="button" onClick={() => setStep(1)} className="btn-secondary flex-1">
                    Skip
                  </button>
                </div>
              </form>

              {inviteState?.success && (<button onClick={() => setStep(1)} className="w-full mt-3 btn-secondary">
                  Continue
                </button>)}
            </div>)}

          {step === 1 && (<div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-trust/10 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-trust">
                    <path d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2Z" fill="currentColor" opacity="0.2"/>
                    <path d="M10 15.5L7.5 13L6.09 14.41L10 18.33L18 10.33L16.59 8.92L10 15.5Z" fill="currentColor"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold">You&apos;re all set!</h2>
                  <p className="text-sm text-navy-400">Step 2 of 2</p>
                </div>
              </div>

              <p className="text-navy-300 text-sm mb-6 mt-4">
                Your workspace is ready. You can now create interview sessions
                and start verifying candidate integrity in real-time.
              </p>

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-navy-800/50 border border-[var(--border-subtle)]">
                  <div className="w-8 h-8 rounded-lg bg-trust/10 flex items-center justify-center">
                    <svg className="w-4 h-4 text-trust" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                  <span className="text-sm text-navy-200">
                    Workspace created
                  </span>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-navy-800/50 border border-[var(--border-subtle)]">
                  <div className="w-8 h-8 rounded-lg bg-trust/10 flex items-center justify-center">
                    <svg className="w-4 h-4 text-trust" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                  <span className="text-sm text-navy-200">
                    Ready to monitor interviews
                  </span>
                </div>
              </div>

              <form action={async () => {
                await completeOnboarding();
            }}>
                <SubmitButton>Go to dashboard</SubmitButton>
              </form>
            </div>)}
        </div>
      </div>
    </div>);
}
//# sourceMappingURL=onboarding-wizard.js.map