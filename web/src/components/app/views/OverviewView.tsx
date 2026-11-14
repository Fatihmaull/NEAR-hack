"use client";

import Link from "next/link";
import { useMemo } from "react";
import { JUDGE_ACCOUNT, useDesk } from "@/lib/desk";
import { cu, plain, price, usd, utc } from "@/lib/format";
import { onChainTxCount, useTestnet } from "@/lib/testnet";
import { Badge, Loading, Panel, Progress } from "../../ui";
import { PageHeader, SimClock } from "../PageHeader";

export function OverviewView() {
  const { snapshot, sim, ready, events } = useDesk();
  const { state: testnet } = useTestnet(60_000);
  const bal = snapshot?.balances?.[JUDGE_ACCOUNT];
  const policy = useMemo(() => (sim ? (sim.runtime.view("get_agent_guardrail", { agent_id: JUDGE_ACCOUNT }) as Record<string, any> | null) : null), [sim, snapshot]);
  const spent = Number(policy?.spent_today_micros ?? 0) / 1e6;
  const cap = Number(policy?.max_daily_spend_micros ?? 0) / 1e6;
  const series = (snapshot?.series ?? []) as Array<{ series_id: string; index_twap_usdc_micros: string; initial_strike_usdc_micros: string; total_open_interest_cu: string }>;
  const held: string[] = bal?.cu ?? ["0", "0", "0"];
  const p = snapshot?.protocol;
  const invariants = (snapshot?.invariants ?? []) as Array<{ holds: boolean }>;
  const txs = sim?.runtime.txs ?? [];
  const rejected = txs.filter((t) => t.status === "Failure").length;
  const recent = events.filter((e) => e.actor !== "Tour").slice(-6).reverse();

  return (
    <>
      <PageHeader title="Overview" description="Where your desk agent stands, what the market is doing, and what to do next." actions={<SimClock ms={snapshot?.now_ms} />} />
      {!ready ? (
        <Loading>Starting the local engine. It replays the agents&apos; first three steps so the market has depth.</Loading>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Panel title="Your desk agent" description={<span className="font-mono text-[13px]">{JUDGE_ACCOUNT}</span>}>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-[13px] text-body">Free margin</p>
                  <p className="num mt-1 text-[36px] leading-none text-ink">{usd(bal?.free_usdc_micros)}</p>
                  <p className="mt-3 text-[13px] text-body">CU held, Nov / Dec / Jan</p>
                  <p className="num mt-0.5 text-[16px] text-ink">{held.map((c) => cu(c, 0)).join(" / ")}</p>
                </div>
                <div>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-body">Spent today</span>
                    <span className="num text-ink">
                      ${spent.toLocaleString("en-US", { maximumFractionDigits: 0 })} of ${cap.toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Progress value={spent} max={cap || 1} label="Desk agent daily spend" />
                  </div>
                  <p className="mt-3 text-[13.5px] leading-5 text-body">
                    Orders above the index plus {policy?.max_slippage_bps ?? 150} bps are rejected by the contract. The agent&apos;s key cannot withdraw.
                  </p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 border-t border-hairline pt-5">
                <Link href="/dashboard/trade" className="btn-primary btn-sm">
                  Buy forwards
                </Link>
                <Link href="/dashboard/trade?side=short" className="btn-outline btn-sm">
                  Pre-sell capacity
                </Link>
                <Link href="/dashboard/oracle" className="btn-outline btn-sm">
                  Move the index
                </Link>
              </div>
            </Panel>

            <Panel
              title="Market"
              description={
                <>
                  Simulated desk engine.{" "}
                  <Link href="/dashboard/testnet" className="link">
                    Live testnet prices
                  </Link>
                </>
              } actions={<Link href="/dashboard/markets" className="link text-[14px]">All markets</Link>} bodyClassName="px-0 py-1">
              <ul>
                {series.map((s) => {
                  const diff = BigInt(s.index_twap_usdc_micros) - BigInt(s.initial_strike_usdc_micros);
                  return (
                    <li key={s.series_id} className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-3.5 first:border-t-0">
                      <div>
                        <p className="text-[15px] font-semibold text-ink">{s.series_id}</p>
                        <p className="num text-[12.5px] text-body">{cu(s.total_open_interest_cu, 0)} CU open</p>
                      </div>
                      <div className="text-right">
                        <p className="num text-[16px] text-ink">{price(s.index_twap_usdc_micros)}</p>
                        <p className={`num text-[12.5px] ${diff > 0n ? "text-up" : diff < 0n ? "text-down" : "text-body"}`}>{diff === 0n ? "at strike" : `${diff > 0n ? "+" : ""}${price(diff)} vs strike`}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Panel title="Protocol health">
              <dl className="divide-y divide-hairline text-[14px]">
                <div className="flex justify-between gap-3 py-2.5 first:pt-0">
                  <dt className="text-body">Insurance pool</dt>
                  <dd className="num text-ink">{usd(p?.insurance_pool_micros)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-body">Genesis liquidity credit</dt>
                  <dd className="text-ink">{p?.withdrawals_enabled ? "Repaid, withdrawals open" : usd(p?.genesis_credit_outstanding_micros)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-body">Supply conservation</dt>
                  <dd>{invariants.length && invariants.every((i) => i.holds) ? <Badge tone="up">Holds in all series</Badge> : <Badge tone="down">Broken</Badge>}</dd>
                </div>
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-body">Signed transactions</dt>
                  <dd className="text-right text-ink">
                    <span className="num">{txs.length}</span> <span className="text-body">({rejected} refused by guardrails or keys)</span>
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-2.5 last:pb-0">
                  <dt className="text-body">On NEAR testnet</dt>
                  <dd>
                    <Link href="/dashboard/testnet" className="link">
                      {testnet ? `${onChainTxCount(testnet)} transactions` : "View the deployment"}
                    </Link>
                  </dd>
                </div>
              </dl>
            </Panel>

            <Panel title="Recent agent activity" actions={<Link href="/dashboard/agents" className="link text-[14px]">All activity</Link>} bodyClassName="px-0 py-1">
              <ol>
                {recent.map((e) => (
                  <li key={e.seq} className="flex items-start justify-between gap-3 border-t border-hairline px-5 py-3 first:border-t-0">
                    <p className="min-w-0 text-[14px] leading-5">
                      <span className="text-body">{e.actor.replace(/-/g, " ")}: </span>
                      <span className={e.ok === false ? "text-down" : "text-ink"}>{plain(e.title)}</span>
                    </p>
                    <span className="num shrink-0 text-[12px] text-muted">{utc(e.t).slice(11, 16)}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
