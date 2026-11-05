/**
 * Compute-Consumer-Agent — draws CU inventory down as real compute (Mode B) and enforces the SLA.
 *
 * - Holds CU-2026-12 inventory bought under its own guardrail policy.
 * - Escrows CU against an OutLayer-attested provider (`request_compute_redemption`).
 * - Submits the enclave-signed TDX execution receipt: a clean job pays the provider, a throttled job is
 *   slashed automatically (100% refund + 15% penalty from the provider's margin).
 * - Watches deadlines and calls the permissionless `claim_sla_breach_slash` when a provider ghosts it.
 */
import { u128, type ParonClient } from "./client";
import { formatUsdc } from "./engine/math";
import type { RedemptionRequest, TradeReport } from "./engine/types";
import type { AttestedJobReceipt } from "./oracle/cri-oracle";
import type { EmitFn } from "./swarm-events";

type JsonRequest = Omit<RedemptionRequest, "cu_amount_scaled" | "strike_payment_micros" | "provider_collateral_micros" | "agent_cost_basis_micros"> & {
  cu_amount_scaled: string;
  strike_payment_micros: string;
  provider_collateral_micros: string;
  agent_cost_basis_micros: string;
};

export function describeState(state: unknown): string {
  const [name, body] = Object.entries(state as Record<string, Record<string, unknown>>)[0];
  if (name === "SlashedForSlaBreach") return `${name}(${String(body.reason)}, payout ${formatUsdc(BigInt(String(body.payout_micros)))})`;
  if (name === "DeliveredViaTee") return `${name}(latency ${String(body.latency_ms)} ms)`;
  return name;
}

export class ComputeConsumerAgent {
  readonly name = "Compute-Consumer-Agent";

  constructor(
    private readonly client: ParonClient,
    private readonly emit: EmitFn,
  ) {}

  async acquireInventory(seriesId: string, cuScaled: bigint): Promise<TradeReport> {
    const series = await this.client.view<{ index_twap_usdc_micros: string }>("get_series", { series_id: seriesId });
    const policy = await this.client.view<{ max_slippage_bps: number }>("get_agent_guardrail", { agent_id: this.client.accountId });
    const limit = (u128(series.index_twap_usdc_micros) * BigInt(10_000 + policy.max_slippage_bps)) / 10_000n;
    const out = await this.client.call<TradeReport>("agent_buy_forward", { series_id: seriesId, cu_amount_scaled: cuScaled.toString(), max_price_micros: limit.toString() });
    if (!out.ok || !out.result) throw new Error(`inventory purchase failed: ${out.error}`);
    this.emit({
      actor: this.name,
      kind: "tx",
      method: "agent_buy_forward",
      ok: true,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Bought ${Number(cuScaled) / 1e4} CU of ${seriesId} inventory for December batch jobs`,
      detail: `filled ${out.result.fills.length} order(s) for ${formatUsdc(u128(out.result.notional_micros))} inside its own guardrail band`,
      data: out.result,
    });
    return out.result;
  }

  async requestJob(seriesId: string, providerId: string, cuScaled: bigint, jobLabel: string): Promise<number> {
    const out = await this.client.call<number>("request_compute_redemption", { series_id: seriesId, provider_id: providerId, cu_amount_scaled: cuScaled.toString() });
    if (!out.ok || out.result === undefined) throw new Error(`redemption request failed: ${out.error}`);
    const request = await this.client.view<JsonRequest>("get_redemption", { request_id: out.result });
    this.emit({
      actor: this.name,
      kind: "redemption",
      method: "request_compute_redemption",
      ok: true,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `${jobLabel}: escrowed ${Number(cuScaled) / 1e4} CU with ${providerId} (request #${out.result})`,
      detail: `strike payment ${formatUsdc(u128(request.strike_payment_micros))} + provider margin ${formatUsdc(u128(request.provider_collateral_micros))} locked · ack by ${new Date(request.ack_deadline_ms).toISOString()} · deliver by ${new Date(request.delivery_deadline_ms).toISOString()}`,
      data: request,
    });
    return out.result;
  }

  async submitReceipt(receipt: AttestedJobReceipt): Promise<JsonRequest> {
    const out = await this.client.call<JsonRequest>("finalize_redemption_with_tee_receipt", {
      request_id: receipt.request_id,
      tdx_quote_hash: receipt.tdx_quote_hash,
      measured_latency_ms: receipt.measured_latency_ms,
      sla_met: receipt.sla_met,
      worker_sig: receipt.signature_hex,
    });
    if (!out.ok || !out.result) throw new Error(`receipt submission failed: ${out.error}`);
    this.emit({
      actor: this.name,
      kind: "redemption",
      method: "finalize_redemption_with_tee_receipt",
      ok: true,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Request #${receipt.request_id} → ${describeState(out.result.state)}`,
      detail: `OutLayer TDX receipt ${receipt.tdx_quote_hash.slice(0, 16)}… · TTFT ${receipt.ttft_ms} ms · ${(receipt.tokens_per_sec_milli / 1000).toFixed(1)} tok/s · sla_met=${receipt.sla_met}${receipt.violations.length ? ` (${receipt.violations.join("; ")})` : ""}`,
      data: out.result,
    });
    return out.result;
  }

  async enforceDeadline(requestId: number): Promise<JsonRequest> {
    const out = await this.client.call<JsonRequest>("claim_sla_breach_slash", { request_id: requestId });
    if (!out.ok || !out.result) throw new Error(`slash claim failed: ${out.error}`);
    this.emit({
      actor: this.name,
      kind: "redemption",
      method: "claim_sla_breach_slash",
      ok: true,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Provider missed the deadline on request #${requestId} → ${describeState(out.result.state)}`,
      detail: "permissionless deterministic slash: 100% strike refund + 15% penalty from provider margin",
      data: out.result,
    });
    return out.result;
  }
}
