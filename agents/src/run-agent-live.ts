/**
 * Live mode: run one agent against the deployed Paron contract on NEAR testnet.
 *
 *   NEAR_ACCOUNT_ID=cfo.your-treasury.testnet NEAR_PRIVATE_KEY=ed25519:... PARON_CONTRACT_ID=market.your.testnet \
 *     npm --prefix agents run agent:live -- cfo [--execute]
 *
 * Roles: `status` (read-only protocol & book), `cfo` (runway VaR, optional guardrailed hedge),
 * `mm` (two-sided post-only quotes), `consumer` (inventory + redemption status).
 * Without `--execute` every role is read-only. Without the env vars it explains how to configure live mode.
 */
import { CfoHedgingAgent } from "./cfo-hedging-agent";
import { u128, type ParonClient } from "./client";
import { cu, formatCu, formatPrice, formatUsdc, usdc } from "./engine/math";
import { YieldLpMarketMakerAgent } from "./market-maker-agent";
import { liveConfigFromEnv, NearLiveClient } from "./near-live";
import type { SwarmEvent } from "./swarm-events";
import { TRAILING_CRI_HISTORY_MICROS } from "./swarm";

const role = process.argv[2] ?? "status";
const execute = process.argv.includes("--execute");
const series = process.env.PARON_SERIES_ID ?? "CU-2026-11";
const emit = (e: Omit<SwarmEvent, "seq" | "act" | "t">) => console.log(`${e.ok === false ? "✗" : "•"} ${e.actor}: ${e.title}${e.detail ? `\n    ${e.detail}` : ""}`);

async function status(client: ParonClient): Promise<void> {
  const stats = await client.view<Record<string, unknown>>("protocol_stats");
  console.log("protocol_stats:", JSON.stringify(stats, null, 2));
  for (const s of await client.view<Array<Record<string, string>>>("list_series")) {
    const book = await client.view<{ best_bid_micros: string | null; best_ask_micros: string | null }>("get_order_book", { series_id: s.series_id });
    console.log(
      `${s.series_id}: index ${formatPrice(u128(s.index_twap_usdc_micros))} · bid ${book.best_bid_micros ? formatPrice(u128(book.best_bid_micros)) : "-"} / ask ${book.best_ask_micros ? formatPrice(u128(book.best_ask_micros)) : "-"} · OI ${formatCu(u128(s.total_open_interest_cu))}`,
    );
  }
  console.log(`free USDC of ${client.accountId}: ${formatUsdc(u128(await client.view<string>("usdc_balance_of", { account_id: client.accountId })))}`);
}

async function main(): Promise<void> {
  const cfg = liveConfigFromEnv(process.env);
  if (!cfg) {
    console.log(
      [
        "Live mode is not configured — the swarm runs fully offline with `npm run demo:swarm`.",
        "To run an agent against NEAR testnet set:",
        "  NEAR_ACCOUNT_ID    agent account (e.g. cfo.your-treasury.testnet)",
        "  NEAR_PRIVATE_KEY   its Function Call access key (ed25519:...) scoped to the Paron contract",
        "  PARON_CONTRACT_ID  deployed paron-core account",
        "  NEAR_RPC_URL       optional, defaults to https://test.rpc.fastnear.com",
      ].join("\n"),
    );
    return;
  }
  const client = new NearLiveClient(cfg);
  console.log(`live mode → ${cfg.rpcUrl} · contract ${cfg.contractId} · signer ${cfg.accountId} (${cfg.keyKind})${execute ? " · EXECUTING" : " · read-only"}`);
  await status(client);
  if (role === "cfo") {
    const agent = new CfoHedgingAgent(client, emit, {
      seriesId: series,
      forecastCuScaled: cu(Number(process.env.CFO_FORECAST_CU ?? 500)),
      monthlyComputeBudgetMicros: usdc(Number(process.env.CFO_MONTHLY_BUDGET_USDC ?? 10_000)),
      varTriggerBps: 200n,
      varZx1000: 1_645n,
      horizonDays: 30,
      urgencyPremiumBps: 0n,
      stressIndexMicros: 4_100_000n,
    });
    const s = await client.view<{ index_twap_usdc_micros: string }>("get_series", { series_id: series });
    const assessment = agent.assessRunway(TRAILING_CRI_HISTORY_MICROS, u128(s.index_twap_usdc_micros));
    if (execute && assessment.decision === "HEDGE") await agent.hedge();
  } else if (role === "mm") {
    const mm = new YieldLpMarketMakerAgent(client, emit, { quotes: [{ seriesId: series, halfSpreadBps: 25n, sizeCuScaled: cu(Number(process.env.MM_SIZE_CU ?? 50)) }], bufferTargetBps: 4_000n, topUpTriggerBps: 3_000 });
    if (execute) {
      await mm.riskCheck(series);
      await mm.quoteAll();
    }
  } else if (role === "consumer") {
    const balance = await client.view<string>("mt_balance_of", { account_id: cfg.accountId, token_id: series });
    console.log(`${cfg.accountId} holds ${formatCu(u128(balance))} of ${series}`);
    console.log("redemptions:", JSON.stringify(await client.view("get_redemptions", {}), null, 2));
  }
}

main().catch((e) => {
  console.error(`live agent failed: ${(e as Error).message}`);
  process.exit(1);
});
