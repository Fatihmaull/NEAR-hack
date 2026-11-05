/**
 * NEAR Intents 1Click Swap API client (https://1click.chaindefuser.com).
 *
 * - **Live mode** (`ONE_CLICK_JWT` set, or `live: true`): `POST /v0/quote`, `POST /v0/deposit/submit`,
 *   `GET /v0/status`, authenticated with `Authorization: Bearer <JWT>`.
 * - **Local mode** (zero config): a deterministic quote with the exact same response shape, priced
 *   from a fixed reference table and clearly flagged `simulated: true`.
 *
 * Paron funds agents *directly into the protocol*: `recipient` is the Paron contract and
 * `customRecipientMsg` is the `ft_transfer_call` msg, e.g. `{"action":"deposit","beneficiary":"cfo…"}`,
 * so the swapped USDC lands as the agent's free margin balance in one hop.
 */
import { base58, bytesToHex, canonicalJson, sha256 } from "./crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const ONE_CLICK_BASE_URL = "https://1click.chaindefuser.com";

/** NEAR Intents asset ids (mainnet; 1Click operates on mainnet). */
export const INTENTS_ASSETS = {
  NEAR_USDC: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  BASE_USDC: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  ETH_USDC: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  SOL: "nep141:sol.omft.near",
} as const;

export const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";

export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: SwapType;
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
  referral?: string;
  quoteWaitingTimeMs?: number;
  customRecipientMsg?: string;
}

export interface OneClickQuote {
  depositAddress?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
}

export interface OneClickQuoteResponse {
  correlationId?: string;
  timestamp: string;
  signature: string;
  quoteRequest: OneClickQuoteRequest;
  quote: OneClickQuote;
  /** Added by this client in local mode. */
  simulated?: boolean;
  source?: string;
}

export interface OneClickDepositStatus {
  correlationId?: string;
  status: "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
  updatedAt: string;
  simulated?: boolean;
}

interface AssetInfo {
  symbol: string;
  decimals: number;
  /** Local reference price, USD micros per whole token (deterministic simulation only). */
  usdMicros: bigint;
  chain: "near" | "base" | "eth" | "sol";
}

const LOCAL_ASSET_TABLE: Record<string, AssetInfo> = {
  [INTENTS_ASSETS.NEAR_USDC]: { symbol: "USDC", decimals: 6, usdMicros: 1_000_000n, chain: "near" },
  [INTENTS_ASSETS.BASE_USDC]: { symbol: "USDC", decimals: 6, usdMicros: 1_000_000n, chain: "base" },
  [INTENTS_ASSETS.ETH_USDC]: { symbol: "USDC", decimals: 6, usdMicros: 1_000_000n, chain: "eth" },
  [INTENTS_ASSETS.SOL]: { symbol: "SOL", decimals: 9, usdMicros: 165_000_000n, chain: "sol" },
};

/** Local-simulation solver spread (8 bps) — the live API returns real solver pricing instead. */
export const LOCAL_SOLVER_SPREAD_BPS = 8n;

const formatUnits = (amount: bigint, decimals: number): string => {
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
};
const formatUsd = (micros: bigint): string => formatUnits(micros, 6);

/** Deterministic 1Click-shaped quote for zero-config runs (EXACT_INPUT). */
export function deterministicQuote(req: OneClickQuoteRequest, nowIso: string): OneClickQuoteResponse {
  const from = LOCAL_ASSET_TABLE[req.originAsset];
  const to = LOCAL_ASSET_TABLE[req.destinationAsset];
  if (!from || !to) throw new Error(`asset not supported by the local quote table: ${req.originAsset} -> ${req.destinationAsset}`);
  if (req.swapType !== "EXACT_INPUT") throw new Error("local deterministic quotes support EXACT_INPUT");
  const amountIn = BigInt(req.amount);
  const usdIn = (amountIn * from.usdMicros) / 10n ** BigInt(from.decimals);
  const usdOut = (usdIn * (10_000n - LOCAL_SOLVER_SPREAD_BPS)) / 10_000n;
  const amountOut = (usdOut * 10n ** BigInt(to.decimals)) / to.usdMicros;
  const minAmountOut = (amountOut * BigInt(10_000 - req.slippageTolerance)) / 10_000n;
  const digest = sha256(canonicalJson(req));
  const depositAddress =
    from.chain === "sol" ? base58.encode(digest) : `0x${bytesToHex(keccak_256(digest)).slice(-40)}`;
  return {
    correlationId: `${bytesToHex(digest).slice(0, 8)}-${bytesToHex(digest).slice(8, 12)}-${bytesToHex(digest).slice(12, 16)}-${bytesToHex(digest).slice(16, 20)}-${bytesToHex(digest).slice(20, 32)}`,
    timestamp: nowIso,
    signature: `local-sim:${bytesToHex(sha256(digest))}`,
    quoteRequest: req,
    quote: {
      depositAddress: req.dry ? undefined : depositAddress,
      amountIn: amountIn.toString(),
      amountInFormatted: formatUnits(amountIn, from.decimals),
      amountInUsd: formatUsd(usdIn),
      minAmountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutFormatted: formatUnits(amountOut, to.decimals),
      amountOutUsd: formatUsd(usdOut),
      minAmountOut: minAmountOut.toString(),
      deadline: req.dry ? undefined : req.deadline,
      timeWhenInactive: req.dry ? undefined : req.deadline,
      timeEstimate: from.chain === "sol" ? 15 : 20,
    },
    simulated: true,
    source: "paron-local-deterministic-quote (no ONE_CLICK_JWT)",
  };
}

export interface IntentsBridgeOptions {
  jwt?: string;
  baseUrl?: string;
  /** Force live mode even without a JWT (1Click charges a fee without one). */
  live?: boolean;
  fetchImpl?: typeof fetch;
  /** Clock for deterministic local quotes. */
  now?: () => number;
}

export class OneClickIntentsBridge {
  readonly mode: "live" | "local";
  private readonly baseUrl: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(private readonly opts: IntentsBridgeOptions = {}) {
    this.mode = opts.jwt || opts.live ? "live" : "local";
    this.baseUrl = opts.baseUrl ?? ONE_CLICK_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.opts.jwt) h.authorization = `Bearer ${this.opts.jwt}`;
    return h;
  }

  private nowIso(): string {
    return new Date(this.opts.now ? this.opts.now() : Date.now()).toISOString();
  }

  async quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse> {
    if (this.mode === "local") return deterministicQuote(request, this.nowIso());
    if (!this.fetchImpl) throw new Error("fetch is not available for live 1Click calls");
    const res = await this.fetchImpl(`${this.baseUrl}/v0/quote`, { method: "POST", headers: this.headers(), body: JSON.stringify(request) });
    if (!res.ok) throw new Error(`1Click /v0/quote failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as OneClickQuoteResponse;
  }

  /** Notify 1Click of the origin-chain deposit tx to speed up processing. */
  async submitDeposit(txHash: string, depositAddress: string, nearSenderAccount?: string): Promise<OneClickDepositStatus> {
    if (this.mode === "local") return { status: "SUCCESS", updatedAt: this.nowIso(), simulated: true };
    if (!this.fetchImpl) throw new Error("fetch is not available for live 1Click calls");
    const res = await this.fetchImpl(`${this.baseUrl}/v0/deposit/submit`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ txHash, depositAddress, nearSenderAccount }),
    });
    if (!res.ok) throw new Error(`1Click /v0/deposit/submit failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as OneClickDepositStatus;
  }

  async status(depositAddress: string): Promise<OneClickDepositStatus> {
    if (this.mode === "local") return { status: "SUCCESS", updatedAt: this.nowIso(), simulated: true };
    if (!this.fetchImpl) throw new Error("fetch is not available for live 1Click calls");
    const res = await this.fetchImpl(`${this.baseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`1Click /v0/status failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as OneClickDepositStatus;
  }
}

/** Build the quote request that swaps an origin asset straight into an agent's Paron margin balance. */
export function paronFundingQuoteRequest(params: {
  originAsset: string;
  amount: bigint;
  refundTo: string;
  paronContractId: string;
  beneficiary: string;
  deadlineIso: string;
  slippageBps?: number;
}): OneClickQuoteRequest {
  return {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: params.slippageBps ?? 100,
    originAsset: params.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: INTENTS_ASSETS.NEAR_USDC,
    amount: params.amount.toString(),
    refundTo: params.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: params.paronContractId,
    recipientType: "DESTINATION_CHAIN",
    deadline: params.deadlineIso,
    referral: "paron",
    quoteWaitingTimeMs: 3_000,
    customRecipientMsg: JSON.stringify({ action: "deposit", beneficiary: params.beneficiary }),
  };
}
