import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrustVault — documents with proof",
  description:
    "A document platform where the wrong person can never read a file, and you can prove who read it.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
