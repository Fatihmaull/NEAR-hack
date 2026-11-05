"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartCandlestick, Send, Vault } from "lucide-react";
import { useDesk, JUDGE_ACCOUNT } from "@/lib/desk";
import { cu, pct, price, toMicros, toScaled, usd } from "@/lib/format";
import { functionCall, PARON_CONTRACT_ID, USDC_TOKEN_ID, useWallet } from "@/lib/wallet";
import { Badge, Hash, Panel, Segmented, Stat } from "./ui";

interface Level {
  price_micros: string;
  cu_scaled: string;
  orders: number;
}
interface BookJson {
  bids: Level[];
  asks: Level[];
  best_bid_micros: string | null;
  best_ask_micros: string | null;
  index_twap_usdc_micros: string;
}
interface VaultJson {
  vault_id: number;
  provider: string;
  shorted_cu_scaled: string;
  entry_price_micros: string;
  locked_collateral_micros: string;
  listed_cu_scaled: string;
  status: string;
}
interface HealthJson {
  vault_id: number;
  health_bps: number | null;
  liquidation_price_micros: string | null;
  is_liquidatable: boolean;
  equity_micros: string;
}

const SERIES = ["CU-2026-11", "CU-2026-12", "CU-2027-01"] as const;
const short = (a: string) => a.replace(".swarm-treasury.testnet", "").replace(".testnet", "");

function Ladder({ book, closed }: { book: BookJson; closed: boolean }) {
  const asks = [...book.asks].slice(0, 6).reverse();
  const bids = book.bids.slice(0, 6);
  const max = Math.max(1, ...[...asks, ...bids].map((l) => Number(l.cu_scaled)));
  const row = (l: Level, side: "ask" | "bid") => (
    <div key={`${side}-${l.price_micros}`} className="relative grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2 py-[3px] font-mono text-[12px]">
      <div className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-danger/10" : "bg-near/10"}`} style={{ width: `${(Number(l.cu_scaled) / max) * 100}%` }} />
      <span className={`relative ${side === "ask" ? "text-danger" : "text-near"}`}>{price(l.price_micros)}</span>
      <span className="relative text-right text-fg">{cu(l.cu_scaled, 0)}</span>
      <span className="relative w-6 text-right text-fg-dim">{l.orders}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-ink-600/70 bg-ink-850 py-1">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-2 pb-1 text-[10px] uppercase tracking-wider text-fg-dim">
        <span>Price / CU</span>
        <span className="text-right">Size (CU)</span>
        <span className="w-6 text-right">#</span>
      </div>
      {asks.length ? asks.map((l) => row(l, "ask")) : <div className="px-2 py-2 text-xs text-fg-dim">{closed ? "series settled — book closed, longs redeem at the final TWAP" : "no asks inside the ±5% stale-quote band"}</div>}
      <div className="my-1 flex items-center justify-between border-y border-ink-600/70 bg-ink-800 px-2 py-1.5 font-mono text-[11.5px]">
        <span className="text-tee">TEE index {price(book.index_twap_usdc_micros)}</span>
        <span className="text-fg-dim">
          spread {book.best_ask_micros && book.best_bid_micros ? price(BigInt(book.best_ask_micros) - BigInt(book.best_bid_micros)) : "—"}
        </span>
      </div>
      {bids.length ? bids.map((l) => row(l, "bid")) : <div className="px-2 py-2 text-xs text-fg-dim">no bids</div>}
    </div>
  );
}

export function OrderBookDesk() {
  const { snapshot, run, busy } = useDesk();
  const wallet = useWallet();
  const [series, setSeries] = useState<(typeof SERIES)[number]>("CU-2026-11");
  const [side, setSide] = useState<"buy" | "short">("buy");
  const [qty, setQty] = useState("50");
  const [limit, setLimit] = useState("");
  const [marginPct, setMarginPct] = useState(25);
  const book = snapshot?.books?.[series] as BookJson | undefined;
  const index = BigInt(book?.index_twap_usdc_micros ?? "0");

  useEffect(() => {
    if (!book) return;
    const idx = BigInt(book.index_twap_usdc_micros);
    const def = side === "buy" ? (idx * 10_150n) / 10_000n : (idx * 10_025n) / 10_000n;
    setLimit((Number(def) / 1e6).toFixed(4));
  }, [series, side, book?.index_twap_usdc_micros]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = useMemo(() => {
    try {
      return toScaled(qty || "0");
    } catch {
      return 0n;
    }
  }, [qty]);
  const p = useMemo(() => {
    try {
      return toMicros(limit || "0");
    } catch {
      return 0n;
    }
  }, [limit]);
  const notionalMicros = (q * p) / 10_000n;
  const margin = (notionalMicros * BigInt(marginPct)) / 100n;
  const liqPrice = q > 0n ? ((margin + notionalMicros) * 10_000n * 10_000n) / (q * 11_500n) : 0n;
  const legacyBond = (notionalMicros * 3n) / 2n;
  const ceiling = (index * 10_150n) / 10_000n;
  const vaults = ((snapshot?.vaults?.[series] ?? []) as VaultJson[]).filter((v) => v.status === "Active" && (BigInt(v.shorted_cu_scaled) > 0n || BigInt(v.listed_cu_scaled) > 0n));
  const health = new Map(((snapshot?.vault_health?.[series] ?? []) as HealthJson[]).map((h) => [h.vault_id, h]));
  const judgeFree = snapshot?.balances?.[JUDGE_ACCOUNT]?.free_usdc_micros;

  const submitLocal = () =>
    run(
      side === "buy" ? "agent_buy_forward" : "open_short_supply",
      async (_sim, judge) =>
        side === "buy"
          ? judge.call<any>("agent_buy_forward", { series_id: series, cu_amount_scaled: q.toString(), max_price_micros: p.toString() })
          : judge.call<any>("open_short_supply", { series_id: series, cu_amount_scaled: q.toString(), ask_price_micros: p.toString(), margin_deposit_micros: margin.toString() }),
      (out) =>
        out.ok
          ? {
              kind: "ok",
              title: side === "buy" ? `Bought ${cu(out.result.filled_cu_scaled)} CU @ ${price(out.result.avg_price_micros)}` : `Short supply live in vault #${out.result.vault_id}`,
              detail:
                side === "buy"
                  ? `${out.result.fills.length} fill(s) · ${usd(out.result.notional_micros)} · NEP-245 ${series} minted to ${JUDGE_ACCOUNT}`
                  : `margin ${usd(out.result.margin_deposit_micros)} (25% requirement ${usd(out.result.required_initial_margin_micros)}) · filled ${cu(out.result.trade.filled_cu_scaled)} CU instantly`,
              txHash: out.txHash,
            }
          : { kind: "error", title: "Rejected on-chain", detail: out.error, txHash: out.txHash },
    );

  const submitTestnet = async () => {
    const args =
      side === "buy"
        ? { series_id: series, cu_amount_scaled: q.toString(), price_micros: p.toString() }
        : { series_id: series, cu_amount_scaled: q.toString(), ask_price_micros: p.toString(), margin_deposit_micros: margin.toString() };
    await wallet.send(PARON_CONTRACT_ID, [functionCall(side === "buy" ? "place_bid" : "open_short_supply", args)]);
  };
  const depositTestnet = async () => {
    const amount = side === "buy" ? notionalMicros : margin;
    await wallet.send(USDC_TOKEN_ID, [functionCall("ft_transfer_call", { receiver_id: PARON_CONTRACT_ID, amount: amount.toString(), msg: "" }, "1", "100000000000000")]);
  };

  return (
    <Panel
      title="Order Book Desk"
      icon={<ChartCandlestick className="h-4 w-4 text-near" />}
      right={<Segmented value={series} options={SERIES.map((s) => ({ value: s, label: s }))} onChange={setSeries} />}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-3">
          {book ? <Ladder book={book} closed={Boolean((snapshot?.series ?? []).find((x: { series_id: string; is_settled: boolean }) => x.series_id === series)?.is_settled)} /> : <div className="h-72 animate-pulse rounded-lg bg-ink-850" />}
          <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-2">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">
              <Vault className="h-3.5 w-3.5" /> Short margin vaults ({series})
            </div>
            <table className="w-full text-[11.5px]">
              <thead className="text-[10px] uppercase text-fg-dim">
                <tr>
                  <th className="px-1 text-left font-medium">#</th>
                  <th className="px-1 text-left font-medium">provider</th>
                  <th className="px-1 text-right font-medium">open</th>
                  <th className="px-1 text-right font-medium">entry</th>
                  <th className="px-1 text-right font-medium">health</th>
                  <th className="px-1 text-right font-medium">liq.</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {vaults.map((v) => {
                  const h = health.get(v.vault_id);
                  const tone = h?.is_liquidatable ? "text-danger" : h?.health_bps !== null && (h?.health_bps ?? 99999) < 2500 ? "text-warn" : "text-near";
                  return (
                    <tr key={v.vault_id} className="border-t border-ink-700">
                      <td className="px-1 py-1 text-fg-dim">{v.vault_id}</td>
                      <td className="max-w-[110px] truncate px-1 py-1 text-fg-muted">{short(v.provider)}</td>
                      <td className="px-1 py-1 text-right">{cu(v.shorted_cu_scaled, 0)}</td>
                      <td className="px-1 py-1 text-right text-fg-muted">{BigInt(v.shorted_cu_scaled) > 0n ? price(v.entry_price_micros) : "—"}</td>
                      <td className={`px-1 py-1 text-right ${tone}`}>{h ? pct(h.health_bps) : "—"}</td>
                      <td className="px-1 py-1 text-right text-fg-muted">{h?.liquidation_price_micros ? price(h.liquidation_price_micros) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Segmented
              value={side}
              options={[
                { value: "buy", label: "Buy Forward" },
                { value: "short", label: "Open Short Supply" },
              ]}
              onChange={setSide}
            />
            <span className="font-mono text-[11px] text-fg-dim">
              desk margin <span className="text-fg">{usd(judgeFree)}</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="label">Quantity (CU)</span>
              <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label>
              <span className="label">{side === "buy" ? "Max price ($/CU)" : "Ask price ($/CU)"}</span>
              <input className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
          </div>

          {side === "buy" ? (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Notional cap" value={usd(notionalMicros)} />
              <Stat label="Guardrail ceiling" value={price(ceiling)} sub="TWAP + 150 bps" tone={p > ceiling ? "danger" : "near"} />
              <Stat label="Signer" value="FC key" sub="scoped · no deposit" tone="tee" />
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-ink-600/70 bg-ink-850 p-3">
              <div className="flex items-center justify-between text-[11px] text-fg-muted">
                <span className="label mb-0">Capital-efficiency margin slider</span>
                <span className="num text-sm text-fg">{marginPct}%</span>
              </div>
              <input type="range" min={25} max={100} step={5} value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} className="w-full" />
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Margin posted" value={usd(margin)} sub={`of ${usd(notionalMicros)}`} />
                <Stat label="Capital efficiency" value={`${(100 / marginPct).toFixed(2)}x`} sub="legacy bond: 0.67x" tone="near" />
                <Stat label="Liquidation @" value={price(liqPrice)} sub={p > 0n ? `+${(((Number(liqPrice) / Number(p)) - 1) * 100).toFixed(1)}% adverse` : ""} tone="warn" />
                <Stat label="Dead capital saved" value={usd(legacyBond - margin)} sub={`vs ${usd(legacyBond)} 1.5x bond`} tone="tee" />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary flex-1" disabled={!book || q === 0n || p === 0n || busy !== null} onClick={submitLocal}>
              {side === "buy" ? "agent_buy_forward" : "open_short_supply"} · sign with desk agent key
            </button>
            {wallet.accountId && wallet.liveEnabled ? (
              <>
                <button type="button" className="btn-ghost" onClick={() => depositTestnet()} title="usdc.ft_transfer_call → paron (1 yocto)">
                  Deposit USDC
                </button>
                <button type="button" className="btn-ghost" onClick={() => submitTestnet()}>
                  <Send className="h-4 w-4" /> Sign on testnet
                </button>
              </>
            ) : null}
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-dim">
            Signed by <span className="font-mono text-fg-muted">{JUDGE_ACCOUNT}</span>'s NEAR Function Call key and checked against its on-chain{" "}
            <span className="text-fg-muted">AgentGuardrailPolicy</span> ($4,000/day, 150 bps band). Try a max price above the ceiling to watch the contract reject it.
            {wallet.liveEnabled ? null : (
              <>
                {" "}
                Set <span className="font-mono">NEXT_PUBLIC_PARON_CONTRACT_ID</span> to also sign on NEAR testnet via NEAR Connect.
              </>
            )}
          </p>
          <LastTrades />
        </div>
      </div>
    </Panel>
  );
}

function LastTrades() {
  const { sim, version } = useDesk();
  const txs = useMemo(() => (sim ? sim.runtime.txs.filter((t) => ["agent_buy_forward", "open_short_supply", "place_bid", "sell_forward"].includes(t.method)).slice(-5).reverse() : []), [sim, version]);
  return (
    <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-2">
      <div className="mb-1 px-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">Latest signed order transactions</div>
      {txs.map((t) => (
        <div key={t.tx_hash} className="flex items-center justify-between gap-2 border-t border-ink-700 px-1 py-1 text-[11.5px] first:border-t-0">
          <span className="truncate font-mono text-fg-muted">
            {short(t.signer_id)} · {t.method}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {t.status === "Failure" ? <Badge tone="danger">rejected</Badge> : <Badge tone="near">ok</Badge>}
            <Hash value={t.tx_hash} head={6} tail={4} />
          </span>
        </div>
      ))}
    </div>
  );
}
