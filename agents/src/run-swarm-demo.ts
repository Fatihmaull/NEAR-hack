/**
 * `npm run demo:swarm` — the deterministic 5-act autonomous agent swarm simulation.
 * Zero configuration: every transaction is Ed25519-signed and executed by the local Paron engine; every
 * index/SLA verdict is an OutLayer-format attestation. Set ONE_CLICK_JWT for live 1Click quotes and
 * OUTLAYER_API_URL/OUTLAYER_API_KEY to use the deployed enclave worker. Exits non-zero if any protocol
 * outcome or cryptographic check deviates from the expected path.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { u128 } from "./client";
import { formatCu, formatPrice, formatUsdc, usdc } from "./engine/math";
import { OneClickIntentsBridge } from "./intents-bridge";
import { oracleFromEnv } from "./outlayer-client";
import { verifyReceipt } from "./receipt-verifier";
import { ACTS, SWARM_ACCOUNTS, SwarmSimulation } from "./swarm";
import type { SwarmEvent } from "./swarm-events";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c(1, s);
const dim = (s: string) => c(2, s);
const green = (s: string) => c(32, s);
const red = (s: string) => c(31, s);
const cyan = (s: string) => c(36, s);
const yellow = (s: string) => c(33, s);

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => `│ ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" │ ")} │`;
  const sep = (l: string, m: string, r: string) => `${l}${widths.map((w) => "─".repeat(w + 2)).join(m)}${r}`;
  return [sep("┌", "┬", "┐"), line(headers), sep("├", "┼", "┤"), ...rows.map(line), sep("└", "┴", "┘")].join("\n");
}

let lastDay = "";
function printEvent(e: SwarmEvent): void {
  if (e.actor === "Tour") {
    console.log(`\n${bold(cyan(`━━ ${e.title} ━━`))}\n${dim(e.detail ?? "")}`);
    return;
  }
  const iso = new Date(e.t).toISOString();
  const day = iso.slice(0, 10);
  const stamp = day !== lastDay ? `${day} ${iso.slice(11, 16)}` : `           ${iso.slice(11, 16)}`;
  lastDay = day;
  const mark = e.ok === false ? (e.kind === "guardrail" || e.kind === "security" ? yellow("⛔") : red("✗")) : green("✓");
  const key = e.keyKind ? dim(` [${e.keyKind === "FunctionCall" ? "FC key" : "full key"}]`) : "";
  console.log(`${dim(stamp)} ${mark} ${bold(e.actor.padEnd(27))} ${e.title}${key}`);
  if (e.detail) console.log(`${" ".repeat(19)}${dim(`↳ ${e.detail}`)}`);
}

function expect(condition: boolean, message: string, failures: string[]): void {
  if (!condition) failures.push(message);
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const env = process.env;
  console.log(bold("\nPARON v2 — Autonomous Compute Forward & Runway Hedging Desk for AI Agents on NEAR"));
  console.log(dim("5-act autonomous agent swarm · NEP-245 CU forwards · OutLayer TEE · NEAR Intents · Chain Signatures\n"));
  let sim: SwarmSimulation | undefined;
  const bridge = new OneClickIntentsBridge({ jwt: env.ONE_CLICK_JWT, live: env.ONE_CLICK_LIVE === "1", now: () => sim?.runtime.nowMs ?? Date.now() });
  const oracle = oracleFromEnv(env);
  sim = await SwarmSimulation.create({ onEvent: printEvent, bridge, oracle });
  console.log(dim(`modes → NEAR: local signed runtime (${SWARM_ACCOUNTS.contract}) · 1Click: ${bridge.mode} · OutLayer: ${oracle.mode}`));
  const receipt = await sim.runAll();
  const snap = receipt.final_state as Record<string, unknown>;
  const outcomes = receipt.outcomes as Record<string, unknown>;

  console.log(`\n${bold("OutLayer TEE attestations (Ed25519, verified on-chain)")}`);
  console.log(
    table(
      ["label", "series", "CRI-H100 TWAP", "feeds ok/rej", "tdx_quote_hash", "flagged"],
      sim.attestations.map((a) => [
        a.label,
        a.attestation.series_id,
        formatPrice(BigInt(a.attestation.twap_micros)),
        `${a.attestation.accepted_count}/${a.attestation.rejected_count}`,
        `${a.attestation.tdx_quote_hash.slice(0, 20)}…`,
        a.flaggedVaults.length ? a.flaggedVaults.map((v) => `#${v}`).join(",") : "-",
      ]),
    ),
  );
  console.log(
    table(
      ["TDX receipt", "request", "CU consumed", "TTFT", "tok/s", "sla_met", "tdx_quote_hash"],
      sim.jobReceipts.map((r) => [r.job_id, `#${r.request_id}`, formatCu(BigInt(r.cu_consumed_scaled)), `${r.ttft_ms} ms`, (r.tokens_per_sec_milli / 1000).toFixed(1), String(r.sla_met), `${r.tdx_quote_hash.slice(0, 20)}…`]),
    ),
  );

  const txs = sim.runtime.txs;
  const fc = txs.filter((t) => t.access_key === "FunctionCall").length;
  console.log(`\n${bold("Signed transactions")}  ${txs.length} total · ${fc} via Function Call keys · ${txs.length - fc} via full-access keys`);
  console.log(
    table(
      ["#", "signer", "method", "status"],
      txs
        .filter((t) => t.status === "Failure")
        .map((t) => [String(t.index), t.signer_id, t.method, `expected rejection: ${(t.error ?? "").slice(0, 78)}`]),
    ),
  );

  console.log(`\n${bold("Final balances (free USDC inside Paron · NEP-245 CU)")}`);
  const balances = snap.balances as Record<string, { free_usdc_micros: string; cu: string[] }>;
  console.log(
    table(
      ["account", "free USDC", "CU-2026-11", "CU-2026-12", "CU-2027-01"],
      Object.entries(balances).map(([a, b]) => [a, formatUsdc(BigInt(b.free_usdc_micros)), ...b.cu.map((x) => formatCu(BigInt(x)))]),
    ),
  );

  const cash = (snap.cash_receipts as Array<Record<string, string>>)[0];
  const liq = (snap.liquidations as Array<Record<string, string>>)[0];
  const stats = snap.provider_stats as Record<string, number>;
  const mmFree = BigInt(balances[SWARM_ACCOUNTS.marketMaker].free_usdc_micros);
  console.log(`\n${bold("Agent outcomes")}`);
  console.log(
    table(
      ["agent", "outcome"],
      [
        ["CFO-Hedging-Agent", `hedged ${formatCu(u128(cash.cu_amount_scaled))} @ ${formatPrice(u128(cash.avg_entry_price_micros))} → Mode A payout ${formatUsdc(u128(cash.payout_micros))} · ΔV ${formatUsdc(BigInt(cash.hedge_pnl_micros))}`],
        ["", `unhedged spot bill would have been ${formatUsdc(BigInt(String(outcomes.unhedged_spot_cost_micros)))} → effective compute cost locked at ${formatUsdc(u128(cash.cost_basis_micros))}`],
        ["Yield-LP-Market-Maker-Agent", `liquidated vault #${liq.vault_id} (bonus ${formatUsdc(u128(liq.liquidator_bonus_micros))}) · net ${formatUsdc(mmFree - usdc(6_000))} after a +46% spike against its shorts`],
        ["Compute-Consumer-Agent", `1 job delivered, 2 SLA breaches compensated: +${formatUsdc(BigInt(String(outcomes.consumer_sla_compensation_micros)))} penalties on top of 100% refunds`],
        ["Batam-H100-Provider", `delivered ${stats.delivered_count} · slashed ${stats.slashed_count} · reliability ${(stats.reliability_bps / 100).toFixed(2)}%`],
      ],
    ),
  );

  const verification = verifyReceipt(receipt);
  console.log(`\n${bold("Receipt verification")}`);
  for (const check of verification.checks) console.log(`  ${check.ok ? green("✓") : red("✗")} ${check.name.padEnd(32)} ${dim(check.detail)}`);
  const invariants = snap.invariants as Array<{ series_id: string; holds: boolean }>;
  for (const inv of invariants) console.log(`  ${inv.holds ? green("✓") : red("✗")} ${`supply conservation ${inv.series_id}`.padEnd(32)} ${dim("circulating CU == Σ vault obligations (or settlement pool)")}`);

  // ---- self-checks: the gate fails if the protocol deviates from the expected path ----------
  const failures: string[] = [];
  const reds = outcomes.redemptions as Array<{ request_id: number; final_state: string }>;
  expect(u128(cash.cu_amount_scaled) === 5_000_000n, "CFO should hedge exactly 500 CU", failures);
  expect(u128(cash.payout_micros) === 2_050_000_000n, "Mode A payout should be 500 CU × $4.10 = $2,050", failures);
  expect(BigInt(cash.hedge_pnl_micros) > 0n, "CFO hedge PnL should be positive after the spike", failures);
  expect(outcomes.liquidations === 1, "exactly one under-margined vault should be liquidated", failures);
  expect(JSON.stringify(reds.map((r) => r.final_state)) === JSON.stringify(["DeliveredViaTee", "SlashedForSlaBreach", "SlashedForSlaBreach"]), "Mode B outcomes should be delivered / slashed / slashed", failures);
  expect((outcomes.failed_transactions as unknown[]).length === 2, "only the guardrail rejection and the Function Call key block should fail", failures);
  expect(outcomes.invariants_hold === true, "supply conservation invariants must hold", failures);
  expect(verification.ok, "receipt verification must pass", failures);

  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "latest-swarm-receipt.json");
  writeFileSync(out, JSON.stringify(receipt, null, 2));
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n${bold("Audit receipt")} ${out}\n  receipt_sha256 ${cyan(receipt.receipt_sha256)}\n  ${ACTS.length} acts · ${txs.length} signed txs · ${sim.attestations.length + sim.jobReceipts.length} OutLayer attestations · ${elapsed}s`);
  if (failures.length > 0) {
    console.error(red(`\nSWARM SELF-CHECK FAILED:\n - ${failures.join("\n - ")}`));
    process.exit(1);
  }
  console.log(green(bold("\n✔ Swarm simulation complete — all protocol outcomes and cryptographic checks verified.")));
}

main().catch((e) => {
  console.error(red(`swarm demo crashed: ${(e as Error).stack ?? e}`));
  process.exit(1);
});
