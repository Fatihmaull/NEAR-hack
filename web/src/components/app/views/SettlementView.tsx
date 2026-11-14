"use client";

import { useMemo, useState } from "react";
import { SWARM_ACCOUNTS } from "@paron/agents";
import { useDesk } from "@/lib/desk";
import { cu, price, readableError, toMicros, usd, utc } from "@/lib/format";
import { Badge, EmptyState, Hash, Loading, Panel, Stat } from "../../ui";
import { PageHeader, SimClock } from "../PageHeader";

type StateJson = Record<string, Record<string, unknown>>;
interface RedemptionJson {
  request_id: number;
  cu_amount_scaled: string;
  strike_payment_micros: string;
  provider_collateral_micros: string;
  ack_deadline_ms: number;
  state: StateJson;
  history: StateJson[];
}

const stateName = (s: StateJson) => Object.keys(s)[0];
const LABEL: Record<string, string> = { Requested: "Requested", Acknowledged: "Acknowledged", DeliveredViaTee: "Delivered", SlashedForSlaBreach: "Slashed" };

function Redemption({ r }: { r: RedemptionJson }) {
  const final = stateName(r.state);
  const body = r.state[final];
  const slashed = final === "SlashedForSlaBreach";
  return (
    <li className="border-t border-hairline px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[14.5px] text-ink">
          Job #{r.request_id} <span className="num text-body">· {cu(r.cu_amount_scaled)} CU · strike {usd(r.strike_payment_micros)}</span>
        </p>
        {slashed ? (
          <Badge tone="down">Slashed: {String(body.reason).replace(/_/g, " ")}</Badge>
        ) : final === "DeliveredViaTee" ? (
          <Badge tone="up">Delivered in {String(body.latency_ms)} ms</Badge>
        ) : (
          <Badge tone="warn">Open, ack by {utc(r.ack_deadline_ms).slice(11)}</Badge>
        )}
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-body" aria-label="Lifecycle">
        {r.history.map((h, i) => {
          const name = stateName(h);
          const t = Object.values(h[name]).find((v) => typeof v === "number" && v > 1e12) as number | undefined;
          return (
            <li key={i} className="flex items-center gap-2">
              {i > 0 ? <span aria-hidden className="text-muted">→</span> : null}
              <span className={name === "SlashedForSlaBreach" ? "text-down" : name === "DeliveredViaTee" ? "text-up" : ""}>{LABEL[name] ?? name}</span>
              {t ? <span className="num text-muted">{utc(t).slice(11, 16)}</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-[13px] text-body">
        {slashed ? `Agent received ${usd(String(body.payout_micros))}: the strike back plus 15% from the provider's margin.` : final === "DeliveredViaTee" ? `Provider paid ${usd(BigInt(r.strike_payment_micros) + BigInt(r.provider_collateral_micros))}.` : "Waiting for the provider."}
      </p>
    </li>
  );
}

export function SettlementView() {
  const { sim, snapshot, run, busy, version, ready } = useDesk();
  const [finalTwap, setFinalTwap] = useState("4.10");
  const nov = (snapshot?.series ?? []).find((s: { series_id: string }) => s.series_id === "CU-2026-11");
  const position = useMemo(
    () => (sim ? (sim.runtime.view("get_long_position", { account_id: SWARM_ACCOUNTS.cfo, series_id: "CU-2026-11" }) as { cu_scaled: string; avg_entry_price_micros: string }) : null),
    [sim, version],
  );
  const cash = (snapshot?.cash_receipts ?? []) as Array<Record<string, string>>;
  const receipt = cash[cash.length - 1];
  const redemptions = ((snapshot?.redemptions ?? []) as RedemptionJson[]).slice().reverse();
  const stats = snapshot?.provider_stats as { delivered_count: number; slashed_count: number; reliability_bps: number } | undefined;
  const index = nov ? BigInt(nov.index_twap_usdc_micros) : 0n;
  const q = position ? BigInt(position.cu_scaled) : 0n;
  const mtm = position && q > 0n ? (q * (index - BigInt(position.avg_entry_price_micros))) / 10_000n : 0n;
  const twapInvalid = !finalTwap || Number(finalTwap) <= 0;

  const job = (kind: "happy" | "throttled" | "ghost") =>
    run(
      kind === "happy" ? "Running an in-SLA job" : kind === "throttled" ? "Running a throttled job" : "Waiting out the acknowledgement window",
      (s) => s.runRedemption(kind),
      (r) =>
        r.ok
          ? {
              kind: kind === "happy" ? "ok" : "info",
              title: kind === "happy" ? `Job #${r.requestId} delivered, provider paid` : `Job #${r.requestId} slashed, agent refunded 100% plus 15%`,
              detail: kind === "ghost" ? "The 15-minute acknowledgement deadline passed, so anyone could claim the slash." : "The TEE receipt was verified on-chain.",
            }
          : { kind: "error", title: "Redemption failed", detail: readableError(r.error) },
    );

  return (
    <>
      <PageHeader
        title="Settlement"
        description="Forwards end in cash at the attested index (Mode A) or are redeemed for compute that the TEE measures (Mode B)."
        actions={<SimClock ms={snapshot?.now_ms} />}
      />
      {!ready ? (
        <Loading>Starting the local engine…</Loading>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <Panel title="Mode A: cash at maturity" description="A long receives Q × P_index against a post-maturity attestation.">
            <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="CFO position" value={`${cu(position?.cu_scaled ?? 0, 0)} CU`} sub="CU-2026-11" />
              <Stat label="Average entry" value={price(position?.avg_entry_price_micros ?? 0)} />
              <Stat label="Attested index" value={price(index)} />
              <Stat label="Marked value change" value={usd(mtm)} tone={mtm > 0n ? "up" : mtm < 0n ? "down" : "neutral"} />
            </dl>
            <form
              className="mt-6 flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (twapInvalid) return;
                run(
                  "Settling at maturity",
                  (s) => s.settleCfoAtMaturity(Number(toMicros(finalTwap))),
                  (r) => (r.ok ? { kind: "ok", title: "Hedge cash-settled at maturity" } : { kind: "error", title: "Settlement failed", detail: readableError(r.error) }),
                );
              }}
            >
              <div className="w-40">
                <label htmlFor="final-twap" className="field-label">
                  Final TWAP ($/CU)
                </label>
                <input id="final-twap" className="field num" inputMode="decimal" value={finalTwap} aria-invalid={twapInvalid} onChange={(e) => setFinalTwap(e.target.value.replace(/[^0-9.]/g, ""))} />
              </div>
              <button type="submit" className="btn-primary flex-1" disabled={busy !== null || q === 0n || twapInvalid}>
                Jump to 30 Nov maturity and settle
              </button>
            </form>
            {q === 0n && !receipt ? <p className="mt-3 text-[13px] text-body">The CFO agent holds no CU-2026-11 position to settle.</p> : null}
            {receipt ? (
              <div className="mt-6 rounded-field bg-soft p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[14.5px] font-semibold text-ink">Settlement receipt #{receipt.receipt_id}</p>
                  <p className={`num text-[15px] ${BigInt(receipt.hedge_pnl_micros) >= 0n ? "text-up" : "text-down"}`}>
                    {BigInt(receipt.hedge_pnl_micros) >= 0n ? "+" : ""}
                    {usd(receipt.hedge_pnl_micros)} value change
                  </p>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13.5px]">
                  <dt className="text-body">Settled</dt>
                  <dd className="num text-right text-ink">{cu(receipt.cu_amount_scaled)} CU</dd>
                  <dt className="text-body">Entry to index</dt>
                  <dd className="num text-right text-ink">
                    {price(receipt.avg_entry_price_micros)} → {price(receipt.index_price_micros)}
                  </dd>
                  <dt className="text-body">Payout</dt>
                  <dd className="num text-right text-ink">{usd(receipt.payout_micros)}</dd>
                  <dt className="text-body">TEE quote</dt>
                  <dd className="text-right">
                    <Hash value={receipt.tdx_quote_hash} head={10} tail={6} />
                  </dd>
                </dl>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Mode B: redeem for compute"
            description="SLA: first token within 500 ms, at least 40 tokens per second, 80 GB VRAM. A breach or timeout refunds 100% plus 15%."
            bodyClassName="px-0 pb-1 pt-4"
          >
            <div className="px-5">
              {stats ? (
                <p className="text-[13.5px] text-body">
                  Provider <span className="font-mono text-ink">{SWARM_ACCOUNTS.provider}</span> reliability{" "}
                  <span className={`num ${stats.reliability_bps >= 9000 ? "text-up" : "text-warn"}`}>{(stats.reliability_bps / 100).toFixed(1)}%</span>: {stats.delivered_count} delivered, {stats.slashed_count} slashed
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary btn-sm" disabled={busy !== null} onClick={() => job("happy")}>
                  Run a job within SLA
                </button>
                <button type="button" className="btn-danger btn-sm" disabled={busy !== null} onClick={() => job("throttled")}>
                  Run a throttled job
                </button>
                <button type="button" className="btn-outline btn-sm" disabled={busy !== null} onClick={() => job("ghost")}>
                  Let the provider go silent
                </button>
              </div>
            </div>
            <div className="mt-4 border-t border-hairline">
              {redemptions.length ? (
                <ul className="relative max-h-[440px] overflow-y-auto">{redemptions.map((r) => <Redemption key={r.request_id} r={r} />)}</ul>
              ) : (
                <div className="p-5">
                  <EmptyState title="No redemptions yet">Run a job above to escrow CU with the provider and watch the enclave decide.</EmptyState>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
