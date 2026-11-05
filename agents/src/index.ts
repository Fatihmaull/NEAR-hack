/**
 * @paron/agents — browser-safe public surface (consumed by the Next.js terminal and /tour).
 * Node-only entrypoints (run-swarm-demo, verify-receipt, run-agent-live, near-live) are not re-exported.
 */
export * from "./crypto";
export * from "./engine/math";
export type * from "./engine/types";
export { ContractPanic, ParonLocalContract, PAYABLE_METHODS, VIEW_METHODS, isSubAccount, labelQuoteHash } from "./engine/paron-contract";
export type { CallContext, ContractState } from "./engine/paron-contract";
export { LocalNearRuntime, DEFAULT_FC_ALLOWANCE_YOCTO, GAS_PRICE_YOCTO, TGAS } from "./engine/runtime";
export type { AccessKeyPermission, CallOutcome, KeyHandle, TxRecord } from "./engine/runtime";
export * from "./oracle/cri-oracle";
export * from "./chain-signatures";
export * from "./intents-bridge";
export * from "./client";
export * from "./outlayer-client";
export * from "./receipt-verifier";
export * from "./swarm-events";
export * from "./swarm";
export { CfoHedgingAgent, dailyVolatilityBps, isqrt } from "./cfo-hedging-agent";
export type { CfoHedgingConfig, RunwayAssessment } from "./cfo-hedging-agent";
export { YieldLpMarketMakerAgent, TICK_MICROS } from "./market-maker-agent";
export type { MarketMakerConfig, QuoteSpec } from "./market-maker-agent";
export { ComputeConsumerAgent, describeState } from "./compute-redeemer-agent";
export { ComputeProviderNode } from "./compute-provider";
