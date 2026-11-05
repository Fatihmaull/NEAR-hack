"use client";

import { useMemo, useState } from "react";
import { Banknote, Ban, CircleCheck, Clock, Gauge, Timer, Workflow } from "lucide-react";
import { SWARM_ACCOUNTS } from "@paron/agents";
import { useDesk } from "@/lib/desk";
import { cu, price, toMicros, usd, utc } from "@/lib/format";
import { Badge, Hash, Panel, Stat } from "./ui";

type StateJson = Record<string, Record<string, unknown>>;
interface RedemptionJson {
  request_id: number;
  cu_amount_scaled: string;
  strike_payment_micros: string;
  provider_collateral_micros: string;
  requested_at_ms: number;
  ack_deadline_ms: number;
  delivery_deadline_ms: number;
  state: StateJson;
  history: StateJson[];
}

const stateName = (s: StateJson) => Object.keys(s)[0];
const STATE_LABEL: Record<string, string> = {
  Requested: "Requested",
  Acknowledged: "Acknowledged",
  DeliveredViaTee: "Delivered via TEE",
  SlashedForSlaBreach: "SLA slash",
};

function Lifecycle({ r }: { r: RedemptionJson }) {
  const final = stateName(r.state);
  const slashed = final === "SlashedForSlaBreach";
  const body = r.state[final];
  return (
    <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-fg">#{r.request_id}</span>
          <span className="num text-[12px] text-fg-muted">{cu(r.cu_amount_scaled)} CU · strike {usd(r.strike_payment_micros)}</span>
        </div>
        {slashed ? (
          <Badge tone="danger">
            <Ban className="h-3 w-3" /> {String(body.reason)} → agent paid {usd(String(body.payout_micros))}
          </Badge>
        ) : final === "DeliveredViaTee" ? (
          <Badge tone="near">
            <CircleCheck className="h-3 w-3" /> provider paid {usd(BigInt(r.strike_payment_micros) + BigInt(r.provider_collateral_micros))} · {String(body.latency_ms)} ms
          </Badge>
        ) : (
          <Badge tone="warn">
            <Clock className="h-3 w-3" /> open · ack by {utc(r.ack_deadline_ms).slice(11)}
          </Badge>
        )}
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-1.5">
        {r.history.map((h, i) => {
          const name = stateName(h);
          const t = Object.values(h[name]).find((v) => typeof v === "number" && v > 1e12) as number | undefined;
          const tone = name === "SlashedForSlaBreach" ? "danger" : name === "DeliveredViaTee" ? "near" : "muted";
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 ? <span className="h-px w-4 bg-ink-500" /> : null}
              <Badge tone={tone}>
                {STATE_LABEL[name] ?? name}
                {t ? <span className="num text-fg-dim">{utc(t).slice(11, 16)}</span> : null}
              </Badge>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function RedemptionTimeline() {
  const { sim, snapshot, run, busy, version } = useDesk();
  const [finalTwap, setFinalTwap] = useState("4.10");
  const nov = (snapshot?.series ?? []).find((s: { series_id: string }) => s.series_id === "CU-2026-11");
  const position = useMemo(
    () => (sim ? (sim.runtime.view("get_long_position", { account_id: SWARM_ACCOUNTS.cfo, series_id: "CU-2026-11" }) as { cu_scaled: string; avg_entry_price_micros: string; cost_basis_micros: string }) : null),
    [sim, version],
  );
  const cash = (snapshot?.cash_receipts ?? []) as Array<Record<string, string>>;
  const receipt = cash[cash.length - 1];
  const redemptions = ((snapshot?.redemptions ?? []) as RedemptionJson[]).slice().reverse();
  const stats = snapshot?.provider_stats as { delivered_count: number; slashed_count: number; reliability_bps: number; penalties_paid_micros: string } | undefined;
  const index = nov ? BigInt(nov.index_twap_usdc_micros) : 0n;
  const q = position ? BigInt(position.cu_scaled) : 0n;
  const mtm = position && q > 0n ? (q * (index - BigInt(position.avg_entry_price_micros))) / 10_000n : 0n;

  const job = (kind: "happy" | "throttled" | "ghost") =>
    run(
      kind === "happy" ? "In-SLA TEE job" : kind === "throttled" ? "Throttled TEE job" : "Ghosted job",
      (s) => s.runRedemption(kind),
      (r) =>
        r.ok
          ? {
              kind: kind === "happy" ? "ok" : "info",
              title: kind === "happy" ? `Request #${r.requestId} delivered — provider paid` : `Request #${r.requestId} slashed — agent refunded 100% + 15%`,
              detail: kind === "ghost" ? "ack deadline (15 min) expired → permissionless claim_sla_breach_slash" : "OutLayer TDX receipt verified on-chain",
            }
          : { kind: "error", title: "Mode B request failed", detail: r.error },
    );

  return (
    <Panel title="Settlement & Redemption" icon={<Workflow className="h-4 w-4 text-near" />} right={<Badge tone="muted">Mode A cash hedge · Mode B TEE drawdown</Badge>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-near/25 bg-near/[0.04] p-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-near">
            <Banknote className="h-4 w-4" /> Mode A — index cash settlement at maturity
          </div>
          <p className="text-[12px] text-fg-muted">
            ΔV = Q × (P<sub>index</sub> − P<sub>strike</sub>). Longs are fully paid; at maturity every vault pays Q × P<sub>final</sub> from escrow + margin (insurance backstops
            shortfalls) and each CU redeems for the attested TWAP — exactly what the agent needs to pay its spiked NEAR AI Cloud bill.
          </p>
          <div className="grid grid-cols-2 gap-2 2xl:grid-cols-4">
            <Stat label="CFO position" value={`${cu(position?.cu_scaled ?? 0, 0)} CU`} sub="CU-2026-11" />
            <Stat label="Avg entry" value={price(position?.avg_entry_price_micros ?? 0)} />
            <Stat label="TEE index" value={price(index)} tone="tee" />
            <Stat label="Mark-to-index" value={usd(mtm)} tone={mtm >= 0n ? "near" : "danger"} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-32">
              <span className="label">Final TWAP</span>
              <input className="input" value={finalTwap} onChange={(e) => setFinalTwap(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={busy !== null || !sim || q === 0n}
              onClick={() =>
                run(
                  "Mode A settlement",
                  (s) => s.settleCfoAtMaturity(Number(toMicros(finalTwap))),
                  (r) => (r.ok ? { kind: "ok", title: "CFO hedge cash-settled at maturity" } : { kind: "error", title: "Mode A settlement failed", detail: r.error }),
                )
              }
            >
              <Timer className="h-4 w-4" /> Fast-forward to 2026-11-30 maturity & settle
            </button>
          </div>
          {receipt ? (
            <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-3 text-[12px]">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">CashSettledAtMaturity · receipt #{receipt.receipt_id}</span>
                <Badge tone={BigInt(receipt.hedge_pnl_micros) >= 0n ? "near" : "danger"}>ΔV {usd(receipt.hedge_pnl_micros)}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11.5px] text-fg-muted">
                <span>settled CU</span>
                <span className="text-right text-fg">{cu(receipt.cu_amount_scaled)}</span>
                <span>entry → index</span>
                <span className="text-right text-fg">
                  {price(receipt.avg_entry_price_micros)} → {price(receipt.index_price_micros)}
                </span>
                <span>payout</span>
                <span className="text-right text-near">{usd(receipt.payout_micros)}</span>
                <span>TEE quote</span>
                <span className="text-right">
                  <Hash value={receipt.tdx_quote_hash} head={10} tail={6} />
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-lg border border-tee/25 bg-tee/[0.04] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-tee">
              <Gauge className="h-4 w-4" /> Mode B — attested compute drawdown
            </div>
            {stats ? (
              <span className="font-mono text-[11px] text-fg-muted">
                provider reliability <span className={stats.reliability_bps >= 9000 ? "text-near" : "text-warn"}>{(stats.reliability_bps / 100).toFixed(1)}%</span> · {stats.delivered_count}✓ {stats.slashed_count}✕
              </span>
            ) : null}
          </div>
          <p className="text-[12px] text-fg-muted">
            CU-2026-12 inventory is escrowed against <span className="font-mono">batam-h100.testnet</span>. The OutLayer enclave measures TTFT ≤ 500 ms, ≥ 40 tok/s, ≥ 80 GB VRAM and
            signs <span className="font-mono">&quot;request:quote:latency:sla_met&quot;</span>. Breach or timeout ⇒ 100% refund + 15% penalty from the provider&apos;s margin.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy !== null || !sim} onClick={() => job("happy")}>
              Run in-SLA job (8× H100)
            </button>
            <button type="button" className="btn-danger" disabled={busy !== null || !sim} onClick={() => job("throttled")}>
              Run throttled job (sla_met=false)
            </button>
            <button type="button" className="btn-ghost" disabled={busy !== null || !sim} onClick={() => job("ghost")}>
              Ghost the provider (timeout)
            </button>
          </div>
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {redemptions.length ? redemptions.map((r) => <Lifecycle key={r.request_id} r={r} />) : <div className="rounded-lg border border-dashed border-ink-500 p-3 text-[12px] text-fg-dim">No redemptions yet.</div>}
          </div>
        </div>
      </div>
    </Panel>
  );
}
