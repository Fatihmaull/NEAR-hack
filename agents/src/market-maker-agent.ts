/**
 * Yield-LP-Market-Maker-Agent — the short counterparty and liquidity layer.
 *
 * - Quotes two-sided markets around the OutLayer CRI-H100 TWAP: bids are fully escrowed, asks are backed
 *   by its isolated 25%-initial-margin vault (it keeps a 40% buffer to stay far from 15% maintenance).
 * - On every TEE index update it runs its risk loop (margin top-up when health < trigger) and re-centers
 *   its quotes; stale asks are never left behind.
 * - It doubles as a permissionless keeper: it liquidates under-margined third-party vaults by re-hedging
 *   their obligation at the attested mark and earns the 2.5% liquidation bonus.
 */
import { u128, type ParonClient } from "./client";
import { applyBps, BPS, formatPrice, formatUsdc, notional, saturatingSub } from "./engine/math";
import type { LiquidationReceipt, Order, ShortMarginVault, VaultHealth } from "./engine/types";
import type { EmitFn } from "./swarm-events";

export interface QuoteSpec {
  seriesId: string;
  halfSpreadBps: bigint;
  sizeCuScaled: bigint;
}

export interface MarketMakerConfig {
  quotes: QuoteSpec[];
  /** Target equity / notional after top-ups (e.g. 4000 = 40%). */
  bufferTargetBps: bigint;
  /** Top up when health falls below this (e.g. 3000 = 30%). */
  topUpTriggerBps: number;
}

/** $0.0001 price tick. */
export const TICK_MICROS = 100n;

type Json<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] extends bigint | null ? string | null : T[K] };

export class YieldLpMarketMakerAgent {
  readonly name = "Yield-LP-Market-Maker-Agent";

  constructor(
    private readonly client: ParonClient,
    private readonly emit: EmitFn,
    readonly cfg: MarketMakerConfig,
  ) {}

  private async twap(seriesId: string): Promise<bigint> {
    const s = await this.client.view<{ index_twap_usdc_micros: string }>("get_series", { series_id: seriesId });
    return u128(s.index_twap_usdc_micros);
  }

  private async ownVault(seriesId: string): Promise<Json<ShortMarginVault> | null> {
    return this.client.view("get_vault_by_provider", { provider_id: this.client.accountId, series_id: seriesId });
  }

  /** Collateral needed so the vault holds `bufferTargetBps` of (open + listed + new ask) notional. */
  private async marginForNewAsk(seriesId: string, askNotional: bigint): Promise<bigint> {
    const vault = await this.ownVault(seriesId);
    if (!vault) return applyBps(askNotional, this.cfg.bufferTargetBps);
    const health = await this.client.view<Json<VaultHealth>>("check_vault_health", { vault_id: vault.vault_id });
    const total = u128(health.open_notional_micros) + u128(vault.listed_notional_micros) + askNotional;
    return saturatingSub(applyBps(total, this.cfg.bufferTargetBps), u128(health.equity_micros));
  }

  /** Post-only quotes around the TWAP: never cross the opposite best price (the LP provides, not takes). */
  async quote(spec: QuoteSpec): Promise<void> {
    const twap = await this.twap(spec.seriesId);
    const book = await this.client.view<{ best_bid_micros: string | null; best_ask_micros: string | null }>("get_order_book", { series_id: spec.seriesId, depth: 1 });
    let bid = applyBps(twap, BPS - spec.halfSpreadBps);
    let ask = applyBps(twap, BPS + spec.halfSpreadBps);
    if (book.best_ask_micros !== null && bid >= u128(book.best_ask_micros)) bid = u128(book.best_ask_micros) - TICK_MICROS;
    if (book.best_bid_micros !== null && ask <= u128(book.best_bid_micros)) ask = u128(book.best_bid_micros) + TICK_MICROS;
    const bidOut = await this.client.call("place_bid", { series_id: spec.seriesId, cu_amount_scaled: spec.sizeCuScaled.toString(), price_micros: bid.toString() });
    const margin = await this.marginForNewAsk(spec.seriesId, notional(spec.sizeCuScaled, ask));
    const askOut = await this.client.call<{ required_initial_margin_micros: string; vault_id: number }>("open_short_supply", {
      series_id: spec.seriesId,
      cu_amount_scaled: spec.sizeCuScaled.toString(),
      ask_price_micros: ask.toString(),
      margin_deposit_micros: margin.toString(),
    });
    this.emit({
      actor: this.name,
      kind: "tx",
      method: "place_bid + open_short_supply",
      ok: bidOut.ok && askOut.ok,
      txHash: askOut.txHash,
      keyKind: this.client.keyKind,
      title: `Quoted ${spec.seriesId}: ${formatPrice(bid)} / ${formatPrice(ask)} × ${Number(spec.sizeCuScaled) / 1e4} CU`,
      detail: askOut.ok
        ? `post-only around TWAP ${formatPrice(twap)} ± ${Number(spec.halfSpreadBps)} bps · ask backed by vault #${askOut.result?.vault_id}: ${margin > 0n ? `+${formatUsdc(margin)} margin` : "existing vault excess"} keeps a ${Number(this.cfg.bufferTargetBps) / 100}% buffer (vault 25% requirement ${formatUsdc(u128(askOut.result?.required_initial_margin_micros ?? "0"))})`
        : `${bidOut.error ?? ""} ${askOut.error ?? ""}`,
    });
  }

  async quoteAll(): Promise<void> {
    for (const spec of this.cfg.quotes) await this.quote(spec);
  }

  async cancelAll(seriesId: string): Promise<number> {
    const orders = await this.client.view<Json<Order>[]>("get_open_orders", { series_id: seriesId, account_id: this.client.accountId });
    for (const o of orders) await this.client.call("cancel_order", { series_id: seriesId, order_id: o.order_id });
    return orders.length;
  }

  /** Margin call handling: restore the buffer if health dropped below the trigger. */
  async riskCheck(seriesId: string): Promise<void> {
    const vault = await this.ownVault(seriesId);
    if (!vault || vault.status !== "Active") return;
    const health = await this.client.view<Json<VaultHealth>>("check_vault_health", { vault_id: vault.vault_id });
    if (health.health_bps === null || health.health_bps >= this.cfg.topUpTriggerBps) return;
    const target = applyBps(u128(health.open_notional_micros) + u128(vault.listed_notional_micros), this.cfg.bufferTargetBps);
    const topUp = saturatingSub(target, u128(health.equity_micros));
    if (topUp === 0n) return;
    const out = await this.client.call<Json<VaultHealth>>("top_up_margin", { series_id: seriesId, amount_micros: topUp.toString() });
    this.emit({
      actor: this.name,
      kind: "tx",
      method: "top_up_margin",
      ok: out.ok,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Risk loop: topped up ${formatUsdc(topUp)} on vault #${vault.vault_id}`,
      detail: out.ok
        ? `health ${health.health_bps / 100}% → ${(out.result?.health_bps ?? 0) / 100}% (trigger ${this.cfg.topUpTriggerBps / 100}%, maintenance 15%) · liquidation price ${formatPrice(u128(out.result?.liquidation_price_micros ?? "0"))}`
        : out.error,
    });
  }

  /** Re-center quotes around the new TWAP after an OutLayer index update. */
  async onIndexUpdate(seriesId: string): Promise<void> {
    await this.riskCheck(seriesId);
    const cancelled = await this.cancelAll(seriesId);
    const spec = this.cfg.quotes.find((q) => q.seriesId === seriesId);
    if (spec) {
      this.emit({ actor: this.name, kind: "info", title: `Re-centering ${seriesId} quotes`, detail: `cancelled ${cancelled} resting orders` });
      await this.quote({ ...spec, sizeCuScaled: spec.sizeCuScaled / 2n });
      await this.riskCheck(seriesId);
    }
  }

  /** Permissionless keeper: liquidate third-party vaults below 15% maintenance. */
  async keeperSweep(seriesId: string): Promise<LiquidationReceipt[]> {
    const vaults = await this.client.view<Json<VaultHealth>[]>("list_vault_health", { series_id: seriesId });
    const receipts: LiquidationReceipt[] = [];
    for (const v of vaults) {
      if (!v.is_liquidatable || v.provider === this.client.accountId) continue;
      const out = await this.client.call<LiquidationReceipt>("liquidate_underwater_vault", { vault_id: v.vault_id });
      const r = out.result as unknown as Json<LiquidationReceipt> | undefined;
      this.emit({
        actor: this.name,
        kind: "liquidation",
        method: "liquidate_underwater_vault",
        ok: out.ok,
        txHash: out.txHash,
        keyKind: this.client.keyKind,
        title: out.ok ? `Keeper liquidated vault #${v.vault_id} (${v.provider}) at ${(v.health_bps ?? 0) / 100}% health` : `Liquidation of vault #${v.vault_id} failed`,
        detail:
          out.ok && r
            ? `re-hedged ${Number(u128(r.cu_transferred_scaled)) / 1e4} CU at mark ${formatPrice(u128(r.mark_price_micros))} with ${formatUsdc(u128(r.rehedge_margin_micros))} fresh margin · loss ${formatUsdc(u128(r.realized_loss_micros))} moved to escrow · bonus ${formatUsdc(u128(r.liquidator_bonus_micros))} · provider refund ${formatUsdc(u128(r.provider_refund_micros))}`
            : out.error,
        data: r,
      });
      if (out.ok && out.result) receipts.push(out.result);
    }
    if (receipts.length > 0) await this.riskCheck(seriesId);
    return receipts;
  }

  /** End of cycle: pull quotes and reclaim margin that no longer backs an open obligation. */
  async unwind(seriesId: string): Promise<void> {
    await this.cancelAll(seriesId);
    const vault = await this.ownVault(seriesId);
    if (!vault || vault.status !== "Active" || u128(vault.locked_collateral_micros) === 0n) return;
    const health = await this.client.view<Json<VaultHealth>>("check_vault_health", { vault_id: vault.vault_id });
    const excess = u128(health.excess_collateral_micros);
    if (excess === 0n) return;
    const out = await this.client.call("withdraw_excess_margin", { series_id: seriesId, amount_micros: excess.toString() });
    this.emit({
      actor: this.name,
      kind: "tx",
      method: "withdraw_excess_margin",
      ok: out.ok,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Unwound ${seriesId} quotes and reclaimed ${formatUsdc(excess)} margin`,
      detail: out.error,
    });
  }
}
