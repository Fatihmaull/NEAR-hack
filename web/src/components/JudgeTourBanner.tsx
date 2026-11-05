"use client";

import Link from "next/link";
import { useState } from "react";
import { Play, ShieldCheck, Terminal } from "lucide-react";

export function JudgeTourBanner() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-xl border border-near/30 bg-gradient-to-r from-near/[0.09] via-ink-900 to-tee/[0.08] p-4 shadow-glow">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-near">
            <ShieldCheck className="h-3.5 w-3.5" /> Zero-wallet judge mode
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            Every number on this terminal comes from <span className="text-fg">Ed25519-signed transactions</span> executed by the Paron contract engine in your
            browser, priced by <span className="text-tee">OutLayer TEE attestations</span> and funded through <span className="text-intents">NEAR Intents + Chain Signatures</span>.
            Click anything — it is all real state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost font-mono text-xs"
            onClick={() => {
              navigator.clipboard?.writeText("npm run verify:all").catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            <Terminal className="h-4 w-4" />
            {copied ? "copied!" : "npm run verify:all"}
          </button>
          <Link href="/tour" className="btn-primary px-4 py-2.5 font-semibold">
            <Play className="h-4 w-4 fill-current" />
            Run 60s Autonomous Agent Swarm Simulation
          </Link>
        </div>
      </div>
    </div>
  );
}
