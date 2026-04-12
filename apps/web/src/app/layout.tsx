import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrueSelf - Interview Integrity Platform",
  description:
    "Ensure authentic interviews with real-time AI cheating detection. Trust verified.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col noise-overlay" suppressHydrationWarning>{children}</body>
    </html>
  );
}
