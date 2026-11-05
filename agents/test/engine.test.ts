/**
 * Parity tests: replay the Rust `contracts/paron-core/src/tests.rs` scenarios against the TypeScript
 * engine and assert the *same* numbers, so local mode is a faithful mirror of the contract.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deterministicKeyPair, sha256Hex, signEd25519, bytesToHex } from "../src/crypto";
import { cu, usdc } from "../src/engine/math";
import { LocalNearRuntime, type KeyHandle } from "../src/engine/runtime";

const T0 = 1_793_869_200_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOV_MATURITY = 1_796_083_199_000;
const NOV = "CU-2026-11";
const DEC = "CU-2026-12";
const TEE = deterministicKeyPair("test/tee");

interface H {
  rt: LocalNearRuntime;
  k: Record<string, KeyHandle>;
  call: (who: string, method: string, args?: Record<string, unknown>, yocto?: bigint) => { ok: boolean; result?: any; error?: string };
  ok: (who: string, method: string, args?: Record<string, unknown>, yocto?: bigint) => any;
  deposit: (who: string, amount: bigint, msg?: string) => void;
  view: (method: string, args?: Record<string, unknown>) => any;
  free: (who: string) => bigint;
  attest: (series: string, twap: bigint, observedAt: number, label: string) => any;
  receipt: (requestId: number, label: string, latency: number, slaMet: boolean) => any;
}

function harness(): H {
  const rt = new LocalNearRuntime("market.paron.testnet", "usdc.fakes.testnet", T0);
  const names = ["paron.testnet", "market.paron.testnet", "swarm-treasury.testnet", "cfo.swarm-treasury.testnet", "mm.swarm-treasury.testnet", "consumer.swarm-treasury.testnet", "batam-h100.testnet", "relayer.testnet"];
  const k: Record<string, KeyHandle> = {};
  for (const n of names) k[n] = rt.createAccount(n);
  assert.ok(rt.deployParon(k["market.paron.testnet"], "paron.testnet", TEE.publicKeyHex).ok);
  const call: H["call"] = (who, method, args = {}, yocto = 0n) => {
    const out = rt.call(k[who], method, args, { depositYocto: yocto });
    return { ok: out.ok, result: out.result, error: out.error };
  };
  const ok: H["ok"] = (who, method, args = {}, yocto = 0n) => {
    const out = call(who, method, args, yocto);
    assert.ok(out.ok, `${method} failed: ${out.error}`);
    return out.result;
  };
  const h: H = {
    rt,
    k,
    call,
    ok,
    deposit: (who, amount, msg = "") => {
      if (!k[who]) k[who] = rt.createAccount(who);
      rt.creditUsdcWallet(who, amount);
      assert.ok(rt.ftTransferCall(k[who], amount, msg).ok);
    },
    view: (method, args = {}) => rt.view(method, args),
    free: (who) => BigInt(rt.view<string>("usdc_balance_of", { account_id: who })),
    attest: (series, twap, observedAt, label) => {
      const hash = sha256Hex(label);
      const sig = bytesToHex(signEd25519(TEE.secretKey, `${series}:${twap}:${observedAt}:${hash}`));
      return call("relayer.testnet", "submit_outlayer_index_attestation", { series_id: series, twap_micros: twap.toString(), observed_at_ms: observedAt, tdx_quote_hash: hash, signature_hex: sig });
    },
    receipt: (requestId, label, latency, slaMet) => {
      const hash = sha256Hex(label);
      const sig = bytesToHex(signEd25519(TEE.secretKey, `${requestId}:${hash}:${latency}:${slaMet}`));
      return ok("batam-h100.testnet", "finalize_redemption_with_tee_receipt", { request_id: requestId, tdx_quote_hash: hash, measured_latency_ms: latency, sla_met: slaMet, worker_sig: sig });
    },
  };
  return h;
}

const guardrail = (h: H, agent: string, cap: bigint, bps = 150) =>
  h.ok("swarm-treasury.testnet", "configure_agent_guardrail", { agent_id: agent, max_daily_spend_micros: cap.toString(), max_slippage_bps: bps }, 1n);
const short = (h: H, who: string, series: string, qty: bigint, price: bigint, margin: bigint) =>
  h.ok(who, "open_short_supply", { series_id: series, cu_amount_scaled: qty.toString(), ask_price_micros: price.toString(), margin_deposit_micros: margin.toString() });
const buy = (h: H, who: string, series: string, qty: bigint, max: bigint) => h.call(who, "agent_buy_forward", { series_id: series, cu_amount_scaled: qty.toString(), max_price_micros: max.toString() });

test("init seeds three series, genesis depth and a 14,112 USDC genesis credit", () => {
  const h = harness();
  const series = h.view("list_series");
  assert.deepEqual(series.map((s: any) => s.series_id), ["CU-2026-11", "CU-2026-12", "CU-2027-01"]);
  const book = h.view("get_order_book", { series_id: NOV });
  assert.equal(book.best_ask_micros, "2820000");
  assert.equal(book.best_bid_micros, "2760000");
  assert.equal(h.view("protocol_stats").genesis_credit_outstanding_micros, "14112000000");
  assert.equal(h.view("convert_hardware_to_cu", { gpu_tier: "H200", hours_scaled: cu(40).toString() }), cu(56).toString());
  assert.equal(h.view("convert_hardware_to_cu", { gpu_tier: "A100", hours_scaled: cu(100).toString() }), cu(45).toString());
});

test("agent_buy_forward: same fills, VWAP and spend as the Rust contract", () => {
  const h = harness();
  h.deposit("batam-h100.testnet", usdc(1_000));
  short(h, "batam-h100.testnet", NOV, cu(300), 2_810_000n, 210_750_000n);
  h.deposit("cfo.swarm-treasury.testnet", usdc(3_000));
  guardrail(h, "cfo.swarm-treasury.testnet", usdc(2_500));
  const t = buy(h, "cfo.swarm-treasury.testnet", NOV, cu(400), 2_842_000n).result;
  assert.equal(t.notional_micros, "1125000000");
  assert.equal(t.avg_price_micros, "2812500");
  assert.equal(h.view("get_agent_guardrail", { agent_id: "cfo.swarm-treasury.testnet" }).spent_today_micros, "1125000000");
  assert.ok(h.view("audit_series_invariants", { series_id: NOV }).holds);
});

test("guardrail rejections roll back atomically with the Rust panic messages", () => {
  const h = harness();
  h.deposit("cfo.swarm-treasury.testnet", usdc(3_000));
  guardrail(h, "cfo.swarm-treasury.testnet", usdc(2_500));
  const before = h.free("cfo.swarm-treasury.testnet");
  const slip = buy(h, "cfo.swarm-treasury.testnet", NOV, cu(500), 2_900_000n);
  assert.equal(slip.ok, false);
  assert.match(slip.error!, /slippage guard: max price 2900000 exceeds TWAP band ceiling 2842000/);
  guardrail(h, "cfo.swarm-treasury.testnet", usdc(100));
  const cap = buy(h, "cfo.swarm-treasury.testnet", NOV, cu(100), 2_842_000n);
  assert.match(cap.error!, /daily spend cap exceeded/);
  assert.equal(h.free("cfo.swarm-treasury.testnet"), before);
  assert.equal(h.view("mt_supply", { token_id: NOV }), "0");
  h.deposit("batam-h100.testnet", usdc(1_000));
  const thin = h.call("batam-h100.testnet", "open_short_supply", { series_id: NOV, cu_amount_scaled: cu(300).toString(), ask_price_micros: "2810000", margin_deposit_micros: "210749999" });
  assert.match(thin.error!, /insufficient initial margin: 25% requirement is 210750000 micros/);
});

test("Mode A spike 2.80 → 4.10 pays $410 (+$130) and the drop to 2.20 pays $220 (−$60)", () => {
  for (const [twap, payout, pnl, margin] of [
    [4_100_000n, "410000000", "130000000", 140_000_000n],
    [2_200_000n, "220000000", "-60000000", 70_000_000n],
  ] as const) {
    const h = harness();
    h.deposit("batam-h100.testnet", usdc(1_000));
    short(h, "batam-h100.testnet", NOV, cu(100), 2_800_000n, margin);
    h.deposit("cfo.swarm-treasury.testnet", usdc(1_000));
    guardrail(h, "cfo.swarm-treasury.testnet", usdc(2_500));
    assert.ok(buy(h, "cfo.swarm-treasury.testnet", NOV, cu(100), 2_842_000n).ok);
    h.rt.advanceTo(NOV_MATURITY + 5 * MIN);
    assert.ok(h.attest(NOV, twap, NOV_MATURITY + MIN, `final-${twap}`).ok);
    const r = h.ok("cfo.swarm-treasury.testnet", "settle_cash_hedge", { series_id: NOV, cu_amount_scaled: cu(100).toString() });
    assert.equal(r.payout_micros, payout);
    assert.equal(r.hedge_pnl_micros, pnl);
    assert.ok(h.view("audit_series_invariants", { series_id: NOV }).holds);
  }
});

test("liquidation below 15% maintenance: identical health, price, bonus and refund to Rust", () => {
  const h = harness();
  h.deposit("batam-h100.testnet", usdc(1_000));
  const supply = short(h, "batam-h100.testnet", NOV, cu(300), 2_810_000n, 210_750_000n);
  h.deposit("cfo.swarm-treasury.testnet", usdc(1_000));
  guardrail(h, "cfo.swarm-treasury.testnet", usdc(2_500));
  assert.ok(buy(h, "cfo.swarm-treasury.testnet", NOV, cu(200), 2_842_000n).ok);
  h.rt.advanceTo(T0 + HOUR);
  const att = h.attest(NOV, 3_400_000n, T0 + HOUR - MIN, "spike-3.40").result;
  assert.deepEqual(att.flagged_vaults, [supply.vault_id]);
  const health = h.view("check_vault_health", { vault_id: supply.vault_id });
  assert.equal(health.health_bps, 1363);
  assert.equal(health.liquidation_price_micros, "3359782");
  h.deposit("mm.swarm-treasury.testnet", usdc(1_000));
  const r = h.ok("mm.swarm-treasury.testnet", "liquidate_underwater_vault", { vault_id: supply.vault_id });
  assert.deepEqual(
    [r.realized_loss_micros, r.liquidator_bonus_micros, r.provider_refund_micros, r.rehedge_margin_micros],
    ["118000000", "17000000", "75750000", "170000000"],
  );
  assert.equal(h.view("check_vault_health", { vault_id: r.liquidator_vault_id }).health_bps, 2500);
  assert.ok(h.view("audit_series_invariants", { series_id: NOV }).holds);
});

test("Mode B: delivery, automatic SLA slash and timeout slash match the Rust payouts", () => {
  const h = harness();
  h.deposit("batam-h100.testnet", usdc(1_000));
  short(h, "batam-h100.testnet", DEC, cu(200), 2_950_000n, 147_500_000n);
  h.deposit("consumer.swarm-treasury.testnet", usdc(500));
  guardrail(h, "consumer.swarm-treasury.testnet", usdc(1_000));
  assert.ok(buy(h, "consumer.swarm-treasury.testnet", DEC, cu(60), 2_994_250n).ok);
  const r1 = h.ok("consumer.swarm-treasury.testnet", "request_compute_redemption", { series_id: DEC, provider_id: "batam-h100.testnet", cu_amount_scaled: cu(24).toString() });
  const r2 = h.ok("consumer.swarm-treasury.testnet", "request_compute_redemption", { series_id: DEC, provider_id: "batam-h100.testnet", cu_amount_scaled: cu(16).toString() });
  const r3 = h.ok("consumer.swarm-treasury.testnet", "request_compute_redemption", { series_id: DEC, provider_id: "batam-h100.testnet", cu_amount_scaled: cu(10).toString() });
  assert.equal(h.view("get_redemption", { request_id: r1 }).strike_payment_micros, "70800000");
  h.ok("batam-h100.testnet", "acknowledge_redemption", { request_id: r1 });
  h.ok("batam-h100.testnet", "acknowledge_redemption", { request_id: r2 });
  const delivered = h.receipt(r1, "job-1", 180, true);
  assert.ok("DeliveredViaTee" in delivered.state);
  const slashed = h.receipt(r2, "job-2", 1_450, false);
  assert.equal(slashed.state.SlashedForSlaBreach.reason, "tee_receipt_sla_violation");
  assert.equal(slashed.state.SlashedForSlaBreach.payout_micros, "54280000");
  assert.match(h.call("relayer.testnet", "claim_sla_breach_slash", { request_id: r3 }).error!, /no SLA breach/);
  h.rt.advanceBy(16 * MIN);
  const timeout = h.ok("relayer.testnet", "claim_sla_breach_slash", { request_id: r3 });
  assert.equal(timeout.state.SlashedForSlaBreach.payout_micros, "33925000");
  assert.equal(h.free("consumer.swarm-treasury.testnet"), usdc(500) - 177_000_000n + 54_280_000n + 33_925_000n);
  assert.equal(h.view("get_provider_stats", { provider_id: "batam-h100.testnet" }).reliability_bps, 3333);
  assert.ok(h.view("audit_series_invariants", { series_id: DEC }).holds);
});

test("OutLayer attestations: forged signature, replay, stale window and 100% circuit breaker are rejected", () => {
  const h = harness();
  h.rt.advanceTo(T0 + HOUR);
  const forgedKey = deterministicKeyPair("attacker");
  const hash = sha256Hex("forged");
  const forged = bytesToHex(signEd25519(forgedKey.secretKey, `${NOV}:9000000:${T0 + 50 * MIN}:${hash}`));
  assert.match(h.call("relayer.testnet", "submit_outlayer_index_attestation", { series_id: NOV, twap_micros: "9000000", observed_at_ms: T0 + 50 * MIN, tdx_quote_hash: hash, signature_hex: forged }).error!, /invalid OutLayer TEE signature/);
  assert.ok(h.attest(NOV, 3_000_000n, T0 + 40 * MIN, "replayed").ok);
  assert.match(h.attest(NOV, 3_000_000n, T0 + 50 * MIN, "replayed").error!, /already consumed/);
  assert.match(h.attest(NOV, 3_000_000n, T0 - 30 * MIN, "stale").error!, /stale|older than the current index/);
  assert.match(h.attest(NOV, 6_100_000n, T0 + 55 * MIN, "jump").error!, /circuit breaker/);
});

test("stale-quote band purges asks below index × 0.95 on an attested spike", () => {
  const h = harness();
  h.deposit("batam-h100.testnet", usdc(1_000));
  const supply = short(h, "batam-h100.testnet", NOV, cu(300), 2_810_000n, 210_750_000n);
  h.rt.advanceTo(T0 + HOUR);
  const out = h.attest(NOV, 3_400_000n, T0 + HOUR - MIN, "purge").result;
  assert.equal(out.purged_orders.length, 4);
  assert.equal(h.view("get_order_book", { series_id: NOV }).best_ask_micros, null);
  assert.equal(h.view("get_vault", { vault_id: supply.vault_id }).listed_cu_scaled, "0");
});
