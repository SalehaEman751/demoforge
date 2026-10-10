import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DemoForge",
  description: "Turn a web project and plain-English instructions into a recorded demo video.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-base text-slate-900 antialiased">
        <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">{children}</main>
      </body>
    </html>
  );
}
