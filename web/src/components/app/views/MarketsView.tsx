"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { GPU_LABELS, GPU_TIERS, GPU_WEIGHT_BPS, hardwareToCuScaled, notional, type GpuTier } from "@paron/agents";
import { useDesk } from "@/lib/desk";
import { cu, price, toScaled, usd, utcDate } from "@/lib/format";
import { ForwardCurve } from "../../ForwardCurve";
import { Badge, Loading, Panel } from "../../ui";
import { PageHeader, SimClock } from "../PageHeader";

interface SeriesJson {
  series_id: string;
  label: string;
  maturity_timestamp_ms: number;
  initial_strike_usdc_micros: string;
  index_twap_usdc_micros: string;
  total_open_interest_cu: string;
  total_volume_cu: string;
  is_settled: boolean;
  final_settlement_price_micros: string | null;
}

export function MarketsView() {
  const { snapshot } = useDesk();
  const [tier, setTier] = useState<GpuTier>("H200");
  const [hours, setHours] = useState("40");
  const [hedgeSeries, setHedgeSeries] = useState("CU-2026-12");
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
  const target = series.find((s) => s.series_id === hedgeSeries);
  const ask = books[hedgeSeries]?.best_ask_micros;
  const cost = target ? notional(converted, BigInt(ask ?? target.index_twap_usdc_micros)) : 0n;

  return (
    <>
      <PageHeader
        title="Markets"
        description="Three NEP-245 maturities priced in CU, one hour of an H100 SXM. The index is the OutLayer-attested CRI-H100 TWAP."
        actions={<SimClock ms={snapshot?.now_ms} />}
      />
      {!series.length ? (
        <Loading>Starting the local engine and reading the series…</Loading>
      ) : (
        <div className="space-y-5">
          <Panel title="Series" description="Index against strike, best bid and ask, and open interest." bodyClassName="px-0 pb-1 pt-3">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="text-[12.5px] text-body">
                    <th scope="col" className="pb-2 pl-5 font-medium">Series</th>
                    <th scope="col" className="pb-2 font-medium">Status</th>
                    <th scope="col" className="pb-2 text-right font-medium">Strike</th>
                    <th scope="col" className="pb-2 text-right font-medium">Index</th>
                    <th scope="col" className="pb-2 text-right font-medium">Bid / ask</th>
                    <th scope="col" className="pb-2 pr-5 text-right font-medium">Open interest</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => {
                    const b = books[s.series_id];
                    const diff = BigInt(s.index_twap_usdc_micros) - BigInt(s.initial_strike_usdc_micros);
                    return (
                      <tr key={s.series_id} className="border-t border-hairline">
                        <td className="py-3.5 pl-5">
                          <div className="text-[15px] font-semibold text-ink">{s.series_id}</div>
                          <div className="text-[13px] text-body">matures {utcDate(s.maturity_timestamp_ms)}</div>
                        </td>
                        <td className="py-3.5">
                          {s.is_settled ? <Badge tone="primary">Settled at {price(s.final_settlement_price_micros)}</Badge> : now >= s.maturity_timestamp_ms ? <Badge tone="warn">Matured</Badge> : <Badge tone="up">Trading</Badge>}
                        </td>
                        <td className="num py-3.5 text-right text-[14px] text-body">{price(s.initial_strike_usdc_micros)}</td>
                        <td className="py-3.5 text-right">
                          <div className="num text-[15px] text-ink">{price(s.index_twap_usdc_micros)}</div>
                          <div className={`num text-[12.5px] ${diff > 0n ? "text-up" : diff < 0n ? "text-down" : "text-body"}`}>{diff === 0n ? "at strike" : `${diff > 0n ? "+" : ""}${price(diff)} vs strike`}</div>
                        </td>
                        <td className="num py-3.5 text-right text-[14px] text-body">
                          {b?.best_bid_micros ? price(b.best_bid_micros) : "no bids"} / {b?.best_ask_micros ? price(b.best_ask_micros) : "no asks"}
                        </td>
                        <td className="num py-3.5 pr-5 text-right text-[15px] text-ink">{cu(s.total_open_interest_cu, 0)} CU</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel title="Forward curve" description="Solid: attested index. Dashed: each series' strike.">
              <ForwardCurve points={series.map((s) => ({ id: s.series_id, index: BigInt(s.index_twap_usdc_micros), strike: BigInt(s.initial_strike_usdc_micros) }))} height={190} title="Attested index against strike across the three maturities" />
            </Panel>

            <Panel title="What will my GPU hours cost?" description="Convert any chip into CU and price it at the best ask.">
              <fieldset>
                <legend className="field-label">GPU</legend>
                <div className="grid grid-cols-5 gap-2">
                  {GPU_TIERS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={tier === t}
                      onClick={() => setTier(t)}
                      title={GPU_LABELS[t]}
                      className={`min-h-[56px] rounded-field border px-1 text-center transition-colors ${tier === t ? "border-primary bg-primary-soft text-ink" : "border-hairline text-body hover:border-hairline-strong hover:text-ink"}`}
                    >
                      <span className="block text-[13.5px] font-semibold">{t}</span>
                      <span className="num block text-[12px]">{(Number(GPU_WEIGHT_BPS[t]) / 10_000).toFixed(2)}×</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="gpu-hours" className="field-label">
                    GPU hours
                  </label>
                  <input id="gpu-hours" className="field num" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
                <div>
                  <label htmlFor="hedge-series" className="field-label">
                    Hedge in
                  </label>
                  <select id="hedge-series" className="field" value={hedgeSeries} onChange={(e) => setHedgeSeries(e.target.value)}>
                    {series.map((s) => (
                      <option key={s.series_id}>{s.series_id}</option>
                    ))}
                  </select>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-4 rounded-field bg-soft p-4">
                <div>
                  <dt className="text-[13px] text-body">Equivalent</dt>
                  <dd className="num mt-0.5 text-[22px] text-ink">{cu(converted)} CU</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-body">Cost at {ask ? "best ask" : "index"}</dt>
                  <dd className="num mt-0.5 text-[22px] text-ink">{usd(cost)}</dd>
                </div>
              </dl>
              <Link href="/dashboard/trade" className="btn-primary mt-5 w-full">
                Buy {cu(converted, 0)} CU on the desk
              </Link>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
