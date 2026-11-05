import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Paron v2 — Compute Forwards for AI Agents on NEAR",
  description:
    "Autonomous compute forward & runway hedging desk: NEP-245 CU forwards, 25% margin vaults, OutLayer TEE settlement, NEAR Intents funding and Chain Signatures.",
};

export const viewport: Viewport = {
  themeColor: "#04060a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
