/**
 * CFO-Hedging-Agent — runway protection for an autonomous AI business.
 *
 * 1. Measures its 30-day inference burn (`forecastCu`) against the OutLayer CRI-H100 TWAP and computes a
 *    parametric 95% Value-at-Risk of the compute bill from trailing index volatility.
 * 2. If VaR threatens the runway, funds itself cross-chain through NEAR Intents (1Click) straight into
 *    its Paron margin balance, and buys CU forwards with `agent_buy_forward`.
 * 3. Its planner is allowed to be wrong: an over-eager limit price is rejected *on-chain* by the
 *    `AgentGuardrailPolicy` slippage band; the agent re-plans inside the band.
 * 4. At maturity it cash-settles (Mode A) and receives exactly `Q × P_index`.
 */
import { u128, type ParonClient } from "./client";
import { applyBps, BPS, formatPrice, formatUsdc, notional } from "./engine/math";
import type { CashSettlementReceipt, TradeReport } from "./engine/types";
import type { EmitFn } from "./swarm-events";

export interface CfoHedgingConfig {
  seriesId: string;
  /** Projected 30-day inference demand in CU (scaled 1e4). */
  forecastCuScaled: bigint;
  monthlyComputeBudgetMicros: bigint;
  /** Hedge when VaR95 exceeds this share of the monthly budget. */
  varTriggerBps: bigint;
  /** z-score × 1000 for the VaR confidence (1645 = 95% one-sided). */
  varZx1000: bigint;
  horizonDays: number;
  /** The planner's first, urgency-driven proposal (deliberately outside the guardrail band). */
  urgencyPremiumBps: bigint;
  /** Stress scenario: CRI-H100 during a model-launch demand spike. */
  stressIndexMicros: bigint;
}

export interface RunwayAssessment {
  spotTwapMicros: bigint;
  projectedBurnMicros: bigint;
  dailyVolBps: bigint;
  horizonVolBps: bigint;
  var95Micros: bigint;
  varToBudgetBps: bigint;
  stressSpikeBurnMicros: bigint;
  decision: "HEDGE" | "HOLD";
  rationale: string;
}

/** Integer square root (deterministic across platforms). */
export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Population std-dev of daily returns in bps from a TWAP history (micros). */
export function dailyVolatilityBps(history: bigint[]): bigint {
  const returns = history.slice(1).map((p, i) => ((p - history[i]) * BPS * 100n) / history[i]); // centi-bps
  const n = BigInt(returns.length);
  const mean = returns.reduce((a, r) => a + r, 0n) / n;
  const variance = returns.reduce((a, r) => a + (r - mean) * (r - mean), 0n) / n;
  return isqrt(variance) / 100n;
}

export class CfoHedgingAgent {
  readonly name = "CFO-Hedging-Agent";

  constructor(
    private readonly client: ParonClient,
    private readonly emit: EmitFn,
    readonly cfg: CfoHedgingConfig,
  ) {}

  assessRunway(history: bigint[], spotTwapMicros: bigint): RunwayAssessment {
    const projectedBurn = notional(this.cfg.forecastCuScaled, spotTwapMicros);
    const dailyVol = dailyVolatilityBps(history);
    const horizonVol = (dailyVol * isqrt(BigInt(this.cfg.horizonDays) * 1_000_000n)) / 1_000n;
    const var95 = (projectedBurn * this.cfg.varZx1000 * horizonVol) / (1_000n * BPS);
    const varToBudget = (var95 * BPS) / this.cfg.monthlyComputeBudgetMicros;
    const stress = notional(this.cfg.forecastCuScaled, this.cfg.stressIndexMicros);
    const decision = varToBudget >= this.cfg.varTriggerBps ? "HEDGE" : "HOLD";
    const assessment: RunwayAssessment = {
      spotTwapMicros,
      projectedBurnMicros: projectedBurn,
      dailyVolBps: dailyVol,
      horizonVolBps: horizonVol,
      var95Micros: var95,
      varToBudgetBps: varToBudget,
      stressSpikeBurnMicros: stress,
      decision,
      rationale:
        decision === "HEDGE"
          ? `VaR95 ${formatUsdc(var95)} = ${Number(varToBudget) / 100}% of the ${formatUsdc(this.cfg.monthlyComputeBudgetMicros)} budget ≥ ${Number(this.cfg.varTriggerBps) / 100}% trigger`
          : `VaR95 ${formatUsdc(var95)} below the ${Number(this.cfg.varTriggerBps) / 100}% trigger`,
    };
    this.emit({
      actor: this.name,
      kind: "analysis",
      title: `Runway VaR: ${decision}`,
      detail: `30d burn ${formatUsdc(projectedBurn)} at ${formatPrice(spotTwapMicros)}/CU · σ_daily ${Number(dailyVol) / 100}% · σ_30d ${Number(horizonVol) / 100}% · ${assessment.rationale} · stress spike to ${formatPrice(this.cfg.stressIndexMicros)} would cost ${formatUsdc(stress)}`,
      data: assessment,
    });
    return assessment;
  }

  /** Buys the forecast inside the guardrail band, re-planning if the chain rejects a proposal. */
  async hedge(): Promise<TradeReport> {
    const series = await this.client.view<{ index_twap_usdc_micros: string }>("get_series", { series_id: this.cfg.seriesId });
    const twap = u128(series.index_twap_usdc_micros);
    const policy = await this.client.view<{ max_slippage_bps: number } | null>("get_agent_guardrail", { agent_id: this.client.accountId });
    if (!policy) throw new Error("CFO agent has no on-chain guardrail policy");
    const proposals = [
      { label: "urgent planner proposal", price: applyBps(twap, BPS + this.cfg.urgencyPremiumBps) },
      { label: "re-planned inside guardrail band", price: (twap * (BPS + BigInt(policy.max_slippage_bps))) / BPS },
    ];
    for (const p of proposals) {
      const out = await this.client.call<TradeReport>("agent_buy_forward", {
        series_id: this.cfg.seriesId,
        cu_amount_scaled: this.cfg.forecastCuScaled.toString(),
        max_price_micros: p.price.toString(),
      });
      if (out.ok && out.result) {
        const t = out.result;
        this.emit({
          actor: this.name,
          kind: "tx",
          method: "agent_buy_forward",
          ok: true,
          txHash: out.txHash,
          keyKind: this.client.keyKind,
          title: `Hedged ${Number(u128(t.filled_cu_scaled)) / 1e4} CU of ${this.cfg.seriesId} @ VWAP ${formatPrice(u128(t.avg_price_micros))}`,
          detail: `${p.label}: limit ${formatPrice(p.price)} · ${t.fills.length} fills · cost ${formatUsdc(u128(t.notional_micros))} · NEP-245 CU minted to ${this.client.accountId}`,
          data: t,
        });
        return t;
      }
      this.emit({
        actor: this.name,
        kind: "guardrail",
        method: "agent_buy_forward",
        ok: false,
        txHash: out.txHash,
        keyKind: this.client.keyKind,
        title: `On-chain guardrail rejected ${p.label} (${formatPrice(p.price)})`,
        detail: out.error,
      });
    }
    throw new Error("hedge failed inside the guardrail band");
  }

  /** Prompt-injection drill: a hijacked planner tries to drain funds; NEAR access-key rules block it. */
  async attemptUnauthorisedWithdrawal(attackerNote: string): Promise<void> {
    const out = await this.client.call("withdraw_usdc", { amount: "1000000000" }, { depositYocto: 1n });
    this.emit({
      actor: this.name,
      kind: "security",
      method: "withdraw_usdc",
      ok: out.ok,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: out.ok ? "withdraw_usdc unexpectedly succeeded" : "Function Call key blocked a fund-exfiltration attempt",
      detail: `${attackerNote} → ${out.error ?? "ok"}`,
    });
  }

  async settleAtMaturity(): Promise<CashSettlementReceipt> {
    const balance = u128(await this.client.view<string>("mt_balance_of", { account_id: this.client.accountId, token_id: this.cfg.seriesId }));
    const out = await this.client.call<CashSettlementReceipt>("settle_cash_hedge", { series_id: this.cfg.seriesId, cu_amount_scaled: balance.toString() });
    if (!out.ok || !out.result) throw new Error(`settle_cash_hedge failed: ${out.error}`);
    const r = out.result;
    this.emit({
      actor: this.name,
      kind: "settlement",
      method: "settle_cash_hedge",
      ok: true,
      txHash: out.txHash,
      keyKind: this.client.keyKind,
      title: `Mode A cash settlement: received ${formatUsdc(u128(r.payout_micros))} (ΔV = ${formatUsdc(BigInt(r.hedge_pnl_micros))})`,
      detail: `${Number(u128(r.cu_amount_scaled)) / 1e4} CU × (${formatPrice(u128(r.index_price_micros))} − ${formatPrice(u128(r.avg_entry_price_micros))}) — the agent's spiked inference bill is fully funded at the locked price`,
      data: r,
    });
    return r;
  }
}
