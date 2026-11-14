"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleX, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { ACTS, SWARM_ACCOUNTS, SwarmSimulation, verifyReceipt, type ReceiptVerification, type SwarmEvent, type SwarmReceipt } from "@paron/agents";
import { cu, plain, price, usd, utc } from "@/lib/format";
import { STEPS } from "@/lib/steps";
import { Stat } from "../ui";
import { Wordmark } from "../site/Wordmark";

const STEP_MS = 11_500;

type Snap = Record<string, any>;

function StepResult({ act, snap, sim }: { act: number; snap: Snap; sim: SwarmSimulation }) {
  const bal = (a: string) => snap.balances?.[a]?.free_usdc_micros;
  if (act === 1)
    return (
      <>
        <Stat label="CFO margin, from Base" value={usd(bal(SWARM_ACCOUNTS.cfo))} />
        <Stat label="Consumer margin, from Solana" value={usd(bal(SWARM_ACCOUNTS.consumer))} />
        <Stat label="Genesis credit" value={snap.protocol?.withdrawals_enabled ? "Repaid" : "Outstanding"} tone={snap.protocol?.withdrawals_enabled ? "up" : "warn"} />
        <Stat label="Function Call keys" value={`${Object.keys(snap.function_call_keys ?? {}).length} installed`} />
      </>
    );
  if (act === 2) {
    const nov = snap.books?.["CU-2026-11"];
    const provider = (snap.vaults?.["CU-2026-11"] ?? []).find((v: any) => v.provider === SWARM_ACCOUNTS.provider);
    return (
      <>
        <Stat label="H100 index" value={price(snap.series?.[0]?.index_twap_usdc_micros)} sub="spoofed $9.80 feed rejected" />
        <Stat label="Provider margin" value={usd(provider?.locked_collateral_micros)} sub="25%, not a 1.5× bond" />
        <Stat label="Bid / ask" value={`${price(nov?.best_bid_micros)} / ${price(nov?.best_ask_micros)}`} />
        <Stat label="Capital efficiency" value="4.0×" sub="against 0.67× with a bond" tone="up" />
      </>
    );
  }
  if (act === 3) {
    const guard = snap.guardrails?.[SWARM_ACCOUNTS.cfo];
    const rejected = sim.runtime.txs.filter((t) => t.status === "Failure").length;
    return (
      <>
        <Stat label="CFO hedge" value={`${cu(snap.balances?.[SWARM_ACCOUNTS.cfo]?.cu?.[0], 0)} CU`} sub="CU-2026-11" />
        <Stat label="Spent today" value={usd(guard?.spent_today_micros)} sub="of a $2,500 cap" />
        <Stat label="Actions refused" value={rejected} sub="price band and key" tone="down" />
        <Stat label="Consumer inventory" value={`${cu(snap.balances?.[SWARM_ACCOUNTS.consumer]?.cu?.[1], 0)} CU`} sub="CU-2026-12" />
      </>
    );
  }
  if (act === 4) {
    const cash = snap.cash_receipts?.[0];
    const liq = snap.liquidations?.[0];
    return (
      <>
        <Stat label="Cash settlement" value={usd(cash?.payout_micros)} sub="500 CU × $4.10" />
        <Stat label="Hedge value change" value={usd(cash?.hedge_pnl_micros)} sub={`entry ${price(cash?.avg_entry_price_micros)}`} tone="up" />
        <Stat label="Liquidated" value={liq ? `Vault #${liq.vault_id}` : "No liquidation"} sub={liq ? `at ${(liq.health_bps_before / 100).toFixed(1)}% health` : undefined} tone="down" />
        <Stat label="Keeper bonus" value={usd(liq?.liquidator_bonus_micros)} />
      </>
    );
  }
  const stats = snap.provider_stats;
  const reds = (snap.redemptions ?? []) as any[];
  const comp = reds.filter((r) => "SlashedForSlaBreach" in r.state).reduce((a, r) => a + BigInt(r.state.SlashedForSlaBreach.payout_micros) - BigInt(r.strike_payment_micros), 0n);
  return (
    <>
      <Stat label="Delivered" value={`${stats?.delivered_count ?? 0} job`} tone="up" />
      <Stat label="Slashed" value={`${stats?.slashed_count ?? 0} jobs`} tone="down" />
      <Stat label="Paid to the agent" value={usd(comp)} sub="15% penalties" />
      <Stat label="Provider reliability" value={`${((stats?.reliability_bps ?? 0) / 100).toFixed(1)}%`} />
    </>
  );
}

export function DemoTour() {
  const simRef = useRef<SwarmSimulation | null>(null);
  const timers = useRef<number[]>([]);
  const [booted, setBooted] = useState(false);
  const [revealed, setRevealed] = useState<SwarmEvent[]>([]);
  const [completed, setCompleted] = useState<number[]>([]);
  const [activeAct, setActiveAct] = useState(0);
  const [running, setRunning] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [snaps, setSnaps] = useState<Record<number, Snap>>({});
  const [receipt, setReceipt] = useState<SwarmReceipt | null>(null);
  const [verification, setVerification] = useState<ReceiptVerification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const boot = useCallback(async () => {
    clearTimers();
    try {
      const sim = await SwarmSimulation.create();
      simRef.current = sim;
      setRevealed(sim.events.filter((e) => e.act === 0));
      setCompleted([]);
      setActiveAct(0);
      setSnaps({});
      setReceipt(null);
      setVerification(null);
      setRunning(false);
      setBooted(true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    boot();
    return clearTimers;
  }, [boot]);

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
      }
    };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!paced || reduce) {
      setRevealed((r) => [...r, ...fresh]);
      finish();
      return;
    }
    const interval = Math.max(350, Math.floor((STEP_MS - 600) / Math.max(1, fresh.length)));
    fresh.forEach((e, i) => timers.current.push(window.setTimeout(() => setRevealed((r) => [...r, e]), i * interval)));
    timers.current.push(window.setTimeout(finish, fresh.length * interval + 250));
  }, []);

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
  const restart = () => {
    setAutoplay(false);
    boot();
  };
  const download = () => {
    if (!receipt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paron-receipt-${receipt.receipt_sha256.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = activeAct || 1;
  const events = useMemo(() => revealed.filter((e) => e.act === shown && e.actor !== "Tour"), [revealed, shown]);
  const clock = revealed.length ? revealed[revealed.length - 1].t : undefined;
  const progress = Math.round(((completed.length + (running ? 0.5 : 0)) / ACTS.length) * 100);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Wordmark />
            <span className="hidden text-[14px] text-body sm:inline">60-second demo</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="btn btn-sm text-ink hover:bg-strong">
              Exit
            </Link>
            <Link href="/dashboard" className="btn-primary btn-sm">
              Open the desk
            </Link>
          </div>
        </div>
        <div className="h-1 bg-strong" role="progressbar" aria-label="Demo progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full bg-primary transition-[width] duration-500 ease-out-expo" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-10 sm:px-6">
        <div className="flex flex-col gap-6 border-b border-hairline pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[60ch]">
            <h1 className="text-[2.25rem] font-normal leading-tight tracking-[-0.02em] sm:text-display-md">Agents hedge a GPU price spike on NEAR</h1>
            <p className="mt-3 text-[16px] leading-7 text-body">
              Five steps run in your browser on the same contract engine the tests use. Every step is a signed transaction, and every price and SLA verdict is a TEE attestation. You finish with a receipt you can verify.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {autoplay ? (
              <button type="button" className="btn-outline" onClick={() => setAutoplay(false)}>
                <Pause className="h-4 w-4" aria-hidden /> Pause
              </button>
            ) : (
              <button type="button" className="btn-primary h-12 px-6" disabled={!booted || running} onClick={play}>
                <Play className="h-4 w-4 fill-current" aria-hidden /> {receipt ? "Replay" : completed.length ? "Resume" : "Play the demo"}
              </button>
            )}
            <button type="button" className="btn-outline" disabled={!booted || running || autoplay || Boolean(receipt)} onClick={next}>
              <SkipForward className="h-4 w-4" aria-hidden /> Next step
            </button>
            <button type="button" className="btn btn-sm text-body hover:bg-strong hover:text-ink" onClick={restart}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Restart
            </button>
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-6 rounded-panel bg-down-soft p-4 text-[14.5px] text-down">
            The demo engine could not start: {error}. Reload the page to try again.
          </p>
        ) : null}

        <div className="mt-8 grid gap-10 lg:grid-cols-[300px_minmax(0,1fr)]">
          <nav aria-label="Demo steps">
            <ol className="space-y-1">
              {ACTS.map((a) => {
                const done = completed.includes(a.id);
                const current = activeAct === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => (done ? setActiveAct(a.id) : undefined)}
                      disabled={!done && !current}
                      aria-current={current ? "step" : undefined}
                      className={`flex w-full items-start gap-3 rounded-field px-3 py-3 text-left transition-colors ${current ? "bg-primary-soft" : done ? "hover:bg-soft" : ""}`}
                    >
                      <span className={`num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12.5px] ${done ? "bg-up text-white" : current ? "bg-primary text-white" : "bg-strong text-body"}`}>
                        {done ? <CircleCheck className="h-4 w-4" aria-label="done" /> : a.id}
                      </span>
                      <span className={`text-[14.5px] leading-5 ${current || done ? "font-medium text-ink" : "text-body"}`}>{STEPS[a.id].title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {clock ? (
              <p className="mt-4 px-3 text-[13px] text-body">
                Simulated clock <span className="num text-ink">{utc(clock).slice(0, 16)}</span>
              </p>
            ) : null}
          </nav>

          <section aria-live="polite" aria-labelledby="step-title" className="min-w-0">
            <h2 id="step-title" className="text-display-sm">
              {STEPS[shown].title}
            </h2>
            <p className="mt-3 max-w-[68ch] text-[16px] leading-7 text-body">{STEPS[shown].summary}</p>

            {snaps[shown] && simRef.current ? (
              <dl className="mt-8 grid grid-cols-2 gap-6 rounded-panel bg-soft p-6 md:grid-cols-4">
                <StepResult act={shown} snap={snaps[shown]} sim={simRef.current} />
              </dl>
            ) : null}

            <ol className="mt-8 border-t border-hairline">
              {events.length ? (
                events.map((e) => (
                  <li key={e.seq} className="animate-fade border-b border-hairline py-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <p className="min-w-0 text-[14.5px] leading-6">
                        <span className="text-body">{e.actor.replace(/-/g, " ")}: </span>
                        <span className={e.ok === false ? "text-down" : "text-ink"}>{plain(e.title)}</span>
                      </p>
                      {e.ok === false ? <span className="shrink-0 rounded-full bg-down-soft px-2.5 py-0.5 text-[12px] font-semibold text-down">Refused</span> : null}
                    </div>
                    {e.detail ? <p className="mt-1 break-words text-[13.5px] leading-5 text-body">{plain(e.detail)}</p> : null}
                  </li>
                ))
              ) : (
                <li className="py-6 text-[15px] text-body">{!booted ? "Starting the contract engine…" : running || autoplay ? "The agents are acting. Events appear here as they land." : "Press Play the demo. Events appear here as the agents act."}</li>
              )}
            </ol>
          </section>
        </div>

        {receipt ? (
          <section aria-labelledby="receipt-title" className="mt-14 rounded-card bg-night p-8 text-white sm:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-[56ch]">
                <h2 id="receipt-title" className="text-display-sm">
                  Your verifiable receipt
                </h2>
                <p className="mt-3 text-[15.5px] leading-7 text-night-soft">
                  Its hash is identical to the one <span className="font-mono text-white">npm run demo:swarm</span> prints. Your browser has already re-checked every signature in it.
                </p>
                <p className="mt-4 break-all font-mono text-[13px] text-white">{receipt.receipt_sha256}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-on-dark" onClick={download}>
                  Download receipt
                </button>
                <Link href="/dashboard" className="btn-outline-dark">
                  Continue to the dashboard
                </Link>
              </div>
            </div>
            {verification ? (
              <ul className="mt-8 grid gap-3 border-t border-night-line pt-6 sm:grid-cols-2">
                {verification.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-3">
                    {c.ok ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-night-up" aria-hidden /> : <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-night-down" aria-hidden />}
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-medium">
                        {c.name}
                        <span className="sr-only">{c.ok ? ": passed" : ": failed"}</span>
                      </p>
                      <p className="break-all text-[13px] text-night-soft">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-6 text-[13.5px] text-night-soft">
              The <Link href="/dashboard/audit" className="font-medium text-night-accent underline underline-offset-[3px]">audit page</Link> explains every outcome in this receipt.
            </p>
          </section>
        ) : null}
      </main>
      <footer className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <p className="border-t border-hairline py-6 text-[13px] text-body">
          Simulated run on the same contract engine the tests use. The live deployment is on the <Link href="/dashboard/testnet" className="link">Live testnet</Link> page.
        </p>
      </footer>
    </div>
  );
}
