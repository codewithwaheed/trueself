import { Logo } from "@/components/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-grid">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-trust/[0.03] blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-[500px] h-[300px] bg-navy-600/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 px-6 py-5">
        <a href="/" className="inline-block">
          <Logo size="md" />
        </a>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-4 text-center">
        <p className="text-xs text-navy-500" style={{ fontFamily: "var(--font-mono)" }}>
          Secured by TrueSelf
        </p>
      </footer>
    </div>
  );
}
