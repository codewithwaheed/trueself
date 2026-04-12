import "./globals.css";
export const metadata = {
    title: "TrueSelf - Interview Integrity Platform",
    description: "Ensure authentic interviews with real-time AI cheating detection. Trust verified.",
};
export default function RootLayout({ children, }) {
    return (<html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col noise-overlay">{children}</body>
    </html>);
}
//# sourceMappingURL=layout.js.map