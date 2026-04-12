import { Logo } from "@/components/logo";

export default function VerifyPage() {
  return (
    <div className="animate-fade-in text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-trust/10 mb-5 shield-pulse">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          className="text-trust"
        >
          <path
            d="M3 8L10.89 13.26C11.2187 13.4793 11.6049 13.5963 12 13.5963C12.3951 13.5963 12.7813 13.4793 13.11 13.26L21 8M5 19H19C19.5304 19 20.0391 18.7893 20.4142 18.4142C20.7893 18.0391 21 17.5304 21 17V7C21 6.46957 20.7893 5.96086 20.4142 5.58579C20.0391 5.21071 19.5304 5 19 5H5C4.46957 5 3.96086 5.21071 3.58579 5.58579C3.21071 5.96086 3 6.46957 3 7V17C3 17.5304 3.21071 18.0391 3.58579 18.4142C3.96086 18.7893 4.46957 19 5 19Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">
        Check your email
      </h1>
      <p className="text-navy-400 text-sm mb-6 max-w-xs mx-auto">
        We sent a verification link to your email address. Click the link to
        verify your account.
      </p>

      <div className="card animate-fade-in-delay-1">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-navy-800/50 border border-[var(--border-subtle)]">
          <div className="w-2 h-2 rounded-full bg-trust animate-pulse" />
          <p
            className="text-sm text-navy-300"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Awaiting verification...
          </p>
        </div>
        <p className="text-xs text-navy-500 mt-4">
          Didn&apos;t receive the email? Check your spam folder or{" "}
          <button className="text-trust hover:text-trust-light transition-colors">
            resend
          </button>
          .
        </p>
      </div>

      <p className="text-center text-sm text-navy-400 mt-6 animate-fade-in-delay-2">
        <a
          href="/login"
          className="text-trust hover:text-trust-light font-medium transition-colors"
        >
          Back to sign in
        </a>
      </p>
    </div>
  );
}
