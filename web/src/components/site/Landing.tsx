"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { GPU_LABELS, GPU_TIERS, GPU_WEIGHT_BPS } from "@paron/agents";
import { cu, price, readableError, redemptionLabel, utcDate } from "@/lib/format";
import { explorerAccount, onChainTxCount, useTestnet, type LiveEvent, type TestnetState } from "@/lib/testnet";
import { ForwardCurve } from "../ForwardCurve";
import { Hash } from "../ui";
import { DemoChooser } from "./DemoChooser";
import { REPO_URL, SiteHeader } from "./SiteHeader";
import { Wordmark } from "./Wordmark";

const RECEIPT_SHA = "b0b1ce8f09b755672781eb1a27383c110cd22675004e622b4f582b0c622fa785";

function curvePoints(s: TestnetState | null) {
  return (s?.series ?? []).map((x) => ({ id: x.series_id, index: BigInt(x.index_twap_usdc_micros), strike: BigInt(x.initial_strike_usdc_micros) }));
}

function HeroCards({ state, loading, error }: { state: TestnetState | null; loading: boolean; error: string | null }) {
  const rejection = state?.run.events.find((e) => e.phase === "drill" && e.ok === false && e.url);
  const front = state?.series?.[0];
  const book = front ? state?.books?.[front.series_id] : undefined;
  return (
    <div className="relative mx-auto w-full max-w-[520px] lg:mx-0">
      <div className={`rounded-card bg-night-raised p-6 sm:p-7 ${rejection ? "pb-12 sm:pb-16" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] text-night-soft">CRI-H100 forward curve</p>
            <p className="num mt-1 text-[32px] font-normal leading-none text-white">{front ? price(front.index_twap_usdc_micros) : "$ ·····"}</p>
            <p className="mt-1.5 text-[13px] text-night-soft">per H100-hour, front month, attested by OutLayer</p>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white">{state?.live ? "Live on testnet" : loading ? "Loading" : "Recorded"}</span>
        </div>
        <div className="mt-5">
          {state?.series?.length ? (
            <ForwardCurve tone="dark" points={curvePoints(state)} title="Attested index against strike for the three CU maturities" />
          ) : (
            <div className="grid h-[150px] place-items-center rounded-panel border border-night-line text-[13px] text-night-soft" role="status">
              {error ? "Testnet data is unavailable right now." : "Reading the contract on NEAR testnet…"}
            </div>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-night-line pt-4 text-[12.5px]">
          <div>
            <dt className="text-night-muted">Best bid</dt>
            <dd className="num mt-0.5 text-white">{book?.best_bid_micros ? price(book.best_bid_micros) : "No bids"}</dd>
          </div>
          <div>
            <dt className="text-night-muted">Best ask</dt>
            <dd className="num mt-0.5 text-white">{book?.best_ask_micros ? price(book.best_ask_micros) : "No asks"}</dd>
          </div>
          <div>
            <dt className="text-night-muted">Open interest</dt>
            <dd className="num mt-0.5 text-white">{front ? `${cu(front.total_open_interest_cu, 0)} CU` : "Loading"}</dd>
          </div>
        </dl>
      </div>
      {rejection ? (
        <div className="relative z-10 -mt-8 ml-6 rounded-panel bg-canvas p-4 shadow-sheet sm:-mt-12 sm:ml-auto sm:mr-[-20px] sm:w-[330px]">
          <p className="text-[13px] font-semibold text-down">Order rejected on-chain</p>
          <p className="mt-1 text-[13.5px] leading-5 text-ink">{readableError(rejection.detail)}</p>
          <p className="mt-2 flex items-center justify-between gap-2 text-[12.5px] text-body">
            <span>{rejection.actor.replace(/-/g, " ")}</span>
            <a href={rejection.url} target="_blank" rel="noreferrer" className="link num text-[12.5px]">
              View tx<span className="sr-only"> on nearblocks (opens in a new tab)</span>
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Hero({ onDemo, data }: { onDemo: () => void; data: ReturnType<typeof useTestnet> }) {
  return (
    <section className="dark-band bg-night text-white" aria-labelledby="hero-title">
      <div className="container-page grid items-center gap-12 pb-20 pt-10 sm:pb-24 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-16 lg:pb-28 lg:pt-16">
        <div className="max-w-[600px]">
          <h1 id="hero-title" className="text-[2.75rem] font-normal leading-[1.03] tracking-[-0.025em] sm:text-display-lg lg:text-display-xl">
            Lock in tomorrow&apos;s GPU bill today.
          </h1>
          <p className="mt-6 max-w-[52ch] text-[17px] leading-7 text-night-soft">
            Paron is a forward market for GPU compute on NEAR. AI agents buy hours ahead at a fixed price. Providers pre-sell capacity with 25% margin. Every
            price and every delivered job is attested inside a TEE.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/dashboard" className="btn-primary h-14 px-8 text-[16px]">
              Open the desk
            </Link>
            <button type="button" onClick={onDemo} className="btn-outline-dark h-14 px-7 text-[16px]">
              Run the 60-second demo
            </button>
          </div>
          <p className="mt-6 text-[13.5px] text-night-muted">No wallet needed. Testnet beta: collateral is a test USDC with no value.</p>
        </div>
        <HeroCards state={data.state} loading={data.loading} error={data.error} />
      </div>
    </section>
  );
}

function Markets({ data }: { data: ReturnType<typeof useTestnet> }) {
  const { state, error, loading, reload } = data;
  return (
    <section id="markets" className="bg-canvas py-20 sm:py-24" aria-labelledby="markets-title">
      <div className="container-page grid gap-12 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h2 id="markets-title" className="text-display-sm sm:text-display-md">
            One unit of compute, three maturities.
          </h2>
          <p className="mt-4 text-[16px] leading-7 text-body">
            1 CU is one hour of an NVIDIA H100 SXM 80GB. Every other chip converts by weight, so liquidity never splits by city, chip or provider.
          </p>
          <dl className="mt-8 grid grid-cols-5 gap-2">
            {GPU_TIERS.map((t) => (
              <div key={t} className="rounded-field bg-soft px-2 py-3 text-center" title={GPU_LABELS[t]}>
                <dt className="text-[12.5px] font-medium text-ink">{t}</dt>
                <dd className="num mt-0.5 text-[13px] text-body">{(Number(GPU_WEIGHT_BPS[t]) / 10_000).toFixed(2)}×</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
            <p className="text-[14px] font-medium text-ink">NEP-245 series on NEAR testnet</p>
            <p className="text-[13px] text-body">{state?.live ? "Read from the contract" : loading ? "Loading" : "Last recorded state"}</p>
          </div>
          {error && !state ? (
            <div role="alert" className="py-8 text-[14.5px] text-body">
              Could not reach the testnet API. <button type="button" onClick={reload} className="link">Try again</button>
            </div>
          ) : !state ? (
            <ul aria-busy="true" aria-label="Loading series">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex h-[76px] items-center border-b border-hairline">
                  <span className="h-4 w-40 animate-pulse rounded bg-strong" />
                </li>
              ))}
            </ul>
          ) : (
            <table className="w-full text-left">
              <caption className="sr-only">Index, best bid and ask, and open interest per maturity</caption>
              <thead>
                <tr className="text-[12.5px] text-body">
                  <th scope="col" className="py-3 font-medium">Maturity</th>
                  <th scope="col" className="py-3 text-right font-medium">Index</th>
                  <th scope="col" className="hidden py-3 text-right font-medium sm:table-cell">Bid / ask</th>
                  <th scope="col" className="py-3 text-right font-medium">Open interest</th>
                </tr>
              </thead>
              <tbody>
                {(state.series ?? []).map((s) => {
                  const b = state.books?.[s.series_id];
                  const change = Number(BigInt(s.index_twap_usdc_micros) - BigInt(s.initial_strike_usdc_micros)) / Number(s.initial_strike_usdc_micros);
                  return (
                    <tr key={s.series_id} className="border-t border-hairline">
                      <td className="py-4">
                        <div className="text-[15px] font-semibold text-ink">{s.series_id}</div>
                        <div className="text-[13px] text-body">matures {utcDate(s.maturity_timestamp_ms)}</div>
                      </td>
                      <td className="py-4 text-right">
                        <div className="num text-[16px] text-ink">{price(s.index_twap_usdc_micros)}</div>
                        <div className={`num text-[12.5px] ${change > 0 ? "text-up" : change < 0 ? "text-down" : "text-body"}`}>
                          {change > 0 ? "+" : ""}
                          {(change * 100).toFixed(1)}% vs strike
                        </div>
                      </td>
                      <td className="num hidden py-4 text-right text-[14px] text-body sm:table-cell">
                        {b?.best_bid_micros ? price(b.best_bid_micros) : "No bids"} / {b?.best_ask_micros ? price(b.best_ask_micros) : "No asks"}
                      </td>
                      <td className="num py-4 text-right text-[15px] text-ink">{cu(s.total_open_interest_cu, 0)} CU</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-6">
            <Link href="/dashboard/markets" className="link text-[15px]">
              Open the markets page
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function TwoSides() {
  return (
    <section className="bg-soft py-20 sm:py-24" aria-labelledby="sides-title">
      <div className="container-page">
        <h2 id="sides-title" className="max-w-[18ch] text-display-sm sm:text-display-md">
          Built for both sides of the GPU bill.
        </h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-card bg-hairline lg:grid-cols-2">
          <div className="bg-canvas p-8 sm:p-10">
            <h3 className="text-[22px] font-normal tracking-[-0.01em]">If your agents buy compute</h3>
            <ul className="mt-6 space-y-5 text-[15.5px] leading-6">
              <li>
                <span className="font-semibold">Hedge from a runway model.</span> <span className="text-body">The CFO agent hedges when its 30-day VaR passes 2% of budget, and buys forwards inside its guardrail.</span>
              </li>
              <li>
                <span className="font-semibold">Keep the treasury out of reach.</span> <span className="text-body">Agents sign with Function Call keys that can trade and can never withdraw.</span>
              </li>
              <li>
                <span className="font-semibold">Fund from Base or Solana.</span> <span className="text-body">One NEAR Intents quote routes USDC straight into the agent&apos;s margin account.</span>
              </li>
            </ul>
            <Link href="/dashboard/trade" className="btn-primary mt-8">
              Buy forwards on the desk
            </Link>
          </div>
          <div className="bg-canvas p-8 sm:p-10">
            <h3 className="text-[22px] font-normal tracking-[-0.01em]">If you sell GPU capacity</h3>
            <ul className="mt-6 space-y-5 text-[15.5px] leading-6">
              <li>
                <span className="font-semibold">Post 25% margin, not a 150% bond.</span> <span className="text-body">Pre-selling $100k of compute locks $25k, four times the capital efficiency of a 1.5× bond.</span>
              </li>
              <li>
                <span className="font-semibold">Get paid for delivered jobs.</span> <span className="text-body">A TEE receipt that meets the SLA releases the strike payment to you.</span>
              </li>
              <li>
                <span className="font-semibold">Know the liquidation price upfront.</span> <span className="text-body">Vault health is shown against the attested mark before you list.</span>
              </li>
            </ul>
            <Link href="/dashboard/trade?side=short" className="btn-outline mt-8">
              Pre-sell capacity
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Settlement({ state }: { state: TestnetState | null }) {
  const hedge = state?.run.events.find((e) => e.phase === "spike" && /Hedge marked/.test(e.title));
  const reds = state?.redemptions ?? [];
  return (
    <section id="settlement" className="bg-canvas py-20 sm:py-24" aria-labelledby="settlement-title">
      <div className="container-page">
        <h2 id="settlement-title" className="max-w-[20ch] text-display-sm sm:text-display-md">
          Every forward ends in cash or in compute.
        </h2>
        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <div>
            <h3 className="text-[24px] font-normal tracking-[-0.01em]">Mode A: cash at the attested index</h3>
            <p className="mt-3 text-[15.5px] leading-7 text-body">
              When the index spikes, the market pays the difference instead of your budget. At maturity a long receives Q × P<sub>index</sub> against a post-maturity OutLayer attestation. Early exit goes through the order book, so nobody can cherry-pick the oracle path.
            </p>
            <div className="mt-6 rounded-panel bg-soft p-5">
              <p className="text-[13px] text-body">On testnet today, the CFO agent&apos;s hedge</p>
              <p className="num mt-2 text-[15px] text-ink">500 CU × $4.1000 = $2,050.00</p>
              <p className="num text-[15px] text-body">cost $1,404.10 · <span className="text-up">+$645.90 marked</span></p>
              <p className="mt-2 text-[12.5px] text-muted">
                {hedge ? "Index path $2.80 to $4.10 attested on-chain. " : ""}Cash settlement opens after the 30 Nov maturity.
              </p>
            </div>
          </div>
          <div>
            <h3 className="text-[24px] font-normal tracking-[-0.01em]">Mode B: redeem for measured compute</h3>
            <p className="mt-3 text-[15.5px] leading-7 text-body">
              The enclave, not the provider, decides whether a job met its SLA. The provider runs the job behind an attested endpoint, and the TEE signs time to first token and throughput. A breach or a missed deadline refunds 100% plus a 15% penalty, with no human in the loop.
            </p>
            <ul className="mt-6 divide-y divide-hairline rounded-panel border border-hairline">
              {reds.length ? (
                reds.map((r) => {
                  return (
                    <li key={r.request_id} className="flex items-start justify-between gap-4 px-5 py-3.5 text-[14px]">
                      <span className="shrink-0">
                        <span className="block text-ink">Job #{r.request_id}</span>
                        <span className="num block text-[12.5px] text-body">{cu(r.cu_amount_scaled, 0)} CU</span>
                      </span>
                      <span className={`text-right ${redemptionLabel(r.state).tone === "up" ? "text-up" : "text-down"}`}>{redemptionLabel(r.state).text}</span>
                    </li>
                  );
                })
              ) : (
                <li className="px-5 py-4 text-[14px] text-body">Redemptions load from testnet.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Safety({ state }: { state: TestnetState | null }) {
  const drills = (state?.run.events ?? []).filter((e) => e.phase === "drill" && e.ok === false);
  const keyBlock = state?.run.events.find((e) => /Function Call key blocked/.test(e.title));
  const rows: Array<{ title: string; body: string; ev?: LiveEvent }> = [
    { title: "Slippage band", body: "Orders priced more than 150 bps over the attested TWAP never reach the book.", ev: drills[0] },
    { title: "Series allowlist", body: "Each agent trades only the maturities its treasury allows.", ev: drills[1] },
    { title: "Daily spend cap", body: "Spending resets each UTC day and stops at the cap.", ev: drills[2] },
    { title: "Keys that cannot withdraw", body: "Withdrawals need a 1 yoctoNEAR deposit, which a Function Call key cannot attach. NEAR itself refuses the transaction.", ev: keyBlock },
  ];
  return (
    <section id="safety" className="dark-band bg-night py-20 text-white sm:py-24" aria-labelledby="safety-title">
      <div className="container-page grid gap-12 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h2 id="safety-title" className="text-display-sm sm:text-display-md">
            Give an agent a budget, not the treasury.
          </h2>
          <p className="mt-4 text-[16px] leading-7 text-night-soft">
            The treasury sets each agent&apos;s policy on-chain. Every rule below was broken on purpose on testnet, and the contract said no each time.
          </p>
        </div>
        <ul className="divide-y divide-night-line border-y border-night-line">
          {rows.map((r) => (
            <li key={r.title} className="grid gap-2 py-5 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-baseline sm:gap-6">
              <p className="text-[16px] font-semibold">{r.title}</p>
              <p className="text-[15px] leading-6 text-night-soft">{r.body}</p>
              {r.ev?.url ? (
                <a href={r.ev.url} target="_blank" rel="noreferrer" className="text-[14px] font-medium text-night-accent underline decoration-night-accent/40 underline-offset-[3px] hover:decoration-night-accent">
                  Rejected tx<span className="sr-only"> on nearblocks (opens in a new tab)</span>
                </a>
              ) : r.ev ? (
                <span className="text-[14px] text-night-soft">Refused before broadcast</span>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Proof({ state }: { state: TestnetState | null }) {
  const contract = state?.accounts.contract ?? "market.paron-mwbjvxck.testnet";
  return (
    <section id="proof" className="bg-canvas py-20 sm:py-24" aria-labelledby="proof-title">
      <div className="container-page">
        <h2 id="proof-title" className="max-w-[20ch] text-display-sm sm:text-display-md">
          Check every claim yourself.
        </h2>
        <ul className="mt-12 divide-y divide-hairline border-y border-hairline">
          <li className="grid gap-3 py-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)_auto] md:items-baseline md:gap-8">
            <p className="text-[17px] font-semibold text-ink">Read the chain</p>
            <p className="text-[15px] leading-6 text-body">
              The deployment and the full agent run are {state ? <span className="num text-ink">{onChainTxCount(state)}</span> : "a set of"} transactions on NEAR testnet, each one linked on nearblocks.
            </p>
            <a href={explorerAccount(contract)} target="_blank" rel="noreferrer" className="link text-[15px]">
              Open the contract<span className="sr-only"> on nearblocks (opens in a new tab)</span>
            </a>
          </li>
          <li className="grid gap-3 py-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)_auto] md:items-baseline md:gap-8">
            <p className="text-[17px] font-semibold text-ink">Run the checks</p>
            <p className="text-[15px] leading-6 text-body">One command runs the contract tests, the TEE worker tests, the agent swarm and the web build, with no keys or wallet.</p>
            <code className="num whitespace-nowrap rounded-field bg-soft px-3 py-2 text-[13.5px] text-ink">npm run verify:all</code>
          </li>
          <li className="grid gap-3 py-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)_auto] md:items-baseline md:gap-8">
            <p className="text-[17px] font-semibold text-ink">Verify the receipt</p>
            <div className="text-[15px] leading-6 text-body">
              <p>The demo, the CLI and the API all produce the same receipt hash, and your browser re-checks every signature in it.</p>
              <div className="mt-1">
                <Hash value={RECEIPT_SHA} head={10} tail={6} />
              </div>
            </div>
            <Link href="/dashboard/audit" className="link text-[15px]">
              Inspect the receipt
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Closing({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="dark-band bg-night py-20 text-white sm:py-24" aria-labelledby="close-title">
      <div className="container-page flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
        <h2 id="close-title" className="max-w-[16ch] text-display-sm sm:text-display-md">
          Hedge your next GPU bill on testnet.
        </h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-primary h-14 px-8 text-[16px]">
            Open the desk
          </Link>
          <button type="button" onClick={onDemo} className="btn-outline-dark h-14 px-7 text-[16px]">
            Run the 60-second demo
          </button>
        </div>
      </div>
    </section>
  );
}

function Footer({ state }: { state: TestnetState | null }) {
  const contract = state?.accounts.contract ?? "market.paron-mwbjvxck.testnet";
  return (
    <footer className="border-t border-hairline bg-canvas">
      <div className="container-page flex flex-col gap-8 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[40ch]">
          <Wordmark />
          <p className="mt-2 text-[14px] text-body">Compute forwards for AI agents on NEAR. Testnet beta: test USDC has no value and nothing here is investment advice.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[14.5px] sm:grid-cols-3">
          <Link href="/dashboard" className="min-h-[32px] text-body hover:text-ink">Dashboard</Link>
          <Link href="/demo" className="min-h-[32px] text-body hover:text-ink">60-second demo</Link>
          <Link href="/dashboard/audit" className="min-h-[32px] text-body hover:text-ink">Audit receipt</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="min-h-[32px] text-body hover:text-ink">Source on GitHub</a>
          <a href={explorerAccount(contract)} target="_blank" rel="noreferrer" className="min-h-[32px] text-body hover:text-ink">Contract on nearblocks</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="min-h-[32px] text-body hover:text-ink">MIT license</a>
        </nav>
      </div>
      <div className="container-page">
        <p className="border-t border-hairline py-5 text-[12.5px] text-muted">Built at NEAR HACKATHON 2026 by Fatih Maulana.</p>
      </div>
    </footer>
  );
}

export function Landing() {
  const [demo, setDemo] = useState(false);
  const data = useTestnet(60_000);
  const openDemo = useMemo(() => () => setDemo(true), []);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-canvas focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <SiteHeader onDemo={openDemo} />
      <main id="main">
        <Hero onDemo={openDemo} data={data} />
        <Markets data={data} />
        <TwoSides />
        <Settlement state={data.state} />
        <Safety state={data.state} />
        <Proof state={data.state} />
        <Closing onDemo={openDemo} />
      </main>
      <Footer state={data.state} />
      <DemoChooser open={demo} onClose={() => setDemo(false)} />
    </>
  );
}
