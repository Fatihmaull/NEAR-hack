import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: { default: "Paron · Compute forwards for AI agents on NEAR", template: "%s · Paron" },
  description:
    "A forward market for GPU compute on NEAR: AI agents lock in their GPU bill inside on-chain guardrails, providers pre-sell with 25% margin, and prices and jobs are attested in a TEE.",
};

export const viewport: Viewport = {
  themeColor: "#0A0B0D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
