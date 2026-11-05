/**
 * Compute provider node (the physical-capacity counterparty, e.g. an ASEAN Tier-3 data center).
 * It pre-sells capacity with 25% margin, acknowledges Mode B jobs and runs them behind an
 * OutLayer-attested endpoint; the enclave — not the provider — decides `sla_met`.
 */
import { u128, type ParonClient } from "./client";
import { applyBps, formatPrice, formatUsdc, INITIAL_MARGIN_BPS, notional } from "./engine/math";
import type { ShortSupplyOutcome } from "./engine/types";
import type { EmitFn } from "./swarm-events";

export class ComputeProviderNode {
  readonly name: string;

  constructor(
    private readonly client: ParonClient,
    private readonly emit: EmitFn,
    displayName = "Batam-H100-Provider",
  ) {
    this.name = displayName;
  }

  get accountId(): string {
    return this.client.accountId;
  }

  /** Pre-sell `cuScaled` at `price` posting exactly the 25% initial margin. */
  async presell(seriesId: string, cuScaled: bigint, price: bigint): Promise<ShortSupplyOutcome> {
    const margin = applyBps(notional(cuScaled, price), INITIAL_MARGIN_BPS);
    const legacyBond = (notional(cuScaled, price) * 3n) / 2n;
    const out = await this.client.call<ShortSupplyOutcome>("open_short_supply", {
      series_id: seriesId,
      cu_amount_scaled: cuScaled.toString(),
      ask_price_micros: price.toString(),
      margin_deposit_micros: margin.toString(),
    });
    if (!out.ok || !out.result) throw new Error(`presell failed: ${out.error}`);
    this.emit({
      actor: this.name,
      kind: "tx",
      method: "open_short_supply",
      ok: true,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Pre-sold ${Number(cuScaled) / 1e4} CU of ${seriesId} @ ${formatPrice(price)} with 25% margin`,
      detail: `margin ${formatUsdc(margin)} → 4.0x capital efficiency vs ${formatUsdc(legacyBond)} under the legacy 1.5x cash bond (0.67x) · vault #${out.result.vault_id}`,
      data: out.result,
    });
    return out.result;
  }

  async acknowledge(requestId: number): Promise<void> {
    const out = await this.client.call("acknowledge_redemption", { request_id: requestId });
    this.emit({
      actor: this.name,
      kind: "redemption",
      method: "acknowledge_redemption",
      ok: out.ok,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Acknowledged request #${requestId}; job dispatched to OutLayer-attested endpoint`,
      detail: out.error,
    });
  }

  async freeBalance(): Promise<bigint> {
    return u128(await this.client.view<string>("usdc_balance_of", { account_id: this.client.accountId }));
  }
}
