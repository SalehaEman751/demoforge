import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import VariantCapture from "./variant-capture";

export const metadata: Metadata = {
  title: "Taskly - Get things done",
  description: "A minimal task manager.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <header className="mx-auto flex max-w-2xl items-center px-6 py-5">
          <Link
            href="/"
            className="rounded-md text-lg font-bold text-accent transition-colors duration-150 hover:text-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Taskly
          </Link>
        </header>
        <VariantCapture />
        {children}
      </body>
    </html>
  );
}
