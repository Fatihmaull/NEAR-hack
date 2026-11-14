"use client";

import { useEffect, useMemo, useState } from "react";
import { JUDGE_ACCOUNT, useDesk } from "@/lib/desk";
import { cu, pct, price, readableError, toMicros, toScaled, usd } from "@/lib/format";
import { functionCall, PARON_CONTRACT_ID, USDC_TOKEN_ID, useWallet } from "@/lib/wallet";
import { PageHeader, SimClock } from "../PageHeader";
import { Badge, EmptyState, Hash, Loading, Panel, Segmented, Stat } from "../../ui";

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
}

export const SERIES = ["CU-2026-11", "CU-2026-12", "CU-2027-01"] as const;
export type SeriesId = (typeof SERIES)[number];
const SERIES_OPTIONS = SERIES.map((s) => ({ value: s, label: s.replace("CU-", "") }));
const shortAcct = (a: string) => a.replace(".swarm-treasury.testnet", "").replace(".testnet", "");

function Ladder({ book }: { book: BookJson }) {
  const asks = [...book.asks].slice(0, 7).reverse();
  const bids = book.bids.slice(0, 7);
  const max = Math.max(1, ...[...asks, ...bids].map((l) => Number(l.cu_scaled)));
  /** Depth is drawn as a row background from the right edge, sized by resting CU. */
  const row = (l: Level, side: "ask" | "bid") => {
    const depth = (Number(l.cu_scaled) / max) * 100;
    const tint = side === "ask" ? "#FCECEE" : "#E8F5EE";
    return (
      <tr key={`${side}-${l.price_micros}`} style={{ background: `linear-gradient(to left, ${tint} ${depth}%, transparent ${depth}%)` }}>
        <td className={`num py-1.5 pl-4 text-[14px] ${side === "ask" ? "text-down" : "text-up"}`}>{price(l.price_micros)}</td>
        <td className="num py-1.5 text-right text-[14px] text-ink">{cu(l.cu_scaled, 0)}</td>
        <td className="num py-1.5 pr-4 text-right text-[13px] text-body">{l.orders}</td>
      </tr>
    );
  };
  const spread = book.best_ask_micros && book.best_bid_micros ? BigInt(book.best_ask_micros) - BigInt(book.best_bid_micros) : null;
  return (
    <table className="w-full">
      <caption className="sr-only">Order book: asks above the index, bids below</caption>
      <thead>
        <tr className="text-[12.5px] text-body">
          <th scope="col" className="pb-2 pl-4 text-left font-medium">Price per CU</th>
          <th scope="col" className="pb-2 text-right font-medium">Size (CU)</th>
          <th scope="col" className="pb-2 pr-4 text-right font-medium">Orders</th>
        </tr>
      </thead>
      <tbody>
        {asks.length ? (
          asks.map((l) => row(l, "ask"))
        ) : (
          <tr>
            <td colSpan={3} className="px-4 py-3 text-[13.5px] text-body">
              No asks within 5% of the index. Stale quotes are cancelled after each attestation.
            </td>
          </tr>
        )}
        <tr className="border-y border-hairline bg-soft">
          <td className="py-2 pl-4 text-[13.5px] text-ink">
            Index <span className="num">{price(book.index_twap_usdc_micros)}</span>
          </td>
          <td colSpan={2} className="num py-2 pr-4 text-right text-[13px] text-body">
            spread {spread !== null ? price(spread) : "none"}
          </td>
        </tr>
        {bids.length ? (
          bids.map((l) => row(l, "bid"))
        ) : (
          <tr>
            <td colSpan={3} className="px-4 py-3 text-[13.5px] text-body">
              No bids resting.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function TradeView() {
  const { snapshot, run, busy, notify, sim, ready, version } = useDesk();
  const wallet = useWallet();
  const [series, setSeries] = useState<SeriesId>("CU-2026-11");
  const [side, setSide] = useState<"buy" | "short">("buy");
  const [qty, setQty] = useState("50");
  const [limit, setLimit] = useState("");
  const [marginPct, setMarginPct] = useState(25);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("side") === "short") setSide("short");
  }, []);

  const book = snapshot?.books?.[series] as BookJson | undefined;
  const index = BigInt(book?.index_twap_usdc_micros ?? "0");
  useEffect(() => {
    if (!book) return;
    const idx = BigInt(book.index_twap_usdc_micros);
    const def = side === "buy" ? (idx * 10_100n) / 10_000n : (idx * 10_025n) / 10_000n;
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
  const notional = (q * p) / 10_000n;
  const margin = (notional * BigInt(marginPct)) / 100n;
  const liqPrice = q > 0n ? ((margin + notional) * 10_000n * 10_000n) / (q * 11_500n) : 0n;
  const legacyBond = (notional * 3n) / 2n;
  const ceiling = (index * 10_150n) / 10_000n;
  const overCeiling = side === "buy" && p > ceiling;
  const qtyError = q > 0n && q < 10_000n ? "Minimum order is 1 CU." : q === 0n && qty !== "" ? "Enter a quantity above zero." : null;
  const vaults = ((snapshot?.vaults?.[series] ?? []) as VaultJson[]).filter((v) => v.status === "Active" && (BigInt(v.shorted_cu_scaled) > 0n || BigInt(v.listed_cu_scaled) > 0n));
  const health = new Map(((snapshot?.vault_health?.[series] ?? []) as HealthJson[]).map((h) => [h.vault_id, h]));
  const judgeFree = snapshot?.balances?.[JUDGE_ACCOUNT]?.free_usdc_micros;
  const recent = useMemo(
    () => (sim ? sim.runtime.txs.filter((t) => ["agent_buy_forward", "open_short_supply", "place_bid", "sell_forward"].includes(t.method)).slice(-6).reverse() : []),
    [sim, version],
  );

  const submit = () =>
    run(
      side === "buy" ? "Buying forwards" : "Opening short supply",
      async (_s, judge) =>
        side === "buy"
          ? judge.call<any>("agent_buy_forward", { series_id: series, cu_amount_scaled: q.toString(), max_price_micros: p.toString() })
          : judge.call<any>("open_short_supply", { series_id: series, cu_amount_scaled: q.toString(), ask_price_micros: p.toString(), margin_deposit_micros: margin.toString() }),
      (out) =>
        out.ok
          ? {
              kind: "ok",
              title: side === "buy" ? `Bought ${cu(out.result.filled_cu_scaled)} CU at ${price(out.result.avg_price_micros)}` : `Short supply open in vault #${out.result.vault_id}`,
              detail:
                side === "buy"
                  ? `${out.result.fills.length} fill(s), ${usd(out.result.notional_micros)} total. CU tokens minted to the desk agent.`
                  : `Margin ${usd(out.result.margin_deposit_micros)} posted against a 25% requirement of ${usd(out.result.required_initial_margin_micros)}.`,
              txHash: out.txHash,
            }
          : { kind: "error", title: "Rejected by the contract", detail: readableError(out.error), txHash: out.txHash },
    );

  const sendTestnet = async (label: string, receiverId: string, action: ReturnType<typeof functionCall>) => {
    try {
      const out = await wallet.send(receiverId, [action]);
      const hash = (out as { transaction_outcome?: { id?: string }; transaction?: { hash?: string } } | undefined)?.transaction_outcome?.id ?? (out as { transaction?: { hash?: string } } | undefined)?.transaction?.hash;
      notify({ kind: "ok", title: `${label} signed on NEAR testnet`, detail: `${wallet.accountId} → ${receiverId}`, txHash: hash });
    } catch (e) {
      notify({ kind: "error", title: `${label} failed on testnet`, detail: (e as Error).message });
    }
  };
  const submitTestnet = () => {
    const args =
      side === "buy"
        ? { series_id: series, cu_amount_scaled: q.toString(), price_micros: p.toString() }
        : { series_id: series, cu_amount_scaled: q.toString(), ask_price_micros: p.toString(), margin_deposit_micros: margin.toString() };
    return sendTestnet(side === "buy" ? "Bid" : "Short supply", PARON_CONTRACT_ID, functionCall(side === "buy" ? "place_bid" : "open_short_supply", args));
  };
  const depositTestnet = () =>
    sendTestnet("USDC deposit", USDC_TOKEN_ID, functionCall("ft_transfer_call", { receiver_id: PARON_CONTRACT_ID, amount: (side === "buy" ? notional : margin).toString(), msg: "" }, "1", "100000000000000"));

  return (
    <>
      <PageHeader
        title="Trade"
        description="Buy CU forwards, or pre-sell capacity with 25% margin. The desk agent signs with a Function Call key, and its on-chain guardrail checks every order."
        actions={<SimClock ms={snapshot?.now_ms} />}
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Maturity" value={series} options={SERIES_OPTIONS} onChange={setSeries} />
        <p className="text-[13.5px] text-body">
          Desk agent margin <span className="num text-ink">{judgeFree ? usd(judgeFree) : "loading"}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title={`Order book, ${series}`} description="Bids are fully escrowed. Asks are backed by margin vaults." bodyClassName="px-0 pb-2 pt-4">
          {book ? <Ladder book={book} /> : <div className="px-5"><Loading>Starting the local engine and loading the book…</Loading></div>}
        </Panel>

        <Panel title="Order ticket" description="Signed by judge.swarm-treasury.testnet">
          <div className="space-y-5">
            <Segmented
              label="Side"
              value={side}
              onChange={setSide}
              options={[
                { value: "buy", label: "Buy forwards" },
                { value: "short", label: "Pre-sell capacity" },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ticket-qty" className="field-label">
                  Quantity (CU)
                </label>
                <input id="ticket-qty" className="field num" inputMode="decimal" value={qty} aria-invalid={Boolean(qtyError)} aria-describedby="ticket-qty-help" onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} />
                <p id="ticket-qty-help" className={`mt-1 text-[12.5px] ${qtyError ? "text-down" : "text-muted"}`}>
                  {qtyError ?? "1 CU = 1 hour of H100"}
                </p>
              </div>
              <div>
                <label htmlFor="ticket-price" className="field-label">
                  {side === "buy" ? "Max price ($/CU)" : "Ask price ($/CU)"}
                </label>
                <input id="ticket-price" className="field num" inputMode="decimal" value={limit} aria-describedby="ticket-price-help" onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} />
                <p id="ticket-price-help" className={`mt-1 text-[12.5px] ${overCeiling ? "text-down" : "text-muted"}`}>
                  {side === "buy" ? (overCeiling ? `Above the ${price(ceiling)} guardrail ceiling. The contract will reject it.` : `Guardrail ceiling ${price(ceiling)}`) : `Index ${price(index)}`}
                </p>
              </div>
            </div>

            {side === "short" ? (
              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="ticket-margin" className="field-label mb-0">
                    Margin posted
                  </label>
                  <span className="num text-[14px] text-ink">{marginPct}%</span>
                </div>
                <input id="ticket-margin" type="range" min={25} max={100} step={5} value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} className="mt-2 w-full" />
                <dl className="mt-4 grid grid-cols-2 gap-4">
                  <Stat label="Margin" value={usd(margin)} sub={`of ${usd(notional)} notional`} />
                  <Stat label="Capital efficiency" value={`${(100 / marginPct).toFixed(2)}×`} sub="a 1.5× bond gives 0.67×" />
                  <Stat label="Liquidation price" value={price(liqPrice)} sub={p > 0n ? `${((Number(liqPrice) / Number(p) - 1) * 100).toFixed(1)}% above your ask` : undefined} tone="warn" />
                  <Stat label="Capital kept free" value={usd(legacyBond - margin)} sub={`vs a ${usd(legacyBond)} bond`} />
                </dl>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-4">
                <Stat label="You pay at most" value={usd(notional)} />
                <Stat label="Daily cap" value="$4,000" sub="150 bps slippage band" />
              </dl>
            )}

            <button type="button" className="btn-primary w-full" disabled={!ready || busy !== null || q < 10_000n || p === 0n} onClick={submit}>
              {side === "buy" ? `Buy ${qty || 0} CU` : `Pre-sell ${qty || 0} CU`}
            </button>

            {wallet.accountId && wallet.liveEnabled ? (
              <div className="rounded-field bg-soft p-4">
                <p className="text-[13.5px] text-ink">
                  Also sign this order with <span className="font-mono">{wallet.accountId}</span> on NEAR testnet.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-outline btn-sm" onClick={depositTestnet}>
                    Deposit {usd(side === "buy" ? notional : margin)} test USDC
                  </button>
                  <button type="button" className="btn-outline btn-sm" onClick={submitTestnet}>
                    Sign on testnet
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-body">Connect a testnet wallet from the sidebar to sign the same order on NEAR testnet.</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        <Panel title="Short supply vaults" description={`Liquidation starts below 15% maintenance margin at the attested mark.`} bodyClassName="px-0 pb-2 pt-3">
          {vaults.length ? (
            <>
            <ul className="sm:hidden" aria-label="Short supply vaults">
              {vaults.map((v) => {
                const h = health.get(v.vault_id);
                const hb = h?.health_bps ?? null;
                const tone = hb === null ? "text-body" : hb < 1500 ? "text-down" : hb < 3000 ? "text-warn" : "text-up";
                return (
                  <li key={v.vault_id} className="border-t border-hairline px-5 py-3 text-[14px] first:border-t-0">
                    <p className="flex justify-between gap-3">
                      <span>
                        <span className="num text-body">#{v.vault_id}</span> <span className="font-mono text-[13px] text-ink">{shortAcct(v.provider)}</span>
                      </span>
                      <span className="num text-ink">{cu(v.shorted_cu_scaled, 0)} CU</span>
                    </p>
                    <p className="mt-0.5 flex justify-between gap-3 text-[13px]">
                      <span className={`num ${tone}`}>{hb === null ? "No exposure" : `Health ${pct(hb)}`}</span>
                      <span className="num text-body">{h?.liquidation_price_micros ? `Liquidates at ${price(h.liquidation_price_micros)}` : "No liquidation price"}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="relative hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[520px] text-left text-[14px]">
                <thead>
                  <tr className="text-[12.5px] text-body">
                    <th scope="col" className="pb-2 pl-5 font-medium">Vault</th>
                    <th scope="col" className="pb-2 font-medium">Provider</th>
                    <th scope="col" className="pb-2 text-right font-medium">Open CU</th>
                    <th scope="col" className="pb-2 text-right font-medium">Entry</th>
                    <th scope="col" className="pb-2 text-right font-medium">Health</th>
                    <th scope="col" className="pb-2 pr-5 text-right font-medium">Liquidates at</th>
                  </tr>
                </thead>
                <tbody>
                  {vaults.map((v) => {
                    const h = health.get(v.vault_id);
                    const hb = h?.health_bps ?? null;
                    const tone = hb === null ? "text-body" : hb < 1500 ? "text-down" : hb < 3000 ? "text-warn" : "text-up";
                    return (
                      <tr key={v.vault_id} className="border-t border-hairline">
                        <td className="num py-2.5 pl-5 text-body">#{v.vault_id}</td>
                        <td className="py-2.5 font-mono text-[13px] text-ink">{shortAcct(v.provider)}</td>
                        <td className="num py-2.5 text-right">{cu(v.shorted_cu_scaled, 0)}</td>
                        <td className="num py-2.5 text-right">{BigInt(v.entry_price_micros) > 0n ? price(v.entry_price_micros) : "no fills"}</td>
                        <td className={`num py-2.5 text-right ${tone}`}>{hb === null ? "no exposure" : pct(hb)}</td>
                        <td className="num py-2.5 pr-5 text-right text-body">{h?.liquidation_price_micros ? price(h.liquidation_price_micros) : "not set"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="px-5 pb-3">
              <EmptyState title={`No open vaults in ${series}`}>Pre-sell capacity from the order ticket to open the first one.</EmptyState>
            </div>
          )}
        </Panel>

        <Panel title="Latest signed orders" description="Every row is a signed transaction on the desk engine." bodyClassName="px-0 pb-2 pt-3">
          {recent.length ? (
            <ul>
              {recent.map((t) => (
                <li key={t.tx_hash} className="flex flex-col gap-1 border-t border-hairline px-5 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="min-w-0 break-words text-[14px]">
                    <span className="font-mono text-[13px] text-ink">{shortAcct(t.signer_id)}</span> <span className="text-body">{t.method.replace(/_/g, " ")}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {t.status === "Failure" ? <Badge tone="down">Rejected</Badge> : <Badge tone="up">Filled</Badge>}
                    <Hash value={t.tx_hash} head={6} tail={4} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 pb-3">
              <EmptyState title="No orders yet">Place an order from the ticket and it appears here with its transaction hash.</EmptyState>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
