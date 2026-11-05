"use client";

import { useMemo, useState } from "react";
import { Calculator, Layers } from "lucide-react";
import { GPU_LABELS, GPU_TIERS, GPU_WEIGHT_BPS, hardwareToCuScaled, notional, type GpuTier } from "@paron/agents";
import { useDesk } from "@/lib/desk";
import { cu, price, toScaled, usd, utcDate } from "@/lib/format";
import { Badge, Panel } from "./ui";

interface SeriesJson {
  series_id: string;
  label: string;
  maturity_timestamp_ms: number;
  initial_strike_usdc_micros: string;
  mark_price_usdc_micros: string;
  index_twap_usdc_micros: string;
  total_open_interest_cu: string;
  total_volume_cu: string;
  is_settled: boolean;
  final_settlement_price_micros: string | null;
  last_tee_attestation_hash: string;
}

function ForwardCurve({ series }: { series: SeriesJson[] }) {
  const W = 360;
  const H = 120;
  const pad = 26;
  const values = series.flatMap((s) => [Number(s.index_twap_usdc_micros), Number(s.initial_strike_usdc_micros)]);
  const min = Math.min(...values) * 0.97;
  const max = Math.max(...values) * 1.03;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, series.length - 1);
  const y = (v: number) => H - pad + 6 - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const line = (key: "index_twap_usdc_micros" | "initial_strike_usdc_micros") => series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(Number(s[key]))}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[130px] w-full" role="img" aria-label="CU forward curve">
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={pad} x2={W - pad} y1={pad - 6 + t * (H - pad * 2)} y2={pad - 6 + t * (H - pad * 2)} stroke="#1d2636" strokeDasharray="3 4" />
      ))}
      <path d={line("initial_strike_usdc_micros")} fill="none" stroke="#5f6b80" strokeWidth="1.5" strokeDasharray="5 4" />
      <path d={line("index_twap_usdc_micros")} fill="none" stroke="#2ee6a6" strokeWidth="2" />
      {series.map((s, i) => (
        <g key={s.series_id}>
          <circle cx={x(i)} cy={y(Number(s.index_twap_usdc_micros))} r="3.5" fill="#2ee6a6" />
          <text x={x(i)} y={y(Number(s.index_twap_usdc_micros)) - 8} textAnchor="middle" className="fill-fg font-mono text-[9.5px]">
            {price(s.index_twap_usdc_micros).slice(0, 5)}
          </text>
          <text x={x(i)} y={H - 4} textAnchor="middle" className="fill-fg-dim font-mono text-[9px]">
            {s.series_id}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function SeriesMatrix() {
  const { snapshot } = useDesk();
  const [tier, setTier] = useState<GpuTier>("H200");
  const [hours, setHours] = useState("40");
  const [costSeries, setCostSeries] = useState("CU-2026-12");
  const series = (snapshot?.series ?? []) as SeriesJson[];
  const books = (snapshot?.books ?? {}) as Record<string, { best_bid_micros: string | null; best_ask_micros: string | null }>;
  const now = snapshot?.now_ms ?? 0;

  const converted = useMemo(() => {
    try {
      return hardwareToCuScaled(tier, toScaled(hours || "0"));
    } catch {
      return 0n;
    }
  }, [tier, hours]);
  const fwd = series.find((s) => s.series_id === costSeries);
  const ask = books[costSeries]?.best_ask_micros;
  const hedgeCost = fwd ? notional(converted, BigInt(ask ?? fwd.index_twap_usdc_micros)) : 0n;

  return (
    <Panel title="NEP-245 Series Matrix" icon={<Layers className="h-4 w-4 text-near" />} right={<Badge tone="muted">1 CU = 1 h H100 SXM 80GB</Badge>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-[12.5px] [&_td]:whitespace-nowrap [&_td]:px-1.5 [&_th]:whitespace-nowrap [&_th]:px-1.5">
          <thead className="text-[10.5px] uppercase tracking-wider text-fg-dim">
            <tr>
              <th className="pb-2 font-medium">Token id</th>
              <th className="pb-2 font-medium">Maturity</th>
              <th className="pb-2 text-right font-medium">Strike</th>
              <th className="pb-2 text-right font-medium">CRI-H100 TWAP</th>
              <th className="pb-2 text-right font-medium">Bid / Ask</th>
              <th className="pb-2 text-right font-medium">OI (CU)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {series.map((s) => {
              const b = books[s.series_id];
              const matured = now >= s.maturity_timestamp_ms;
              return (
                <tr key={s.series_id} className="align-top">
                  <td className="py-2">
                    <div className="font-mono font-semibold text-fg">{s.series_id}</div>
                    <div className="text-[11px] text-fg-dim">{s.label.replace(/ forward /, " · ")}</div>
                  </td>
                  <td className="py-2">
                    <div className="num text-fg-muted">{utcDate(s.maturity_timestamp_ms)}</div>
                    {s.is_settled ? <Badge tone="intents">settled @ {price(s.final_settlement_price_micros)}</Badge> : matured ? <Badge tone="warn">matured</Badge> : <Badge tone="near">trading</Badge>}
                  </td>
                  <td className="num py-2 text-right text-fg-muted">{price(s.initial_strike_usdc_micros)}</td>
                  <td className="num py-2 text-right text-near">{price(s.index_twap_usdc_micros)}</td>
                  <td className="num py-2 text-right">
                    <span className="text-near/90">{b?.best_bid_micros ? price(b.best_bid_micros) : "—"}</span>
                    <span className="text-fg-dim"> / </span>
                    <span className="text-danger/90">{b?.best_ask_micros ? price(b.best_ask_micros) : "—"}</span>
                  </td>
                  <td className="num py-2 text-right">{cu(s.total_open_interest_cu, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-2">
          <div className="flex items-center justify-between px-1 text-[10.5px] uppercase tracking-wider text-fg-dim">
            <span>Forward curve</span>
            <span className="flex items-center gap-3 normal-case tracking-normal">
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 bg-near" /> attested index
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 border-t border-dashed border-fg-dim" /> strike
              </span>
            </span>
          </div>
          {series.length ? <ForwardCurve series={series} /> : <div className="h-[130px]" />}
        </div>

        <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">
            <Calculator className="h-3.5 w-3.5 text-tee" /> Hardware → CU equivalent
          </div>
          <div className="grid grid-cols-5 gap-1">
            {GPU_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                title={GPU_LABELS[t]}
                className={`rounded-md border px-1 py-1.5 text-center font-mono text-[11px] transition ${tier === t ? "border-tee/60 bg-tee/10 text-tee" : "border-ink-500 text-fg-muted hover:border-ink-400"}`}
              >
                {t}
                <div className="text-[9.5px] text-fg-dim">{(Number(GPU_WEIGHT_BPS[t]) / 10_000).toFixed(2)}x</div>
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">GPU hours</span>
              <input className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label className="block">
              <span className="label">Hedge in series</span>
              <select className="input" value={costSeries} onChange={(e) => setCostSeries(e.target.value)}>
                {series.map((s) => (
                  <option key={s.series_id}>{s.series_id}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-ink-800 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[10.5px] uppercase tracking-wider text-fg-dim">Canonical volume</div>
              <div className="num whitespace-nowrap text-xl font-semibold text-tee">{cu(converted)} CU</div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[10.5px] uppercase tracking-wider text-fg-dim">Cost @ {ask ? "best ask" : "index"}</div>
              <div className="num whitespace-nowrap text-xl font-semibold text-fg">{usd(hedgeCost)}</div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
