import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyReceipt } from "../src/receipt-verifier";
import { SwarmSimulation } from "../src/swarm";

test("full 5-act swarm reaches the expected protocol outcomes", async () => {
  const sim = await SwarmSimulation.create();
  const receipt = await sim.runAll();
  const outcomes = receipt.outcomes as Record<string, any>;
  assert.equal(outcomes.cfo_hedged_cu, "5000000");
  assert.equal(outcomes.cfo_cash_settlement_payout_micros, "2050000000");
  assert.equal(outcomes.cfo_hedge_pnl_micros, "645900000");
  assert.equal(outcomes.liquidations, 1);
  assert.deepEqual(outcomes.redemptions.map((r: any) => r.final_state), ["DeliveredViaTee", "SlashedForSlaBreach", "SlashedForSlaBreach"]);
  assert.equal(outcomes.invariants_hold, true);
  assert.equal(outcomes.failed_transactions.length, 2);
  assert.ok(verifyReceipt(receipt).ok);
});

test("swarm receipts are deterministic and tamper-evident", async () => {
  const a = await (await SwarmSimulation.create()).runAll();
  const b = await (await SwarmSimulation.create()).runAll();
  assert.equal(a.receipt_sha256, b.receipt_sha256);
  const tampered = structuredClone(a) as any;
  tampered.outlayer.index_attestations[4].attestation.twap_micros = 4_200_000;
  const v = verifyReceipt(tampered);
  assert.equal(v.ok, false);
  assert.equal(v.checks.find((c) => c.name === "OutLayer index attestations")!.ok, false);
  const forgedTx = structuredClone(a) as any;
  forgedTx.transactions[10].tx_hash = forgedTx.transactions[11].tx_hash;
  assert.equal(verifyReceipt(forgedTx).checks.find((c) => c.name === "transaction signatures")!.ok, false);
});

test("acts run one at a time for the web tour", async () => {
  const sim = await SwarmSimulation.create();
  await assert.rejects(sim.runAct(2), /acts must run in order/);
  await sim.runAct(1);
  assert.equal(sim.nextAct, 2);
  const snap = sim.snapshot() as any;
  assert.equal(BigInt(snap.balances["cfo.swarm-treasury.testnet"].free_usdc_micros) > 0n, true);
});

test("interactive terminal operations work in any order", async () => {
  const sim = await SwarmSimulation.create();
  for (const act of [1, 2, 3]) await sim.runAct(act);
  const judge = sim.onboardAgent("judge.swarm-treasury.testnet", {
    fundingMicros: 5_000_000_000n,
    maxDailySpendMicros: 4_000_000_000n,
    slippageBps: 150,
    methods: ["agent_buy_forward", "open_short_supply", "cancel_order", "place_bid", "settle_cash_hedge"],
  });
  const buy = await judge.call("agent_buy_forward", { series_id: "CU-2027-01", cu_amount_scaled: "1000000", max_price_micros: "3146500" });
  assert.ok(buy.ok, buy.error);
  const happy = await sim.runRedemption("happy");
  assert.ok(happy.ok, happy.error);
  const spike = await sim.attestCustom("CU-2026-11", 3_050_000, 1_100_000);
  assert.ok(spike.ok, spike.error);
  const ghost = await sim.runRedemption("ghost");
  assert.ok(ghost.ok, ghost.error);
  const settle = await sim.settleCfoAtMaturity(4_100_000);
  assert.ok(settle.ok, settle.error);
  // Mode B still works on the December series after the November cash settlement.
  const throttled = await sim.runRedemption("throttled");
  assert.ok(throttled.ok, throttled.error);
  const snap = sim.snapshot() as any;
  assert.ok((snap.invariants as Array<{ holds: boolean }>).every((i) => i.holds));
  assert.equal((snap.cash_receipts as unknown[]).length, 1);
});
