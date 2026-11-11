"use client";

import { AgentSwarmPanel } from "@/components/AgentSwarmPanel";
import { JudgeTourBanner } from "@/components/JudgeTourBanner";
import { LiveTestnetPanel } from "@/components/LiveTestnetPanel";
import { OrderBookDesk } from "@/components/OrderBookDesk";
import { RedemptionTimeline } from "@/components/RedemptionTimeline";
import { SeriesMatrix } from "@/components/SeriesMatrix";
import { TeeAttestationCard } from "@/components/TeeAttestationCard";
import { ToastHost } from "@/components/ToastHost";
import { TopBar } from "@/components/TopBar";
import { Stat } from "@/components/ui";
import { DeskProvider, useDesk } from "@/lib/desk";
import { usd } from "@/lib/format";

function ProtocolStrip() {
  const { snapshot, sim } = useDesk();
  const p = snapshot?.protocol;
  const inv = (snapshot?.invariants ?? []) as Array<{ holds: boolean }>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Insurance pool" value={usd(p?.insurance_pool_micros)} tone="tee" />
      <Stat label="Genesis credit" value={p ? (p.withdrawals_enabled ? "repaid" : usd(p.genesis_credit_outstanding_micros)) : "—"} sub="withdrawals unlocked" tone="near" />
      <Stat label="USDC deposited" value={usd(p?.total_deposited_micros, 0)} sub="via ft_transfer_call / 1Click" />
      <Stat label="Signed txs" value={sim ? sim.runtime.txs.length : "—"} sub={`${sim?.runtime.txs.filter((t) => t.status === "Failure").length ?? 0} rejected by guardrails/keys`} />
      <Stat label="OutLayer attestations" value={sim ? sim.attestations.length + sim.jobReceipts.length : "—"} sub="Ed25519 · TDX quote hashes" tone="tee" />
      <Stat label="Supply conservation" value={inv.length ? (inv.every((i) => i.holds) ? "holds ✓" : "BROKEN") : "—"} sub="circulating CU = Σ obligations" tone={inv.every((i) => i.holds) ? "near" : "danger"} />
    </div>
  );
}

function Terminal() {
  const { snapshot, ready } = useDesk();
  return (
    <>
      <TopBar clockMs={snapshot?.now_ms} active="terminal" />
      <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-4">
        <JudgeTourBanner />
        {ready ? <ProtocolStrip /> : <div className="h-[62px] animate-pulse rounded-lg bg-ink-900" />}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <SeriesMatrix />
          <OrderBookDesk />
        </div>
        <LiveTestnetPanel />
        <AgentSwarmPanel />
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <TeeAttestationCard />
          <RedemptionTimeline />
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 pt-4 text-[11.5px] text-fg-dim">
          <span>
            Paron v2 · contracts/paron-core (near-sdk 5.30) · tee-worker/outlayer-cri-oracle (wasm32-wasip2) · agents/ (NEAR Intents 1Click, Chain Signatures) · web/ (Next.js 15, NEAR Connect)
          </span>
          <span className="font-mono">desk = deterministic local runtime · live panel = NEAR testnet</span>
        </footer>
      </main>
      <ToastHost />
    </>
  );
}

export default function Page() {
  return (
    <DeskProvider>
      <Terminal />
    </DeskProvider>
  );
}
