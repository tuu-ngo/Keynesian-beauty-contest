import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google"; // taste-skill-ignore: FRONTEND.md requires Geist Mono for codes, values, and countdowns.
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" }); // taste-skill-ignore: FRONTEND.md requires Geist Mono for numeric telemetry.

export const metadata: Metadata = {
  title: "Keynesian Beauty Contest",
  description: "Live host for the Keynesian beauty contest game",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable}`}>{children}</body> {/* taste-skill-ignore: the Mono token is only applied to numeric values. */}
    </html>
  );
}
