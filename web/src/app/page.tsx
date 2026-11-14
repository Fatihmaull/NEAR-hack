import type { Metadata } from "next";
import { Landing } from "@/components/site/Landing";

export const metadata: Metadata = {
  title: "Paron · Compute forwards for AI agents on NEAR",
  description:
    "Lock in tomorrow's GPU bill today. AI agents buy GPU-hour forwards inside on-chain guardrails; providers pre-sell with 25% margin; prices and jobs are attested in a TEE. Testnet beta.",
};

export default function Page() {
  return <Landing />;
}
