"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Download, FileCheck, Pause, Play, RotateCcw, ShieldCheck, SkipForward, Sparkles } from "lucide-react";
import { ACTS, SWARM_ACCOUNTS, SwarmSimulation, verifyReceipt, type ReceiptVerification, type SwarmEvent, type SwarmReceipt } from "@paron/agents";
import { TopBar } from "@/components/TopBar";
import { Badge, Hash, Stat } from "@/components/ui";
import { cu, price, usd, utc } from "@/lib/format";

const STEP_MS = 11_500;
const TOTAL_MS = STEP_MS * ACTS.length;

type Snap = Record<string, any>;

const KIND_TONE: Record<string, "near" | "tee" | "intents" | "warn" | "danger" | "muted"> = {
  tx: "near",
  attestation: "tee",
  intent: "intents",
  "chain-signature": "intents",
  guardrail: "warn",
  security: "danger",
  liquidation: "danger",
  settlement: "near",
  redemption: "tee",
  analysis: "muted",
  info: "muted",
};

function ActMetrics({ act, snap, sim }: { act: number; snap: Snap; sim: SwarmSimulation }) {
  const bal = (a: string) => snap.balances?.[a]?.free_usdc_micros;
  if (act === 1)
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="CFO margin (from Base)" value={usd(bal(SWARM_ACCOUNTS.cfo))} sub="1Click → customRecipientMsg" tone="intents" />
        <Stat label="Consumer margin (from SOL)" value={usd(bal(SWARM_ACCOUNTS.consumer))} sub="2.5 SOL via NEAR Intents" tone="intents" />
        <Stat label="Genesis credit" value={snap.protocol?.withdrawals_enabled ? "repaid ✓" : "outstanding"} sub="book fully backed" tone="near" />
        <Stat label="Function Call keys" value={`${Object.keys(snap.function_call_keys ?? {}).length} installed`} sub="no deposits · method allowlists" tone="tee" />
      </div>
    );
  if (act === 2) {
    const nov = snap.books?.["CU-2026-11"];
    const provider = (snap.vaults?.["CU-2026-11"] ?? []).find((v: any) => v.provider === SWARM_ACCOUNTS.provider);
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="CRI-H100 baseline" value={price(snap.series?.[0]?.index_twap_usdc_micros)} sub="spoofed $9.80 feed rejected" tone="tee" />
        <Stat label="Provider margin" value={usd(provider?.locked_collateral_micros)} sub="25% of $843 — not a 1.5x bond" tone="near" />
        <Stat label="CU-2026-11 bid / ask" value={`${price(nov?.best_bid_micros)} / ${price(nov?.best_ask_micros)}`} sub="LP agent post-only quotes" />
        <Stat label="Capital efficiency" value="4.0x" sub="vs 0.67x legacy" tone="near" />
      </div>
    );
  }
  if (act === 3) {
    const guard = snap.guardrails?.[SWARM_ACCOUNTS.cfo];
    const pos = snap.balances?.[SWARM_ACCOUNTS.cfo]?.cu?.[0];
    const rejected = sim.runtime.txs.filter((t) => t.status === "Failure").length;
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="CFO hedge" value={`${cu(pos, 0)} CU`} sub="CU-2026-11 NEP-245 minted" tone="near" />
        <Stat label="Spent today" value={usd(guard?.spent_today_micros)} sub="of $2,500 guardrail cap" />
        <Stat label="Blocked actions" value={`${rejected}`} sub="slippage guard + FC key" tone="warn" />
        <Stat label="Consumer inventory" value={`${cu(snap.balances?.[SWARM_ACCOUNTS.consumer]?.cu?.[1], 0)} CU`} sub="CU-2026-12 for Mode B" tone="tee" />
      </div>
    );
  }
  if (act === 4) {
    const cash = snap.cash_receipts?.[0];
    const liq = snap.liquidations?.[0];
    const path = sim.attestations.filter((a) => a.attestation.series_id === "CU-2026-11").map((a) => a.attestation.twap_micros);
    return (
      <div className="space-y-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-ink-600/70 bg-ink-850 p-3">
          {path.map((p, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="num text-[10.5px] text-tee">{price(p).slice(0, 5)}</span>
              <div className="w-full rounded-t bg-gradient-to-t from-tee/30 to-tee/80" style={{ height: `${((p - 2_500_000) / 1_700_000) * 70 + 8}px` }} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Mode A payout" value={usd(cash?.payout_micros)} sub="500 CU × $4.10" tone="near" />
          <Stat label="Hedge ΔV" value={usd(cash?.hedge_pnl_micros)} sub={`entry ${price(cash?.avg_entry_price_micros)}`} tone="near" />
          <Stat label="Liquidated" value={liq ? `vault #${liq.vault_id}` : "—"} sub={liq ? `health ${(liq.health_bps_before / 100).toFixed(2)}% < 15%` : ""} tone="danger" />
          <Stat label="Keeper bonus" value={usd(liq?.liquidator_bonus_micros)} sub="re-hedged at the attested mark" tone="tee" />
        </div>
      </div>
    );
  }
  const stats = snap.provider_stats;
  const reds = (snap.redemptions ?? []) as any[];
  const comp = reds.filter((r) => "SlashedForSlaBreach" in r.state).reduce((a, r) => a + BigInt(r.state.SlashedForSlaBreach.payout_micros) - BigInt(r.strike_payment_micros), 0n);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat label="Delivered via TEE" value={`${stats?.delivered_count ?? 0} job`} sub="provider paid strike + margin" tone="near" />
      <Stat label="SLA slashes" value={`${stats?.slashed_count ?? 0}`} sub="throttled + ghosted" tone="danger" />
      <Stat label="Agent compensation" value={usd(comp)} sub="15% penalties on top of refunds" tone="tee" />
      <Stat label="Provider reliability" value={`${((stats?.reliability_bps ?? 0) / 100).toFixed(1)}%`} sub="on-chain score" tone="warn" />
    </div>
  );
}

export default function TourPage() {
  const simRef = useRef<SwarmSimulation | null>(null);
  const timers = useRef<number[]>([]);
  const [booted, setBooted] = useState(false);
  const [revealed, setRevealed] = useState<SwarmEvent[]>([]);
  const [completed, setCompleted] = useState<number[]>([]);
  const [activeAct, setActiveAct] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [snaps, setSnaps] = useState<Record<number, Snap>>({});
  const [receipt, setReceipt] = useState<SwarmReceipt | null>(null);
  const [verification, setVerification] = useState<ReceiptVerification | null>(null);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const boot = useCallback(async () => {
    clearTimers();
    const sim = await SwarmSimulation.create();
    simRef.current = sim;
    setRevealed(sim.events.filter((e) => e.act === 0));
    setCompleted([]);
    setActiveAct(0);
    setSnaps({});
    setReceipt(null);
    setVerification(null);
    setElapsed(0);
    setRunning(false);
    setBooted(true);
  }, []);

  useEffect(() => {
    boot();
    return clearTimers;
  }, [boot]);

  useEffect(() => {
    if (!autoplay) return;
    const started = Date.now() - elapsed;
    const t = window.setInterval(() => setElapsed(Math.min(TOTAL_MS, Date.now() - started)), 100);
    return () => window.clearInterval(t);
  }, [autoplay]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAct = useCallback(async (act: number, paced: boolean) => {
    const sim = simRef.current;
    if (!sim || sim.nextAct !== act) return;
    setRunning(true);
    setActiveAct(act);
    const before = sim.events.length;
    await sim.runAct(act);
    const fresh = sim.events.slice(before);
    const snap = sim.snapshot() as Snap;
    const finish = () => {
      setSnaps((s) => ({ ...s, [act]: snap }));
      setCompleted((c) => [...c, act]);
      setRunning(false);
      if (act === ACTS.length) {
        const r = sim.buildReceipt();
        setReceipt(r);
        setVerification(verifyReceipt(r));
        setAutoplay(false);
        setElapsed(TOTAL_MS);
      }
    };
    if (!paced) {
      setRevealed((r) => [...r, ...fresh]);
      finish();
      return;
    }
    const interval = Math.max(350, Math.floor((STEP_MS - 600) / Math.max(1, fresh.length)));
    fresh.forEach((e, i) => timers.current.push(window.setTimeout(() => setRevealed((r) => [...r, e]), i * interval)));
    timers.current.push(window.setTimeout(finish, fresh.length * interval + 250));
  }, []);

  // Autoplay: chain acts.
  useEffect(() => {
    if (!autoplay || running) return;
    const next = simRef.current?.nextAct;
    if (next) {
      const t = window.setTimeout(() => runAct(next, true), completed.length === 0 ? 200 : 450);
      timers.current.push(t);
    }
  }, [autoplay, running, completed, runAct]);

  const play = async () => {
    if (receipt) {
      setAutoplay(false);
      await boot();
    }
    setAutoplay(true);
  };
  const next = () => {
    const n = simRef.current?.nextAct;
    if (n && !running) runAct(n, false);
  };
  const reset = () => {
    setAutoplay(false);
    boot();
  };
  const download = () => {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paron-swarm-receipt-${receipt.receipt_sha256.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shownAct = activeAct || 1;
  const actEvents = useMemo(() => revealed.filter((e) => e.act === shownAct && e.actor !== "Tour"), [revealed, shownAct]);
  const clock = revealed.length ? revealed[revealed.length - 1].t : undefined;
  const outcomes = receipt?.outcomes as Record<string, any> | undefined;

  return (
    <>
      <TopBar clockMs={clock} active="tour" />
      <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-4">
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-near/[0.08] via-transparent to-tee/[0.07] p-5">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-near">
                <Sparkles className="h-3.5 w-3.5" /> 60-second coded judge tour · zero wallet required
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Autonomous agent swarm hedges its compute runway on NEAR</h1>
              <p className="mt-1 text-sm text-fg-muted">
                Five acts, executed live in your browser by the Paron contract engine: every step is an Ed25519-signed NEAR transaction, every price and SLA verdict is an
                OutLayer TEE attestation. The resulting audit receipt is byte-identical to <span className="font-mono text-fg">npm run demo:swarm</span>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {autoplay ? (
                <button type="button" className="btn-ghost" onClick={() => setAutoplay(false)}>
                  <Pause className="h-4 w-4" /> Pause
                </button>
              ) : (
                <button type="button" className="btn-primary px-4 py-2.5 font-semibold" disabled={!booted || running} onClick={play}>
                  <Play className="h-4 w-4 fill-current" /> {receipt ? "Replay 60s tour" : completed.length ? "Resume" : "Run 60s Autonomous Agent Swarm Simulation"}
                </button>
              )}
              <button type="button" className="btn-ghost" disabled={!booted || running || autoplay || Boolean(receipt)} onClick={next}>
                <SkipForward className="h-4 w-4" /> Step
              </button>
              <button type="button" className="btn-ghost" onClick={reset}>
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
            </div>
          </div>
          <div className="h-1 w-full bg-ink-800">
            <div className="h-full bg-gradient-to-r from-near to-tee transition-all duration-200" style={{ width: `${(Math.max(elapsed, (completed.length / ACTS.length) * TOTAL_MS) / TOTAL_MS) * 100}%` }} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <ol className="space-y-2">
            {ACTS.map((a) => {
              const done = completed.includes(a.id);
              const active = activeAct === a.id && !done;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => (done ? setActiveAct(a.id) : undefined)}
                    className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-near/60 bg-near/[0.07] shadow-glow" : done ? "border-ink-500 bg-ink-900 hover:border-ink-400" : "border-ink-600/70 bg-ink-900/60"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ${done ? "bg-near text-ink-950" : active ? "bg-near/20 text-near ring-1 ring-near/60" : "bg-ink-700 text-fg-dim"}`}>
                        {done ? <CircleCheck className="h-4 w-4" /> : a.id}
                      </span>
                      <span className={`text-[13px] font-semibold ${done || active ? "text-fg" : "text-fg-muted"}`}>Step {a.id}</span>
                      {active ? <span className="ml-auto h-2 w-2 animate-pulse-dot rounded-full bg-near" /> : null}
                    </div>
                    <div className="mt-1 text-[13px] text-fg">{a.title}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {a.nearPrimitives.map((p) => (
                        <span key={p} className="chip">
                          {p}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>

          <section className="panel min-w-0">
            <header className="panel-header">
              <div className="min-w-0">
                <div className="panel-title">
                  Step {shownAct} · {ACTS[shownAct - 1].title}
                </div>
                <div className="mt-0.5 text-[12px] text-fg-muted">{ACTS[shownAct - 1].subtitle}</div>
              </div>
              {completed.includes(shownAct) ? <Badge tone="near">complete</Badge> : running ? <Badge tone="tee">executing…</Badge> : <Badge>pending</Badge>}
            </header>
            <div className="space-y-3 p-4">
              {snaps[shownAct] && simRef.current ? <ActMetrics act={shownAct} snap={snaps[shownAct]} sim={simRef.current} /> : null}
              <ul className="space-y-1.5">
                {actEvents.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-ink-500 p-4 text-sm text-fg-dim">Press play — the swarm starts on 2026-11-05 09:00 UTC with zero configuration.</li>
                ) : null}
                {actEvents.map((e) => (
                  <li key={e.seq} className="animate-fade-in rounded-lg border border-ink-600/70 bg-ink-850 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge tone={e.ok === false ? (e.kind === "guardrail" || e.kind === "security" ? "warn" : "danger") : KIND_TONE[e.kind] ?? "muted"}>{e.ok === false ? "blocked" : e.kind}</Badge>
                        <span className="truncate text-[12.5px] font-semibold">{e.actor}</span>
                      </span>
                      <span className="num text-[10.5px] text-fg-dim">{utc(e.t)}</span>
                    </div>
                    <div className="mt-1 text-[13px] text-fg">{e.title}</div>
                    {e.detail ? <div className="mt-0.5 break-words text-[11.5px] text-fg-muted">{e.detail}</div> : null}
                    {e.txHash ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-fg-dim">
                        <span className="flex items-center gap-1">
                          tx <Hash value={e.txHash} head={10} tail={6} />
                        </span>
                        {e.method ? <span className="chip">{e.method}</span> : null}
                        {e.keyKind ? <span className="chip">{e.keyKind === "FunctionCall" ? "Function Call key" : "full-access key"}</span> : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {receipt && outcomes ? (
          <section className="panel animate-fade-in">
            <header className="panel-header">
              <h2 className="panel-title">
                <FileCheck className="h-4 w-4 text-near" /> Verifiable audit receipt
              </h2>
              <button type="button" className="btn-primary" onClick={download}>
                <Download className="h-4 w-4" /> Download JSON Audit Receipt
              </button>
            </header>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="CFO hedge" value={`${cu(outcomes.cfo_hedged_cu, 0)} CU`} sub={`@ ${price(outcomes.cfo_avg_entry_price_micros)}`} tone="near" />
                <Stat label="Mode A payout" value={usd(outcomes.cfo_cash_settlement_payout_micros)} sub={`unhedged bill ${usd(outcomes.unhedged_spot_cost_micros)}`} tone="near" />
                <Stat label="Hedge ΔV" value={usd(outcomes.cfo_hedge_pnl_micros)} sub="Q × (P_index − P_strike)" tone="near" />
                <Stat label="Liquidations" value={outcomes.liquidations} sub="below 15% maintenance" tone="danger" />
                <Stat label="Mode B" value={(outcomes.redemptions as any[]).map((r) => (r.final_state === "DeliveredViaTee" ? "✓" : "✕")).join(" ")} sub={`+${usd(outcomes.consumer_sla_compensation_micros)} SLA penalties`} tone="tee" />
                <Stat label="Invariants" value={outcomes.invariants_hold ? "hold ✓" : "broken"} sub="supply conservation" tone={outcomes.invariants_hold ? "near" : "danger"} />
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">
                    <ShieldCheck className="h-3.5 w-3.5 text-near" /> In-browser verification
                  </div>
                  <ul className="space-y-1">
                    {verification?.checks.map((c) => (
                      <li key={c.name} className="flex items-start justify-between gap-3 text-[12px]">
                        <span className={c.ok ? "text-near" : "text-danger"}>
                          {c.ok ? "✓" : "✕"} {c.name}
                        </span>
                        <span className="truncate font-mono text-[11px] text-fg-muted">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-3 text-[12px]">
                  <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">Reproduce</div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-fg-dim">receipt_sha256</span>
                    <Hash value={receipt.receipt_sha256} head={18} tail={8} />
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded bg-ink-900 p-2 font-mono text-[11px] text-fg-muted">{`npm run demo:swarm      # same receipt_sha256
npm run verify:receipt  # re-verify every signature
npm run verify:all      # 4 verification gates`}</pre>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
