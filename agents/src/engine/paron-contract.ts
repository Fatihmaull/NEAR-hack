/**
 * ParonLocalContract — deterministic TypeScript mirror of `contracts/paron-core`.
 *
 * Same method names, JSON argument/return shapes (U128 as strings), check ordering and panic messages
 * as the Rust contract, so agents run unchanged against this engine (zero-config local mode) or against
 * the deployed contract on NEAR testnet (live mode). Parity is enforced by `test/engine.test.ts`, which
 * replays the Rust unit-test scenarios with identical expected numbers.
 */
import { bytesToHex, hexToBytes, parseEd25519PublicKey, sha256Hex, toJsonValue, verifyEd25519 } from "../crypto";
import * as M from "./math";
import type {
  AgentGuardrailPolicy,
  AttestationOutcome,
  CashSettlementReceipt,
  ComputeSeries,
  FillDetail,
  GpuTier,
  LiquidationReceipt,
  LongPosition,
  Order,
  OrderBook,
  OrderBookView,
  PriceLevel,
  ProtocolStats,
  ProviderStats,
  RedemptionRequest,
  RedemptionState,
  SeriesInvariantReport,
  ShortMarginVault,
  ShortSupplyOutcome,
  Side,
  SlaConfig,
  TradeReport,
  VaultHealth,
} from "./types";

export class ContractPanic extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractPanic";
  }
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractPanic(message);
}

export interface CallContext {
  predecessor: string;
  signer: string;
  current_account_id: string;
  now_ms: number;
  attached_deposit_yocto: bigint;
  logs: string[];
}

export interface ContractState {
  owner_id: string;
  usdc_token_id: string;
  tee_signer_pubkey_hex: string;
  series_ids: string[];
  series: Record<string, ComputeSeries>;
  mt_balances: Record<string, bigint>;
  mt_supply: Record<string, bigint>;
  long_positions: Record<string, LongPosition>;
  usdc_balances: Record<string, bigint>;
  books: Record<string, OrderBook>;
  vaults: Record<string, ShortMarginVault>;
  vault_index: Record<string, number>;
  series_vaults: Record<string, number[]>;
  guardrails: Record<string, AgentGuardrailPolicy>;
  guardrail_delegations: Record<string, string>;
  redemptions: Record<string, RedemptionRequest>;
  provider_stats: Record<string, ProviderStats>;
  used_quote_hashes: Record<string, true>;
  cash_receipts: CashSettlementReceipt[];
  liquidation_receipts: LiquidationReceipt[];
  next_order_id: number;
  next_vault_id: number;
  next_request_id: number;
  insurance_pool_micros: bigint;
  genesis_credit_outstanding_micros: bigint;
  total_deposited_micros: bigint;
  total_withdrawn_micros: bigint;
  sla: SlaConfig;
}

type PriceGuard = { kind: "BuyAtMost"; price: bigint } | { kind: "SellAtLeast"; price: bigint } | { kind: "None" };
const NO_GUARD: PriceGuard = { kind: "None" };

type DepositInstruction = { action: "deposit"; beneficiary?: string | null } | { action: "insurance" } | { action: "fund_genesis" };

const key = (a: string, b: string): string => `${a}|${b}`;
const big = (v: unknown, field: string): bigint => {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new ContractPanic(`Failed to deserialize input from JSON: invalid U128 for \`${field}\``);
};
const num = (v: unknown, field: string): number => {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  throw new ContractPanic(`Failed to deserialize input from JSON: invalid integer for \`${field}\``);
};
const str = (v: unknown, field: string): string => {
  if (typeof v === "string") return v;
  throw new ContractPanic(`Failed to deserialize input from JSON: missing \`${field}\``);
};

export function isLowerHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function isSubAccount(child: string, parent: string): boolean {
  return child.length > parent.length && child.endsWith(`.${parent}`);
}

export const indexAttestationMessage = (seriesId: string, twap: bigint, observedAtMs: number, hash: string): string =>
  `${seriesId}:${twap}:${observedAtMs}:${hash}`;
export const executionReceiptMessage = (requestId: number, hash: string, latencyMs: number, slaMet: boolean): string =>
  `${requestId}:${hash}:${latencyMs}:${slaMet}`;

const isFinal = (s: RedemptionState): boolean => "DeliveredViaTee" in s || "SlashedForSlaBreach" in s || "CashSettledAtMaturity" in s;

interface SellMatch {
  fills: FillDetail[];
  filled: bigint;
  notional: bigint;
  refunds: Array<[string, bigint]>;
}
interface BuyMatch extends SellMatch {
  stale_cancelled: number[];
  vaults: Map<number, ShortMarginVault>;
}

export const PAYABLE_METHODS = new Set([
  "withdraw_usdc",
  "set_tee_signer_pubkey",
  "set_sla_config",
  "mt_transfer",
  "mt_batch_transfer",
  "mt_transfer_call",
  "delegate_guardrail_owner",
  "configure_agent_guardrail",
  "set_agent_paused",
]);

export const VIEW_METHODS = new Set([
  "get_series",
  "list_series",
  "usdc_balance_of",
  "get_long_position",
  "get_provider_stats",
  "get_cash_settlement_receipts",
  "get_liquidation_receipts",
  "protocol_stats",
  "audit_series_invariants",
  "mt_balance_of",
  "mt_batch_balance_of",
  "mt_supply",
  "mt_batch_supply",
  "mt_token",
  "convert_hardware_to_cu",
  "get_agent_guardrail",
  "agent_remaining_allowance",
  "check_vault_health",
  "get_vault",
  "get_vault_by_provider",
  "list_vaults",
  "list_vault_health",
  "quote_initial_margin",
  "get_order_book",
  "get_open_orders",
  "get_raw_order_book",
  "get_redemption",
  "get_redemptions",
]);

export class ParonLocalContract {
  state!: ContractState;
  private ctx!: CallContext;

  /** Run `fn` with a NEAR-like execution context (predecessor, block time, attached deposit, logs). */
  withContext<T>(ctx: CallContext, fn: () => T): T {
    const previous = this.ctx;
    this.ctx = ctx;
    try {
      return fn();
    } finally {
      this.ctx = previous;
    }
  }

  /** JSON entrypoint used by the local runtime: same arguments and results as the on-chain contract. */
  dispatch(method: string, args: Record<string, unknown>): unknown {
    const a = args ?? {};
    const handler = (this as unknown as Record<string, (x: Record<string, unknown>) => unknown>)[`m_${method}`];
    if (typeof handler !== "function") throw new ContractPanic(`MethodNotFound: ${method}`);
    return toJsonValue(handler.call(this, a));
  }

  // ============================================================================================
  // env helpers
  // ============================================================================================
  private get now(): number {
    return this.ctx.now_ms;
  }
  private get predecessor(): string {
    return this.ctx.predecessor;
  }
  private get self(): string {
    return this.ctx.current_account_id;
  }
  private assertOneYocto(): void {
    require(this.ctx.attached_deposit_yocto === 1n, "Requires attached deposit of exactly 1 yoctoNEAR");
  }
  private emit(standard: string, version: string, event: string, data: unknown): void {
    this.ctx.logs.push(`EVENT_JSON:${JSON.stringify({ standard, version, event, data: [toJsonValue(data)] })}`);
  }
  private paron(event: string, data: unknown): void {
    this.emit("paron", "2.0.0", event, data);
  }

  // ============================================================================================
  // lib.rs — init, USDC ledger, admin, views
  // ============================================================================================

  m_new(args: Record<string, unknown>): null {
    const pk = parseTeeKey(str(args.tee_signer_pubkey, "tee_signer_pubkey"));
    this.state = {
      owner_id: str(args.owner_id, "owner_id"),
      usdc_token_id: (args.usdc_token_id as string | undefined) ?? "usdc.fakes.testnet",
      tee_signer_pubkey_hex: bytesToHex(pk),
      series_ids: [],
      series: {},
      mt_balances: {},
      mt_supply: {},
      long_positions: {},
      usdc_balances: {},
      books: {},
      vaults: {},
      vault_index: {},
      series_vaults: {},
      guardrails: {},
      guardrail_delegations: {},
      redemptions: {},
      provider_stats: {},
      used_quote_hashes: {},
      cash_receipts: [],
      liquidation_receipts: [],
      next_order_id: 1,
      next_vault_id: 1,
      next_request_id: 1,
      insurance_pool_micros: 0n,
      genesis_credit_outstanding_micros: 0n,
      total_deposited_micros: 0n,
      total_withdrawn_micros: 0n,
      sla: {
        max_sla_latency_ms: M.DEFAULT_MAX_SLA_LATENCY_MS,
        ack_window_ms: M.DEFAULT_ACK_WINDOW_MS,
        delivery_window_ms: M.DEFAULT_DELIVERY_WINDOW_MS,
      },
    };
    this.seedCanonicalSeries();
    this.paron("protocol_initialized", {
      owner_id: this.state.owner_id,
      usdc_token_id: this.state.usdc_token_id,
      tee_signer_pubkey_hex: this.state.tee_signer_pubkey_hex,
      series: this.state.series_ids,
      genesis_credit_micros: this.state.genesis_credit_outstanding_micros.toString(),
    });
    return null;
  }

  m_ft_on_transfer(args: Record<string, unknown>): bigint {
    const s = this.state;
    require(this.predecessor === s.usdc_token_id, "only the configured USDC token is accepted");
    const sender = str(args.sender_id, "sender_id");
    const amount = big(args.amount, "amount");
    require(amount > 0n, "deposit amount must be positive");
    const msg = typeof args.msg === "string" ? args.msg : "";
    let instruction: DepositInstruction;
    if (msg.trim() === "") instruction = { action: "deposit", beneficiary: null };
    else {
      try {
        instruction = JSON.parse(msg) as DepositInstruction;
      } catch {
        throw new ContractPanic("invalid ft_on_transfer msg");
      }
      require(["deposit", "insurance", "fund_genesis"].includes(instruction.action), "invalid ft_on_transfer msg");
    }
    s.total_deposited_micros += amount;
    if (instruction.action === "deposit") {
      const beneficiary = instruction.beneficiary ?? sender;
      this.creditUsdc(beneficiary, amount);
      this.paron("usdc_deposited", { sender_id: sender, beneficiary, amount_micros: amount.toString() });
    } else if (instruction.action === "insurance") {
      s.insurance_pool_micros += amount;
      this.paron("insurance_funded", { sender_id: sender, amount_micros: amount.toString() });
    } else {
      const applied = M.minBig(amount, s.genesis_credit_outstanding_micros);
      s.genesis_credit_outstanding_micros -= applied;
      this.creditUsdc(sender, amount - applied);
      this.paron("genesis_credit_funded", {
        sender_id: sender,
        applied_micros: applied.toString(),
        outstanding_micros: s.genesis_credit_outstanding_micros.toString(),
      });
    }
    return 0n;
  }

  /** Local mode: the outgoing `ft_transfer` is executed by the runtime's USDC token ledger. */
  m_withdraw_usdc(args: Record<string, unknown>): { account_id: string; amount: bigint } {
    this.assertOneYocto();
    require(this.state.genesis_credit_outstanding_micros === 0n, "withdrawals unlock once the genesis liquidity credit is funded");
    const amount = big(args.amount, "amount");
    require(amount > 0n, "amount must be positive");
    const account = this.predecessor;
    this.debitUsdc(account, amount);
    this.state.total_withdrawn_micros += amount;
    this.paron("usdc_withdrawn", { account_id: account, amount_micros: amount.toString() });
    return { account_id: account, amount };
  }

  m_set_tee_signer_pubkey(args: Record<string, unknown>): null {
    this.assertOneYocto();
    this.assertOwner();
    this.state.tee_signer_pubkey_hex = bytesToHex(parseTeeKey(str(args.tee_signer_pubkey, "tee_signer_pubkey")));
    this.paron("tee_signer_rotated", { tee_signer_pubkey_hex: this.state.tee_signer_pubkey_hex });
    return null;
  }

  m_set_sla_config(args: Record<string, unknown>): null {
    this.assertOneYocto();
    this.assertOwner();
    const sla = {
      max_sla_latency_ms: num(args.max_sla_latency_ms, "max_sla_latency_ms"),
      ack_window_ms: num(args.ack_window_ms, "ack_window_ms"),
      delivery_window_ms: num(args.delivery_window_ms, "delivery_window_ms"),
    };
    require(sla.max_sla_latency_ms > 0 && sla.ack_window_ms > 0 && sla.delivery_window_ms >= sla.ack_window_ms, "invalid SLA config");
    this.state.sla = sla;
    this.paron("sla_config_updated", { sla });
    return null;
  }

  m_get_series(args: Record<string, unknown>): ComputeSeries | null {
    const s = this.state.series[str(args.series_id, "series_id")];
    return s ? this.withLiveOpenInterest(s) : null;
  }
  m_list_series(): ComputeSeries[] {
    return this.state.series_ids.map((id) => this.withLiveOpenInterest(this.state.series[id]));
  }
  m_usdc_balance_of(args: Record<string, unknown>): bigint {
    return this.usdcOf(str(args.account_id, "account_id"));
  }
  m_get_long_position(args: Record<string, unknown>): LongPosition {
    return this.positionOf(str(args.series_id, "series_id"), str(args.account_id, "account_id"));
  }
  m_get_provider_stats(args: Record<string, unknown>): ProviderStats {
    return this.providerStatsOf(str(args.provider_id, "provider_id"));
  }
  m_get_cash_settlement_receipts(args: Record<string, unknown>): CashSettlementReceipt[] {
    const from = (args.from_index as number | undefined) ?? 0;
    const limit = Math.min((args.limit as number | undefined) ?? 50, 100);
    return this.state.cash_receipts.slice(from, from + limit);
  }
  m_get_liquidation_receipts(args: Record<string, unknown>): LiquidationReceipt[] {
    const from = (args.from_index as number | undefined) ?? 0;
    const limit = Math.min((args.limit as number | undefined) ?? 50, 100);
    return this.state.liquidation_receipts.slice(from, from + limit);
  }
  m_protocol_stats(): ProtocolStats {
    const s = this.state;
    return {
      owner_id: s.owner_id,
      usdc_token_id: s.usdc_token_id,
      tee_signer_pubkey_hex: s.tee_signer_pubkey_hex,
      insurance_pool_micros: s.insurance_pool_micros,
      genesis_credit_outstanding_micros: s.genesis_credit_outstanding_micros,
      withdrawals_enabled: s.genesis_credit_outstanding_micros === 0n,
      total_deposited_micros: s.total_deposited_micros,
      total_withdrawn_micros: s.total_withdrawn_micros,
      sla: s.sla,
      series_ids: s.series_ids,
      next_order_id: s.next_order_id,
      next_vault_id: s.next_vault_id,
      next_request_id: s.next_request_id,
      cash_settlements: s.cash_receipts.length,
      liquidations: s.liquidation_receipts.length,
    };
  }
  m_audit_series_invariants(args: Record<string, unknown>): SeriesInvariantReport {
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    const totalSupply = this.state.mt_supply[seriesId] ?? 0n;
    const escrowed = this.mtBalance(seriesId, this.self);
    const circulating = totalSupply - escrowed;
    let open = 0n;
    for (const id of this.vaultIdsOf(seriesId)) open += this.state.vaults[id]?.shorted_cu_scaled ?? 0n;
    const holds = series.is_settled ? circulating === series.settlement_pool_cu && open === 0n : circulating === open;
    return {
      series_id: seriesId,
      total_supply_cu: totalSupply,
      escrowed_in_redemptions_cu: escrowed,
      circulating_cu: circulating,
      open_vault_obligations_cu: open,
      settlement_pool_cu: series.settlement_pool_cu,
      holds,
    };
  }

  // ============================================================================================
  // nep245.rs
  // ============================================================================================

  m_mt_transfer(args: Record<string, unknown>): null {
    this.assertOneYocto();
    require(args.approval === undefined || args.approval === null, "NEP-245 approvals are not supported by this contract");
    this.internalMtTransfer(this.predecessor, str(args.receiver_id, "receiver_id"), str(args.token_id, "token_id"), big(args.amount, "amount"), (args.memo as string) ?? null);
    return null;
  }

  m_mt_batch_transfer(args: Record<string, unknown>): null {
    this.assertOneYocto();
    const approvals = args.approvals as unknown[] | null | undefined;
    require(!approvals || approvals.every((x) => x === null), "NEP-245 approvals are not supported");
    const tokenIds = args.token_ids as string[];
    const amounts = args.amounts as unknown[];
    require(Array.isArray(tokenIds) && tokenIds.length > 0 && tokenIds.length === amounts?.length, "token_ids and amounts length mismatch");
    tokenIds.forEach((t, i) =>
      this.internalMtTransfer(this.predecessor, str(args.receiver_id, "receiver_id"), t, big(amounts[i], "amounts"), (args.memo as string) ?? null),
    );
    return null;
  }

  /**
   * Local mode has no foreign contracts, so the receiver's `mt_on_transfer` promise fails and
   * `mt_resolve_transfer` refunds the full amount — exactly NEAR's semantics for a missing receiver.
   */
  m_mt_transfer_call(args: Record<string, unknown>): bigint[] {
    this.assertOneYocto();
    require(args.approval === undefined || args.approval === null, "NEP-245 approvals are not supported by this contract");
    const sender = this.predecessor;
    const receiver = str(args.receiver_id, "receiver_id");
    const token = str(args.token_id, "token_id");
    const amount = big(args.amount, "amount");
    this.internalMtTransfer(sender, receiver, token, amount, (args.memo as string) ?? null);
    const refund = M.minBig(amount, this.mtBalance(token, receiver));
    if (refund > 0n) {
      this.moveTokens(token, receiver, sender, refund);
      this.positionMove(token, receiver, sender, refund);
      this.emit("nep245", "1.0.0", "mt_transfer", { old_owner_id: receiver, new_owner_id: sender, token_ids: [token], amounts: [refund.toString()], memo: "refund" });
    }
    return [amount - refund];
  }

  m_mt_balance_of(args: Record<string, unknown>): bigint {
    return this.mtBalance(str(args.token_id, "token_id"), str(args.account_id, "account_id"));
  }
  m_mt_batch_balance_of(args: Record<string, unknown>): bigint[] {
    return (args.token_ids as string[]).map((t) => this.mtBalance(t, str(args.account_id, "account_id")));
  }
  m_mt_supply(args: Record<string, unknown>): bigint | null {
    return this.state.mt_supply[str(args.token_id, "token_id")] ?? null;
  }
  m_mt_batch_supply(args: Record<string, unknown>): Array<bigint | null> {
    return (args.token_ids as string[]).map((t) => this.state.mt_supply[t] ?? null);
  }
  m_mt_token(args: Record<string, unknown>): Array<{ token_id: string; owner_id: null } | null> {
    return (args.token_ids as string[]).map((t) => (this.state.series[t] ? { token_id: t, owner_id: null } : null));
  }
  m_convert_hardware_to_cu(args: Record<string, unknown>): bigint {
    const tier = str(args.gpu_tier, "gpu_tier") as GpuTier;
    require(tier in M.GPU_WEIGHT_BPS, "unknown variant for `gpu_tier`");
    return M.hardwareToCuScaled(tier, big(args.hours_scaled, "hours_scaled"));
  }

  // ============================================================================================
  // guardrails.rs
  // ============================================================================================

  m_delegate_guardrail_owner(args: Record<string, unknown>): null {
    this.assertOneYocto();
    const owner = str(args.owner_id, "owner_id");
    this.state.guardrail_delegations[this.predecessor] = owner;
    this.paron("guardrail_owner_delegated", { agent_id: this.predecessor, owner_id: owner });
    return null;
  }

  m_configure_agent_guardrail(args: Record<string, unknown>): AgentGuardrailPolicy {
    this.assertOneYocto();
    const caller = this.predecessor;
    const agentId = str(args.agent_id, "agent_id");
    const existing = this.state.guardrails[agentId];
    if (existing) require(existing.owner_id === caller, "only the policy owner may reconfigure this agent");
    else
      require(
        caller === agentId || isSubAccount(agentId, caller) || this.state.guardrail_delegations[agentId] === caller,
        "caller is not authorised to govern this agent (must be parent account, self, or delegated owner)",
      );
    const maxDaily = big(args.max_daily_spend_micros, "max_daily_spend_micros");
    const slippage = num(args.max_slippage_bps, "max_slippage_bps");
    require(maxDaily > 0n, "max_daily_spend_micros must be positive");
    require(slippage <= M.MAX_SLIPPAGE_BPS, "max_slippage_bps exceeds protocol ceiling (2000)");
    const allowed = ((args.allowed_series as string[] | null | undefined) ?? []).slice();
    for (const id of allowed) require(Boolean(this.state.series[id]), `unknown series ${id}`);
    const today = Math.floor(this.now / M.MS_PER_DAY);
    const policy: AgentGuardrailPolicy = {
      agent_id: agentId,
      owner_id: caller,
      max_daily_spend_micros: maxDaily,
      spent_today_micros: existing?.spent_today_micros ?? 0n,
      last_reset_day: existing?.last_reset_day ?? today,
      max_slippage_bps: slippage,
      allowed_series: allowed,
      paused: existing?.paused ?? false,
      lifetime_spend_micros: existing?.lifetime_spend_micros ?? 0n,
    };
    this.state.guardrails[agentId] = policy;
    this.paron("guardrail_configured", { policy });
    return policy;
  }

  m_set_agent_paused(args: Record<string, unknown>): null {
    this.assertOneYocto();
    const agentId = str(args.agent_id, "agent_id");
    const policy = this.state.guardrails[agentId];
    require(Boolean(policy), "no guardrail policy for agent");
    require(policy.owner_id === this.predecessor, "only the policy owner may pause this agent");
    policy.paused = Boolean(args.paused);
    this.paron("guardrail_paused", { agent_id: agentId, paused: policy.paused });
    return null;
  }

  m_get_agent_guardrail(args: Record<string, unknown>): AgentGuardrailPolicy | null {
    const p = this.state.guardrails[str(args.agent_id, "agent_id")];
    if (!p) return null;
    const copy = { ...p, allowed_series: [...p.allowed_series] };
    const today = Math.floor(this.now / M.MS_PER_DAY);
    if (today > copy.last_reset_day) {
      copy.spent_today_micros = 0n;
      copy.last_reset_day = today;
    }
    return copy;
  }

  m_agent_remaining_allowance(args: Record<string, unknown>): bigint {
    const p = this.m_get_agent_guardrail(args);
    return p ? M.saturatingSub(p.max_daily_spend_micros, p.spent_today_micros) : 0n;
  }

  private assertAgentPolicyCompliant(agentId: string, series: ComputeSeries, spend: bigint, guard: PriceGuard, requirePolicy: boolean): void {
    const policy = this.state.guardrails[agentId];
    if (!policy) {
      require(!requirePolicy, "no AgentGuardrailPolicy registered for this agent");
      return;
    }
    require(!policy.paused, "agent is paused by its guardrail owner");
    if (policy.allowed_series.length > 0) require(policy.allowed_series.includes(series.series_id), "series not allowed by agent policy");
    const today = Math.floor(this.now / M.MS_PER_DAY);
    if (today > policy.last_reset_day) {
      policy.spent_today_micros = 0n;
      policy.last_reset_day = today;
    }
    const twap = series.index_twap_usdc_micros;
    const slippage = BigInt(policy.max_slippage_bps);
    if (guard.kind === "BuyAtMost") {
      const ceiling = (twap * (M.BPS + slippage)) / M.BPS;
      require(guard.price <= ceiling, `slippage guard: max price ${guard.price} exceeds TWAP band ceiling ${ceiling}`);
    } else if (guard.kind === "SellAtLeast") {
      const floor = (twap * (M.BPS - slippage)) / M.BPS;
      require(guard.price >= floor, `slippage guard: price ${guard.price} below TWAP band floor ${floor}`);
    }
    const spent = policy.spent_today_micros + spend;
    require(spent <= policy.max_daily_spend_micros, `daily spend cap exceeded: ${policy.spent_today_micros} + ${spend} > ${policy.max_daily_spend_micros}`);
    policy.spent_today_micros = spent;
    policy.lifetime_spend_micros += spend;
  }

  // ============================================================================================
  // margin.rs
  // ============================================================================================

  m_open_short_supply(args: Record<string, unknown>): ShortSupplyOutcome {
    const provider = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    this.assertTradable(series);
    const qty = big(args.cu_amount_scaled, "cu_amount_scaled");
    const price = big(args.ask_price_micros, "ask_price_micros");
    const deposit = big(args.margin_deposit_micros, "margin_deposit_micros");
    validateOrderParams(qty, price);
    this.assertAgentPolicyCompliant(provider, series, deposit, { kind: "SellAtLeast", price }, false);
    this.debitUsdc(provider, deposit);
    const mark = series.index_twap_usdc_micros;
    const vault = this.loadOrCreateVault(provider, seriesId);
    vault.locked_collateral_micros += deposit;
    const book = this.bookOf(seriesId);
    const sell = matchAgainstBids(book, provider, qty, price);
    for (const fill of sell.fills) {
      vault.shorted_cu_scaled += fill.cu_scaled;
      vault.escrowed_proceeds_micros += fill.notional_micros;
      this.internalMint(seriesId, fill.maker_id, fill.cu_scaled, "bid filled by short supply");
      this.positionAdd(seriesId, fill.maker_id, fill.cu_scaled, fill.notional_micros);
    }
    for (const [account, refund] of sell.refunds) this.creditUsdc(account, refund);
    const remaining = qty - sell.filled;
    let restingOrderId: number | null = null;
    if (remaining > 0n) {
      assertNoSelfCross(book, "Ask", price);
      require(book.asks.length < M.MAX_ORDERS_PER_SIDE, "ask side of the book is full");
      const orderId = this.takeOrderId();
      vault.listed_cu_scaled += remaining;
      vault.listed_notional_micros += M.notional(remaining, price);
      insertOrder(book, {
        order_id: orderId,
        owner_id: provider,
        side: "Ask",
        price_micros: price,
        original_cu_scaled: remaining,
        remaining_cu_scaled: remaining,
        escrow_micros: 0n,
        vault_id: vault.vault_id,
        created_at_ms: this.now,
      });
      restingOrderId = orderId;
    }
    M.refreshEntryPrice(vault);
    const required = M.requiredInitialMargin(vault, mark);
    const [equity] = M.vaultEquity(vault, mark);
    require(equity >= required, `insufficient initial margin: 25% requirement is ${required} micros, vault equity is ${equity}`);
    const last = sell.fills[sell.fills.length - 1];
    if (last) series.mark_price_usdc_micros = last.price_micros;
    series.total_volume_cu += sell.filled;
    this.saveVault(vault);
    this.state.books[seriesId] = book;
    this.saveSeries(series);
    const trade = tradeReport(seriesId, provider, "Ask", qty, sell.fills, restingOrderId, []);
    this.paron("short_supply_opened", {
      provider,
      series_id: seriesId,
      vault_id: vault.vault_id,
      cu_amount_scaled: qty.toString(),
      ask_price_micros: price.toString(),
      margin_deposit_micros: deposit.toString(),
      required_initial_margin_micros: required.toString(),
      filled_cu_scaled: sell.filled.toString(),
      resting_order_id: restingOrderId,
    });
    return { vault_id: vault.vault_id, trade, margin_deposit_micros: deposit, required_initial_margin_micros: required, vault_equity_micros: equity };
  }

  m_top_up_margin(args: Record<string, unknown>): VaultHealth {
    const provider = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    require(!series.is_settled, "series already settled");
    const amount = big(args.amount_micros, "amount_micros");
    require(amount > 0n, "amount must be positive");
    const vaultId = this.findVaultId(provider, seriesId);
    require(vaultId !== undefined, "no margin vault for caller in this series");
    const vault = this.vaultOrPanic(vaultId);
    require(vault.status === "Active", "vault is not active");
    this.assertAgentPolicyCompliant(provider, series, amount, NO_GUARD, false);
    this.debitUsdc(provider, amount);
    vault.locked_collateral_micros += amount;
    const health = M.vaultHealth(vault, series.index_twap_usdc_micros);
    this.saveVault(vault);
    this.paron("margin_topped_up", { vault_id: vaultId, provider, amount_micros: amount.toString() });
    return health;
  }

  m_withdraw_excess_margin(args: Record<string, unknown>): VaultHealth {
    const provider = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    const vaultId = this.findVaultId(provider, seriesId);
    require(vaultId !== undefined, "no margin vault for caller in this series");
    const vault = this.vaultOrPanic(vaultId);
    require(vault.status === "Active", "vault is not active");
    const amount = big(args.amount_micros, "amount_micros");
    require(amount > 0n && amount <= vault.locked_collateral_micros, "invalid withdrawal amount");
    vault.locked_collateral_micros -= amount;
    const mark = series.index_twap_usdc_micros;
    require(M.meetsInitialMargin(vault, mark), "withdrawal would breach the 25% initial margin requirement");
    this.creditUsdc(provider, amount);
    const health = M.vaultHealth(vault, mark);
    this.saveVault(vault);
    this.paron("margin_withdrawn", { vault_id: vaultId, provider, amount_micros: amount.toString() });
    return health;
  }

  m_liquidate_underwater_vault(args: Record<string, unknown>): LiquidationReceipt {
    const liquidator = this.predecessor;
    const vaultId = num(args.vault_id, "vault_id");
    const vault = this.vaultOrPanic(vaultId);
    const seriesId = vault.series_id;
    const series = this.seriesOrPanic(seriesId);
    this.assertTradable(series);
    require(liquidator !== vault.provider, "providers cannot self-liquidate; top up margin instead");
    const mark = series.index_twap_usdc_micros;
    const hb = M.healthBps(vault, mark);
    require(M.isLiquidatable(vault, mark), `vault ${vaultId} is not liquidatable: health ${hb ?? 340282366920938463463374607431768211455n} bps vs 1500 bps maintenance`);
    const healthBefore = Number(hb ?? 0n);
    const entryBefore = vault.entry_price_micros;
    const q = vault.shorted_cu_scaled;
    const escrow = vault.escrowed_proceeds_micros;
    const collateral = vault.locked_collateral_micros;
    const obligation = M.notional(q, mark);
    const loss = M.saturatingSub(obligation, escrow);
    const variation = M.minBig(loss, collateral);
    const shortfall = loss - variation;
    const insuranceCover = M.minBig(shortfall, this.state.insurance_pool_micros);
    this.state.insurance_pool_micros -= insuranceCover;
    const uncovered = shortfall - insuranceCover;
    const remaining = collateral - variation;
    const bonus = M.minBig(remaining, M.applyBps(obligation, M.LIQUIDATION_BONUS_BPS));
    const providerRefund = remaining - bonus;
    const rehedgeMargin = M.applyBps(obligation, M.INITIAL_MARGIN_BPS);
    this.assertAgentPolicyCompliant(liquidator, series, rehedgeMargin, NO_GUARD, false);
    this.debitUsdc(liquidator, rehedgeMargin);
    const book = this.bookOf(seriesId);
    removeVaultAsks(book, vaultId);
    const absorbing = this.loadOrCreateVault(liquidator, seriesId);
    absorbing.shorted_cu_scaled += q;
    absorbing.escrowed_proceeds_micros += escrow + variation + insuranceCover;
    absorbing.locked_collateral_micros += rehedgeMargin;
    M.refreshEntryPrice(absorbing);
    require(M.meetsInitialMargin(absorbing, mark), "liquidator vault would breach initial margin after absorbing the position; top up first");
    const provider = vault.provider;
    vault.shorted_cu_scaled = 0n;
    vault.escrowed_proceeds_micros = 0n;
    vault.locked_collateral_micros = 0n;
    vault.listed_cu_scaled = 0n;
    vault.listed_notional_micros = 0n;
    vault.status = "Liquidated";
    this.creditUsdc(provider, providerRefund);
    this.creditUsdc(liquidator, bonus);
    this.saveVault(vault);
    this.saveVault(absorbing);
    this.state.books[seriesId] = book;
    const receipt: LiquidationReceipt = {
      receipt_id: this.state.liquidation_receipts.length,
      vault_id: vaultId,
      series_id: seriesId,
      provider,
      liquidator,
      liquidator_vault_id: absorbing.vault_id,
      cu_transferred_scaled: q,
      mark_price_micros: mark,
      entry_price_before_micros: entryBefore,
      health_bps_before: healthBefore,
      realized_loss_micros: loss,
      variation_from_collateral_micros: variation,
      insurance_cover_micros: insuranceCover,
      uncovered_shortfall_micros: uncovered,
      liquidator_bonus_micros: bonus,
      provider_refund_micros: providerRefund,
      rehedge_margin_micros: rehedgeMargin,
      liquidated_at_ms: this.now,
    };
    this.state.liquidation_receipts.push(receipt);
    this.paron("vault_liquidated", { receipt });
    return receipt;
  }

  m_check_vault_health(args: Record<string, unknown>): VaultHealth {
    const vault = this.vaultOrPanic(num(args.vault_id, "vault_id"));
    return M.vaultHealth(vault, this.seriesOrPanic(vault.series_id).index_twap_usdc_micros);
  }
  m_get_vault(args: Record<string, unknown>): ShortMarginVault | null {
    return this.state.vaults[num(args.vault_id, "vault_id")] ?? null;
  }
  m_get_vault_by_provider(args: Record<string, unknown>): ShortMarginVault | null {
    const id = this.findVaultId(str(args.provider_id, "provider_id"), str(args.series_id, "series_id"));
    return id === undefined ? null : this.state.vaults[id] ?? null;
  }
  m_list_vaults(args: Record<string, unknown>): ShortMarginVault[] {
    return this.vaultIdsOf(str(args.series_id, "series_id")).map((id) => this.state.vaults[id]).filter(Boolean);
  }
  m_list_vault_health(args: Record<string, unknown>): VaultHealth[] {
    const seriesId = str(args.series_id, "series_id");
    const mark = this.seriesOrPanic(seriesId).index_twap_usdc_micros;
    return this.vaultIdsOf(seriesId)
      .map((id) => this.state.vaults[id])
      .filter((v) => v && v.status === "Active")
      .map((v) => M.vaultHealth(v, mark));
  }
  m_quote_initial_margin(args: Record<string, unknown>): bigint {
    return M.applyBps(M.notional(big(args.cu_amount_scaled, "cu_amount_scaled"), big(args.price_micros, "price_micros")), M.INITIAL_MARGIN_BPS);
  }

  // ============================================================================================
  // orderbook.rs
  // ============================================================================================

  m_agent_buy_forward(args: Record<string, unknown>): TradeReport {
    const agent = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    this.assertTradable(series);
    const qty = big(args.cu_amount_scaled, "cu_amount_scaled");
    const maxPrice = big(args.max_price_micros, "max_price_micros");
    validateOrderParams(qty, maxPrice);
    this.assertAgentPolicyCompliant(agent, series, 0n, { kind: "BuyAtMost", price: maxPrice }, true);
    const book = this.bookOf(seriesId);
    const matched = this.matchAgainstAsks(book, agent, qty, maxPrice, series.index_twap_usdc_micros);
    require(matched.filled > 0n, "no ask liquidity within the limit price");
    this.assertAgentPolicyCompliant(agent, series, matched.notional, NO_GUARD, true);
    this.debitUsdc(agent, matched.notional);
    const report = tradeReport(seriesId, agent, "Bid", qty, matched.fills, null, [...matched.stale_cancelled]);
    this.commitBuy(series, agent, matched);
    this.state.books[seriesId] = book;
    this.saveSeries(series);
    this.paron("forward_bought", { trade: report, guardrailed: true });
    return report;
  }

  m_place_bid(args: Record<string, unknown>): TradeReport {
    const bidder = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    this.assertTradable(series);
    const qty = big(args.cu_amount_scaled, "cu_amount_scaled");
    const price = big(args.price_micros, "price_micros");
    validateOrderParams(qty, price);
    this.assertAgentPolicyCompliant(bidder, series, 0n, { kind: "BuyAtMost", price }, false);
    const book = this.bookOf(seriesId);
    const matched = this.matchAgainstAsks(book, bidder, qty, price, series.index_twap_usdc_micros);
    const remaining = qty - matched.filled;
    const restingEscrow = M.notional(remaining, price);
    const totalDebit = matched.notional + restingEscrow;
    this.assertAgentPolicyCompliant(bidder, series, totalDebit, NO_GUARD, false);
    this.debitUsdc(bidder, totalDebit);
    let restingOrderId: number | null = null;
    if (remaining > 0n) {
      assertNoSelfCross(book, "Bid", price);
      require(book.bids.length < M.MAX_ORDERS_PER_SIDE, "bid side of the book is full");
      const orderId = this.takeOrderId();
      insertOrder(book, {
        order_id: orderId,
        owner_id: bidder,
        side: "Bid",
        price_micros: price,
        original_cu_scaled: remaining,
        remaining_cu_scaled: remaining,
        escrow_micros: restingEscrow,
        vault_id: null,
        created_at_ms: this.now,
      });
      restingOrderId = orderId;
    }
    const report = tradeReport(seriesId, bidder, "Bid", qty, matched.fills, restingOrderId, [...matched.stale_cancelled]);
    if (matched.filled > 0n) this.commitBuy(series, bidder, matched);
    else for (const v of matched.vaults.values()) this.saveVault(v);
    this.state.books[seriesId] = book;
    this.saveSeries(series);
    this.paron("bid_placed", { trade: report });
    return report;
  }

  m_sell_forward(args: Record<string, unknown>): TradeReport {
    const seller = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    this.assertTradable(series);
    const qty = big(args.cu_amount_scaled, "cu_amount_scaled");
    const minPrice = big(args.min_price_micros, "min_price_micros");
    validateOrderParams(qty, minPrice);
    require(this.mtBalance(seriesId, seller) >= qty, "insufficient CU balance to sell");
    this.assertAgentPolicyCompliant(seller, series, 0n, { kind: "SellAtLeast", price: minPrice }, false);
    const book = this.bookOf(seriesId);
    const matched = matchAgainstBids(book, seller, qty, minPrice);
    require(matched.filled > 0n, "no bid liquidity at or above the limit price");
    for (const fill of matched.fills) {
      this.moveTokens(seriesId, seller, fill.maker_id, fill.cu_scaled);
      this.positionRemove(seriesId, seller, fill.cu_scaled);
      this.positionAdd(seriesId, fill.maker_id, fill.cu_scaled, fill.notional_micros);
      this.emit("nep245", "1.0.0", "mt_transfer", {
        old_owner_id: seller,
        new_owner_id: fill.maker_id,
        token_ids: [seriesId],
        amounts: [fill.cu_scaled.toString()],
        memo: "sell_forward",
      });
    }
    this.creditUsdc(seller, matched.notional);
    for (const [account, refund] of matched.refunds) this.creditUsdc(account, refund);
    const last = matched.fills[matched.fills.length - 1];
    if (last) series.mark_price_usdc_micros = last.price_micros;
    series.total_volume_cu += matched.filled;
    const report = tradeReport(seriesId, seller, "Ask", qty, matched.fills, null, []);
    this.state.books[seriesId] = book;
    this.saveSeries(series);
    this.paron("forward_sold", { trade: report });
    return report;
  }

  m_cancel_order(args: Record<string, unknown>): Order {
    const caller = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const orderId = num(args.order_id, "order_id");
    const book = this.bookOf(seriesId);
    let order: Order;
    const bidPos = book.bids.findIndex((o) => o.order_id === orderId);
    const askPos = book.asks.findIndex((o) => o.order_id === orderId);
    if (bidPos >= 0) {
      require(book.bids[bidPos].owner_id === caller, "only the order owner may cancel");
      order = book.bids.splice(bidPos, 1)[0];
      this.creditUsdc(caller, order.escrow_micros);
    } else if (askPos >= 0) {
      require(book.asks[askPos].owner_id === caller, "only the order owner may cancel");
      order = book.asks.splice(askPos, 1)[0];
      require(order.vault_id !== null, "ask without vault");
      const vault = this.vaultOrPanic(order.vault_id);
      M.releaseListing(vault, order.remaining_cu_scaled, order.price_micros);
      this.saveVault(vault);
    } else {
      throw new ContractPanic("order not found");
    }
    this.state.books[seriesId] = book;
    this.paron("order_cancelled", { series_id: seriesId, order_id: orderId, owner_id: caller });
    return order;
  }

  m_get_order_book(args: Record<string, unknown>): OrderBookView {
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    const book = this.bookOf(seriesId);
    const depth = (args.depth as number | undefined) ?? 10;
    const levels = (orders: Order[]): PriceLevel[] => {
      const out: PriceLevel[] = [];
      for (const o of orders) {
        const lastLevel = out[out.length - 1];
        if (lastLevel && lastLevel.price_micros === o.price_micros) {
          lastLevel.cu_scaled += o.remaining_cu_scaled;
          lastLevel.orders += 1;
        } else {
          if (out.length === depth) break;
          out.push({ price_micros: o.price_micros, cu_scaled: o.remaining_cu_scaled, orders: 1 });
        }
      }
      return out;
    };
    return {
      series_id: seriesId,
      bids: levels(book.bids),
      asks: levels(book.asks),
      best_bid_micros: book.bids[0]?.price_micros ?? null,
      best_ask_micros: book.asks[0]?.price_micros ?? null,
      index_twap_usdc_micros: series.index_twap_usdc_micros,
    };
  }
  m_get_open_orders(args: Record<string, unknown>): Order[] {
    const book = this.bookOf(str(args.series_id, "series_id"));
    const account = str(args.account_id, "account_id");
    return [...book.bids, ...book.asks].filter((o) => o.owner_id === account);
  }
  m_get_raw_order_book(args: Record<string, unknown>): OrderBook {
    return this.bookOf(str(args.series_id, "series_id"));
  }

  private matchAgainstAsks(book: OrderBook, taker: string, qty: bigint, maxPrice: bigint, mark: bigint): BuyMatch {
    const out: BuyMatch = { fills: [], filled: 0n, notional: 0n, refunds: [], stale_cancelled: [], vaults: new Map() };
    let remaining = qty;
    let i = 0;
    while (remaining > 0n && i < book.asks.length) {
      const ask = book.asks[i];
      const price = ask.price_micros;
      if (price > maxPrice) break;
      if (ask.owner_id === taker) {
        i += 1;
        continue;
      }
      require(ask.vault_id !== null, "ask without backing vault");
      if (!out.vaults.has(ask.vault_id)) out.vaults.set(ask.vault_id, structuredClone(this.vaultOrPanic(ask.vault_id)));
      const vault = out.vaults.get(ask.vault_id)!;
      const fill = M.minBig(remaining, ask.remaining_cu_scaled);
      const cost = M.notional(fill, price);
      const simulated = structuredClone(vault);
      M.applyAskFill(simulated, fill, price, ask.remaining_cu_scaled, cost);
      if (!M.meetsMaintenanceMargin(simulated, mark)) {
        const stale = book.asks.splice(i, 1)[0];
        M.releaseListing(vault, stale.remaining_cu_scaled, stale.price_micros);
        out.stale_cancelled.push(stale.order_id);
        continue;
      }
      Object.assign(vault, simulated);
      out.fills.push({ order_id: ask.order_id, maker_id: ask.owner_id, vault_id: ask.vault_id, price_micros: price, cu_scaled: fill, notional_micros: cost });
      remaining -= fill;
      out.filled += fill;
      out.notional += cost;
      ask.remaining_cu_scaled -= fill;
      if (ask.remaining_cu_scaled === 0n) book.asks.splice(i, 1);
      else i += 1;
    }
    return out;
  }

  /** Cancels resting orders outside the ±5% stale-quote band around a freshly attested index. */
  private purgeOffBandOrders(seriesId: string, index: bigint): number[] {
    const book = this.bookOf(seriesId);
    const askFloor = (index * (M.BPS - M.STALE_QUOTE_BAND_BPS)) / M.BPS;
    const bidCeiling = (index * (M.BPS + M.STALE_QUOTE_BAND_BPS)) / M.BPS;
    const purged: number[] = [];
    const staleAsks = book.asks.filter((o) => o.price_micros < askFloor);
    const staleBids = book.bids.filter((o) => o.price_micros > bidCeiling);
    book.asks = book.asks.filter((o) => o.price_micros >= askFloor);
    book.bids = book.bids.filter((o) => o.price_micros <= bidCeiling);
    for (const order of staleAsks) {
      require(order.vault_id !== null, "ask without vault");
      const vault = this.vaultOrPanic(order.vault_id);
      M.releaseListing(vault, order.remaining_cu_scaled, order.price_micros);
      this.saveVault(vault);
      purged.push(order.order_id);
    }
    for (const order of staleBids) {
      this.creditUsdc(order.owner_id, order.escrow_micros);
      purged.push(order.order_id);
    }
    if (purged.length > 0) {
      this.state.books[seriesId] = book;
      this.paron("stale_quotes_purged", { series_id: seriesId, index_micros: index.toString(), order_ids: purged });
    }
    return purged;
  }

  private commitBuy(series: ComputeSeries, buyer: string, matched: BuyMatch): void {
    for (const v of matched.vaults.values()) this.saveVault(v);
    this.internalMint(series.series_id, buyer, matched.filled, "forward fill");
    this.positionAdd(series.series_id, buyer, matched.filled, matched.notional);
    const last = matched.fills[matched.fills.length - 1];
    if (last) series.mark_price_usdc_micros = last.price_micros;
    series.total_volume_cu += matched.filled;
  }

  // ============================================================================================
  // settlement.rs
  // ============================================================================================

  m_submit_outlayer_index_attestation(args: Record<string, unknown>): AttestationOutcome {
    const seriesId = str(args.series_id, "series_id");
    const series = this.seriesOrPanic(seriesId);
    require(!series.is_settled, "series already settled");
    const twap = big(args.twap_micros, "twap_micros");
    const observedAt = num(args.observed_at_ms, "observed_at_ms");
    const hash = str(args.tdx_quote_hash, "tdx_quote_hash");
    const sig = str(args.signature_hex, "signature_hex");
    require(twap > 0n && twap <= M.MAX_PRICE_MICROS, "attested TWAP out of range");
    require(observedAt <= this.now + M.MAX_ATTESTATION_CLOCK_SKEW_MS, "attestation observed in the future");
    require(this.now <= observedAt + M.MAX_ATTESTATION_AGE_MS, "attestation is stale (older than 1 hour)");
    require(observedAt > series.index_observed_at_ms, "attestation is older than the current index");
    this.verifyTeeSignature(indexAttestationMessage(seriesId, twap, observedAt, hash), sig);
    this.consumeQuoteHash(hash);
    const previous = series.index_twap_usdc_micros;
    require(M.absDiff(twap, previous) <= M.applyBps(previous, M.MAX_INDEX_MOVE_BPS), "circuit breaker: attested index moved more than 100% in one update");
    series.index_twap_usdc_micros = twap;
    series.index_updated_at_ms = this.now;
    series.index_observed_at_ms = observedAt;
    series.last_tee_attestation_hash = hash;
    const purged = this.purgeOffBandOrders(seriesId, twap);
    const flagged = this.vaultIdsOf(seriesId).filter((id) => {
      const v = this.state.vaults[id];
      return v ? M.isLiquidatable(v, twap) : false;
    });
    this.saveSeries(series);
    this.paron("index_attested", {
      series_id: seriesId,
      previous_twap_micros: previous.toString(),
      twap_micros: twap.toString(),
      observed_at_ms: observedAt,
      tdx_quote_hash: hash,
      flagged_vaults: flagged,
      purged_orders: purged,
    });
    for (const id of flagged) this.paron("flag_liquidation_eligible", { series_id: seriesId, vault_id: id });
    return { series_id: seriesId, previous_twap_micros: previous, twap_micros: twap, tdx_quote_hash: hash, flagged_vaults: flagged, purged_orders: purged };
  }

  m_finalize_series_settlement(args: Record<string, unknown>): ComputeSeries {
    const seriesId = str(args.series_id, "series_id");
    this.internalFinalizeSeries(seriesId);
    return this.withLiveOpenInterest(this.state.series[seriesId]);
  }

  m_settle_cash_hedge(args: Record<string, unknown>): CashSettlementReceipt {
    const account = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const qty = big(args.cu_amount_scaled, "cu_amount_scaled");
    require(qty > 0n, "amount must be positive");
    this.internalFinalizeSeries(seriesId);
    const series = this.seriesOrPanic(seriesId);
    const finalPrice = series.final_settlement_price_micros!;
    const pool = series.settlement_pool_micros;
    const poolCu = series.settlement_pool_cu;
    require(qty <= poolCu, "amount exceeds the settleable supply");
    this.internalBurn(seriesId, account, qty, "mode-a cash settlement");
    const costBasis = this.positionRemove(seriesId, account, qty);
    const fullValue = M.notional(qty, finalPrice);
    const payout = pool >= M.notional(poolCu, finalPrice) ? M.minBig(fullValue, pool) : (pool * qty) / poolCu;
    series.settlement_pool_micros = pool - payout;
    series.settlement_pool_cu = poolCu - qty;
    this.creditUsdc(account, payout);
    const receipt: CashSettlementReceipt = {
      receipt_id: this.state.cash_receipts.length,
      series_id: seriesId,
      account_id: account,
      cu_amount_scaled: qty,
      avg_entry_price_micros: (costBasis * M.CU_SCALE) / qty,
      cost_basis_micros: costBasis,
      index_price_micros: finalPrice,
      payout_micros: payout,
      hedge_pnl_micros: M.signedString(payout, costBasis),
      tdx_quote_hash: series.last_tee_attestation_hash,
      state: { CashSettledAtMaturity: { settled_at_ms: this.now, index_price_micros: finalPrice, payout_micros: payout } },
    };
    this.state.cash_receipts.push(receipt);
    this.saveSeries(series);
    this.paron("cash_settled", { receipt });
    return receipt;
  }

  m_request_compute_redemption(args: Record<string, unknown>): number {
    const agent = this.predecessor;
    const seriesId = str(args.series_id, "series_id");
    const providerId = str(args.provider_id, "provider_id");
    const series = this.seriesOrPanic(seriesId);
    this.assertTradable(series);
    const qty = big(args.cu_amount_scaled, "cu_amount_scaled");
    require(qty >= M.MIN_ORDER_CU_SCALED, "minimum redemption is 1.00 CU");
    require(agent !== providerId, "cannot redeem against yourself");
    this.assertAgentPolicyCompliant(agent, series, 0n, NO_GUARD, false);
    const vaultId = this.findVaultId(providerId, seriesId);
    require(vaultId !== undefined, "provider has no margin vault in this series");
    const vault = this.vaultOrPanic(vaultId);
    require(vault.status === "Active" && vault.shorted_cu_scaled >= qty, "provider has insufficient open supply in this series");
    this.moveTokens(seriesId, agent, this.self, qty);
    this.emit("nep245", "1.0.0", "mt_transfer", {
      old_owner_id: agent,
      new_owner_id: this.self,
      token_ids: [seriesId],
      amounts: [qty.toString()],
      memo: "mode-b redemption escrow",
    });
    const costBasis = this.positionRemove(seriesId, agent, qty);
    const strike = (vault.escrowed_proceeds_micros * qty) / vault.shorted_cu_scaled;
    const collateral = M.minBig(M.applyBps(strike, M.INITIAL_MARGIN_BPS), vault.locked_collateral_micros);
    vault.shorted_cu_scaled -= qty;
    vault.escrowed_proceeds_micros -= strike;
    vault.locked_collateral_micros -= collateral;
    this.saveVault(vault);
    const requestId = this.state.next_request_id++;
    const state: RedemptionState = { Requested: { requested_at_ms: this.now, ack_deadline_ms: this.now + this.state.sla.ack_window_ms } };
    const request: RedemptionRequest = {
      request_id: requestId,
      series_id: seriesId,
      agent_id: agent,
      provider_id: providerId,
      vault_id: vaultId,
      cu_amount_scaled: qty,
      strike_payment_micros: strike,
      provider_collateral_micros: collateral,
      agent_cost_basis_micros: costBasis,
      requested_at_ms: this.now,
      ack_deadline_ms: this.now + this.state.sla.ack_window_ms,
      delivery_deadline_ms: this.now + this.state.sla.delivery_window_ms,
      state,
      history: [structuredClone(state)],
    };
    this.paron("redemption_requested", { request });
    this.state.redemptions[requestId] = request;
    return requestId;
  }

  m_acknowledge_redemption(args: Record<string, unknown>): RedemptionRequest {
    const request = this.redemptionOrPanic(num(args.request_id, "request_id"));
    require(this.predecessor === request.provider_id, "only the provider may acknowledge");
    if ("Requested" in request.state) require(this.now <= request.state.Requested.ack_deadline_ms, "acknowledgement deadline has passed");
    else throw new ContractPanic("redemption is not awaiting acknowledgement");
    const state: RedemptionState = { Acknowledged: { ack_at_ms: this.now, delivery_deadline_ms: request.delivery_deadline_ms } };
    request.state = state;
    request.history.push(structuredClone(state));
    this.paron("redemption_acknowledged", { request_id: request.request_id, ack_at_ms: this.now });
    return request;
  }

  m_finalize_redemption_with_tee_receipt(args: Record<string, unknown>): RedemptionRequest {
    const requestId = num(args.request_id, "request_id");
    const request = this.redemptionOrPanic(requestId);
    require(!isFinal(request.state), "redemption already finalized");
    const hash = str(args.tdx_quote_hash, "tdx_quote_hash");
    const latency = num(args.measured_latency_ms, "measured_latency_ms");
    const slaMet = args.sla_met === true;
    this.verifyTeeSignature(executionReceiptMessage(requestId, hash, latency, slaMet), str(args.worker_sig, "worker_sig"));
    this.consumeQuoteHash(hash);
    let breach: string | null = null;
    if ("Requested" in request.state && this.now > request.state.Requested.ack_deadline_ms) breach = "ack_deadline_missed";
    else if (this.now > request.delivery_deadline_ms) breach = "delivery_deadline_missed";
    else if (!slaMet) breach = "tee_receipt_sla_violation";
    else if (latency > this.state.sla.max_sla_latency_ms) breach = "latency_exceeds_sla_ceiling";
    if (breach) this.executeSlaSlash(request, breach);
    else this.executeDelivery(request, hash, latency);
    return request;
  }

  m_claim_sla_breach_slash(args: Record<string, unknown>): RedemptionRequest {
    const request = this.redemptionOrPanic(num(args.request_id, "request_id"));
    require(!isFinal(request.state), "redemption already finalized");
    let reason: string;
    if ("Requested" in request.state && this.now > request.state.Requested.ack_deadline_ms) reason = "ack_deadline_missed";
    else if ("Acknowledged" in request.state && this.now > request.state.Acknowledged.delivery_deadline_ms) reason = "delivery_deadline_missed";
    else throw new ContractPanic("no SLA breach: deadlines have not expired");
    this.executeSlaSlash(request, reason);
    return request;
  }

  m_get_redemption(args: Record<string, unknown>): RedemptionRequest | null {
    return this.state.redemptions[num(args.request_id, "request_id")] ?? null;
  }
  m_get_redemptions(args: Record<string, unknown>): RedemptionRequest[] {
    const from = Math.max((args.from_request_id as number | undefined) ?? 1, 1);
    const limit = Math.min((args.limit as number | undefined) ?? 50, 100);
    const out: RedemptionRequest[] = [];
    for (let id = from; id < Math.min(this.state.next_request_id, from + limit); id++) {
      const r = this.state.redemptions[id];
      if (r) out.push(r);
    }
    return out;
  }

  private internalFinalizeSeries(seriesId: string): void {
    const series = this.seriesOrPanic(seriesId);
    if (series.is_settled) return;
    require(this.now >= series.maturity_timestamp_ms, "series has not matured yet; exit early by selling into the CLOB");
    require(series.index_observed_at_ms >= series.maturity_timestamp_ms, "final settlement requires an OutLayer TWAP attestation observed at or after maturity");
    const finalPrice = series.index_twap_usdc_micros;
    for (const bid of this.bookOf(seriesId).bids) this.creditUsdc(bid.owner_id, bid.escrow_micros);
    this.state.books[seriesId] = { bids: [], asks: [] };
    let pool = 0n;
    let poolCu = 0n;
    for (const vaultId of this.vaultIdsOf(seriesId)) {
      const vault = this.vaultOrPanic(vaultId);
      if (vault.status !== "Active") continue;
      const qty = vault.shorted_cu_scaled;
      const available = vault.escrowed_proceeds_micros + vault.locked_collateral_micros;
      const obligation = M.notional(qty, finalPrice);
      let toPool: bigint;
      let refund: bigint;
      let insuranceCover = 0n;
      if (available >= obligation) {
        toPool = obligation;
        refund = available - obligation;
      } else {
        insuranceCover = M.minBig(obligation - available, this.state.insurance_pool_micros);
        this.state.insurance_pool_micros -= insuranceCover;
        toPool = available + insuranceCover;
        refund = 0n;
      }
      pool += toPool;
      poolCu += qty;
      this.creditUsdc(vault.provider, refund);
      this.paron("vault_settled", {
        vault_id: vaultId,
        provider: vault.provider,
        series_id: seriesId,
        settled_cu_scaled: qty.toString(),
        final_price_micros: finalPrice.toString(),
        obligation_micros: obligation.toString(),
        provider_refund_micros: refund.toString(),
        provider_hedge_pnl_micros: M.signedString(vault.escrowed_proceeds_micros, obligation),
        insurance_cover_micros: insuranceCover.toString(),
      });
      vault.shorted_cu_scaled = 0n;
      vault.escrowed_proceeds_micros = 0n;
      vault.locked_collateral_micros = 0n;
      vault.listed_cu_scaled = 0n;
      vault.listed_notional_micros = 0n;
      vault.status = "Settled";
      this.saveVault(vault);
    }
    series.is_settled = true;
    series.final_settlement_price_micros = finalPrice;
    series.settlement_pool_micros = pool;
    series.settlement_pool_cu = poolCu;
    this.paron("series_settled", {
      series_id: seriesId,
      final_settlement_price_micros: finalPrice.toString(),
      settlement_pool_micros: pool.toString(),
      settlement_pool_cu: poolCu.toString(),
    });
    this.saveSeries(series);
  }

  private executeDelivery(request: RedemptionRequest, hash: string, latencyMs: number): void {
    const qty = request.cu_amount_scaled;
    this.internalBurn(request.series_id, this.self, qty, "mode-b delivered via OutLayer TEE");
    const payment = request.strike_payment_micros + request.provider_collateral_micros;
    this.creditUsdc(request.provider_id, payment);
    const vault = this.state.vaults[request.vault_id];
    if (vault) {
      vault.delivered_cu_scaled += qty;
      vault.delivered_count += 1;
      this.saveVault(vault);
    }
    const stats = this.providerStatsOf(request.provider_id);
    stats.delivered_count += 1;
    stats.delivered_cu_scaled += qty;
    this.saveProviderStats(request.provider_id, stats);
    const state: RedemptionState = { DeliveredViaTee: { delivered_at_ms: this.now, tdx_quote_hash: hash, latency_ms: latencyMs } };
    request.state = state;
    request.history.push(structuredClone(state));
    this.paron("redemption_delivered", {
      request_id: request.request_id,
      provider_id: request.provider_id,
      cu_amount_scaled: qty.toString(),
      provider_payment_micros: payment.toString(),
    });
  }

  private executeSlaSlash(request: RedemptionRequest, reason: string): void {
    const qty = request.cu_amount_scaled;
    this.internalBurn(request.series_id, this.self, qty, "mode-b sla slash");
    const strike = request.strike_payment_micros;
    const collateral = request.provider_collateral_micros;
    const penaltyTarget = M.applyBps(strike, M.SLA_BREACH_PENALTY_BPS);
    const fromCollateral = M.minBig(penaltyTarget, collateral);
    const insuranceCover = M.minBig(penaltyTarget - fromCollateral, this.state.insurance_pool_micros);
    this.state.insurance_pool_micros -= insuranceCover;
    const payout = strike + fromCollateral + insuranceCover;
    this.creditUsdc(request.agent_id, payout);
    this.creditUsdc(request.provider_id, collateral - fromCollateral);
    const vault = this.state.vaults[request.vault_id];
    if (vault) {
      vault.slashed_count += 1;
      this.saveVault(vault);
    }
    const stats = this.providerStatsOf(request.provider_id);
    stats.slashed_count += 1;
    stats.slashed_cu_scaled += qty;
    stats.penalties_paid_micros += fromCollateral;
    this.saveProviderStats(request.provider_id, stats);
    const state: RedemptionState = { SlashedForSlaBreach: { slashed_at_ms: this.now, reason, payout_micros: payout } };
    request.state = state;
    request.history.push(structuredClone(state));
    this.paron("sla_slashed", {
      request_id: request.request_id,
      provider_id: request.provider_id,
      agent_id: request.agent_id,
      reason,
      refund_micros: strike.toString(),
      penalty_micros: (fromCollateral + insuranceCover).toString(),
      payout_micros: payout.toString(),
    });
  }

  // ============================================================================================
  // internal helpers (lib.rs)
  // ============================================================================================

  private seedCanonicalSeries(): void {
    const owner = this.state.owner_id;
    for (const { id, label, maturityMs, strike } of M.CANONICAL_SERIES) {
      this.state.series[id] = {
        series_id: id,
        label,
        maturity_timestamp_ms: maturityMs,
        initial_strike_usdc_micros: strike,
        mark_price_usdc_micros: strike,
        index_twap_usdc_micros: strike,
        index_updated_at_ms: this.now,
        index_observed_at_ms: this.now,
        last_tee_attestation_hash: "",
        total_open_interest_cu: 0n,
        total_volume_cu: 0n,
        is_settled: false,
        final_settlement_price_micros: null,
        settlement_pool_micros: 0n,
        settlement_pool_cu: 0n,
      };
      this.state.series_ids.push(id);
      this.state.mt_supply[id] = 0n;
      const vault = this.loadOrCreateVault(owner, id);
      const book: OrderBook = { bids: [], asks: [] };
      let covered = 0n;
      for (const [offset, size] of M.GENESIS_ASK_LEVELS) {
        const price = strike + offset;
        const n = M.notional(size, price);
        vault.listed_cu_scaled += size;
        vault.listed_notional_micros += n;
        covered += n;
        insertOrder(book, {
          order_id: this.takeOrderId(),
          owner_id: owner,
          side: "Ask",
          price_micros: price,
          original_cu_scaled: size,
          remaining_cu_scaled: size,
          escrow_micros: 0n,
          vault_id: vault.vault_id,
          created_at_ms: this.now,
        });
      }
      vault.locked_collateral_micros = covered;
      let bidEscrow = 0n;
      for (const [offset, size] of M.GENESIS_BID_LEVELS) {
        const price = strike - offset;
        const escrow = M.notional(size, price);
        bidEscrow += escrow;
        insertOrder(book, {
          order_id: this.takeOrderId(),
          owner_id: owner,
          side: "Bid",
          price_micros: price,
          original_cu_scaled: size,
          remaining_cu_scaled: size,
          escrow_micros: escrow,
          vault_id: null,
          created_at_ms: this.now,
        });
      }
      this.state.genesis_credit_outstanding_micros += covered + bidEscrow;
      this.saveVault(vault);
      this.state.books[id] = book;
    }
  }

  private assertOwner(): void {
    require(this.predecessor === this.state.owner_id, "only the protocol owner may call this method");
  }
  private usdcOf(account: string): bigint {
    return this.state.usdc_balances[account] ?? 0n;
  }
  private creditUsdc(account: string, amount: bigint): void {
    if (amount === 0n) return;
    this.state.usdc_balances[account] = this.usdcOf(account) + amount;
  }
  private debitUsdc(account: string, amount: bigint): void {
    if (amount === 0n) return;
    const balance = this.usdcOf(account);
    require(balance >= amount, `insufficient free USDC: ${account} has ${balance} micros, needs ${amount}`);
    this.state.usdc_balances[account] = balance - amount;
  }
  private seriesOrPanic(seriesId: string): ComputeSeries {
    const s = this.state.series[seriesId];
    require(Boolean(s), `unknown series ${seriesId}`);
    return s;
  }
  private assertTradable(series: ComputeSeries): void {
    require(!series.is_settled, "series already settled");
    require(this.now < series.maturity_timestamp_ms, "series has matured: trading and redemptions are closed");
  }
  private withLiveOpenInterest(series: ComputeSeries): ComputeSeries {
    return { ...series, total_open_interest_cu: this.state.mt_supply[series.series_id] ?? 0n };
  }
  private saveSeries(series: ComputeSeries): void {
    series.total_open_interest_cu = this.state.mt_supply[series.series_id] ?? 0n;
    this.state.series[series.series_id] = series;
  }
  private takeOrderId(): number {
    return this.state.next_order_id++;
  }
  private bookOf(seriesId: string): OrderBook {
    return this.state.books[seriesId] ?? { bids: [], asks: [] };
  }
  private vaultIdsOf(seriesId: string): number[] {
    return this.state.series_vaults[seriesId] ?? [];
  }
  private vaultOrPanic(vaultId: number): ShortMarginVault {
    const v = this.state.vaults[vaultId];
    require(Boolean(v), `unknown vault ${vaultId}`);
    return v;
  }
  private findVaultId(provider: string, seriesId: string): number | undefined {
    return this.state.vault_index[key(provider, seriesId)];
  }
  private loadOrCreateVault(provider: string, seriesId: string): ShortMarginVault {
    const existing = this.findVaultId(provider, seriesId);
    if (existing !== undefined) {
      const vault = this.vaultOrPanic(existing);
      if (vault.status !== "Active") vault.status = "Active";
      return vault;
    }
    const ids = this.vaultIdsOf(seriesId);
    require(ids.length < M.MAX_VAULTS_PER_SERIES, "vault capacity for this series reached");
    const vaultId = this.state.next_vault_id++;
    this.state.series_vaults[seriesId] = [...ids, vaultId];
    this.state.vault_index[key(provider, seriesId)] = vaultId;
    const vault: ShortMarginVault = {
      vault_id: vaultId,
      provider,
      series_id: seriesId,
      shorted_cu_scaled: 0n,
      entry_price_micros: 0n,
      locked_collateral_micros: 0n,
      escrowed_proceeds_micros: 0n,
      listed_cu_scaled: 0n,
      listed_notional_micros: 0n,
      delivered_cu_scaled: 0n,
      delivered_count: 0,
      slashed_count: 0,
      status: "Active",
      created_at_ms: this.now,
    };
    this.state.vaults[vaultId] = vault;
    return vault;
  }
  private saveVault(vault: ShortMarginVault): void {
    M.refreshEntryPrice(vault);
    this.state.vaults[vault.vault_id] = vault;
  }
  private providerStatsOf(provider: string): ProviderStats {
    return (
      this.state.provider_stats[provider] ?? {
        delivered_count: 0,
        slashed_count: 0,
        delivered_cu_scaled: 0n,
        slashed_cu_scaled: 0n,
        penalties_paid_micros: 0n,
        reliability_bps: 10_000,
      }
    );
  }
  private saveProviderStats(provider: string, stats: ProviderStats): void {
    const total = stats.delivered_count + stats.slashed_count;
    stats.reliability_bps = total === 0 ? 10_000 : Math.floor((stats.delivered_count * 10_000) / total);
    this.state.provider_stats[provider] = stats;
  }
  private positionOf(seriesId: string, account: string): LongPosition {
    return this.state.long_positions[key(seriesId, account)] ?? { cu_scaled: 0n, cost_basis_micros: 0n, avg_entry_price_micros: 0n };
  }
  private savePosition(seriesId: string, account: string, cuAmount: bigint, cost: bigint): void {
    const k = key(seriesId, account);
    if (cuAmount === 0n) {
      delete this.state.long_positions[k];
      return;
    }
    this.state.long_positions[k] = { cu_scaled: cuAmount, cost_basis_micros: cost, avg_entry_price_micros: (cost * M.CU_SCALE) / cuAmount };
  }
  private positionAdd(seriesId: string, account: string, cuAmount: bigint, cost: bigint): void {
    const p = this.positionOf(seriesId, account);
    this.savePosition(seriesId, account, p.cu_scaled + cuAmount, p.cost_basis_micros + cost);
  }
  private positionRemove(seriesId: string, account: string, cuAmount: bigint): bigint {
    const p = this.positionOf(seriesId, account);
    if (p.cu_scaled === 0n) return 0n;
    const removed = M.minBig(cuAmount, p.cu_scaled);
    const basis = (p.cost_basis_micros * removed) / p.cu_scaled;
    this.savePosition(seriesId, account, p.cu_scaled - removed, p.cost_basis_micros - basis);
    return basis;
  }
  private positionMove(seriesId: string, from: string, to: string, cuAmount: bigint): void {
    const basis = this.positionRemove(seriesId, from, cuAmount);
    this.positionAdd(seriesId, to, cuAmount, basis);
  }
  private mtBalance(token: string, account: string): bigint {
    return this.state.mt_balances[key(token, account)] ?? 0n;
  }
  private setMtBalance(token: string, account: string, value: bigint): void {
    const k = key(token, account);
    if (value === 0n) delete this.state.mt_balances[k];
    else this.state.mt_balances[k] = value;
  }
  private moveTokens(token: string, from: string, to: string, amount: bigint): void {
    const fromBalance = this.mtBalance(token, from);
    require(fromBalance >= amount, `insufficient ${token} balance: ${from} has ${fromBalance}, needs ${amount}`);
    this.setMtBalance(token, from, fromBalance - amount);
    this.setMtBalance(token, to, this.mtBalance(token, to) + amount);
  }
  private internalMtTransfer(sender: string, receiver: string, token: string, amount: bigint, memo: string | null): void {
    require(sender !== receiver, "sender and receiver must differ");
    require(receiver !== this.self, "cannot transfer into the protocol escrow account");
    require(amount > 0n, "amount must be positive");
    require(Boolean(this.state.series[token]), `unknown token_id ${token}`);
    this.moveTokens(token, sender, receiver, amount);
    this.positionMove(token, sender, receiver, amount);
    const data: Record<string, unknown> = { old_owner_id: sender, new_owner_id: receiver, token_ids: [token], amounts: [amount.toString()] };
    if (memo) data.memo = memo;
    this.emit("nep245", "1.0.0", "mt_transfer", data);
  }
  private internalMint(token: string, owner: string, amount: bigint, memo: string): void {
    if (amount === 0n) return;
    this.setMtBalance(token, owner, this.mtBalance(token, owner) + amount);
    this.state.mt_supply[token] = (this.state.mt_supply[token] ?? 0n) + amount;
    this.emit("nep245", "1.0.0", "mt_mint", { owner_id: owner, token_ids: [token], amounts: [amount.toString()], memo });
  }
  private internalBurn(token: string, owner: string, amount: bigint, memo: string): void {
    if (amount === 0n) return;
    const balance = this.mtBalance(token, owner);
    require(balance >= amount, `cannot burn ${amount} ${token}: ${owner} holds ${balance}`);
    this.setMtBalance(token, owner, balance - amount);
    this.state.mt_supply[token] = (this.state.mt_supply[token] ?? 0n) - amount;
    this.emit("nep245", "1.0.0", "mt_burn", { owner_id: owner, token_ids: [token], amounts: [amount.toString()], memo });
  }
  private redemptionOrPanic(requestId: number): RedemptionRequest {
    const r = this.state.redemptions[requestId];
    require(Boolean(r), `unknown redemption request ${requestId}`);
    return r;
  }
  private verifyTeeSignature(message: string, signatureHex: string): void {
    require(/^([0-9a-fA-F]{2})*$/.test(signatureHex), "TEE signature must be hex");
    const sig = hexToBytes(signatureHex.toLowerCase());
    require(sig.length === 64, "TEE signature must be 64 bytes");
    require(verifyEd25519(sig, message, hexToBytes(this.state.tee_signer_pubkey_hex)), "invalid OutLayer TEE signature");
  }
  private consumeQuoteHash(hash: string): void {
    require(isLowerHex64(hash), "tdx_quote_hash must be 64 lowercase hex chars (SHA-256)");
    require(!this.state.used_quote_hashes[hash], "TDX quote hash already consumed (replay)");
    this.state.used_quote_hashes[hash] = true;
  }
}

function parseTeeKey(value: string): Uint8Array {
  try {
    return parseEd25519PublicKey(value);
  } catch {
    throw new ContractPanic("TEE signer key must be ed25519:<base58> or hex");
  }
}

// ---- orderbook.rs free functions -------------------------------------------------------------

export function validateOrderParams(qty: bigint, price: bigint): void {
  require(qty >= M.MIN_ORDER_CU_SCALED, "minimum order size is 1.00 CU (10000 scaled)");
  require(price > 0n && price <= M.MAX_PRICE_MICROS, "price out of range (0, $1000] per CU");
}

export function insertOrder(book: OrderBook, order: Order): void {
  if (order.side === "Ask") {
    const pos = book.asks.findIndex((o) => o.price_micros > order.price_micros);
    book.asks.splice(pos === -1 ? book.asks.length : pos, 0, order);
  } else {
    const pos = book.bids.findIndex((o) => o.price_micros < order.price_micros);
    book.bids.splice(pos === -1 ? book.bids.length : pos, 0, order);
  }
}

export function assertNoSelfCross(book: OrderBook, side: Side, price: bigint): void {
  if (side === "Ask") require(!book.bids[0] || book.bids[0].price_micros < price, "order would cross your own resting bid");
  else require(!book.asks[0] || book.asks[0].price_micros > price, "order would cross your own resting ask");
}

export function removeVaultAsks(book: OrderBook, vaultId: number): Order[] {
  const removed = book.asks.filter((o) => o.vault_id === vaultId);
  book.asks = book.asks.filter((o) => o.vault_id !== vaultId);
  return removed;
}

export function matchAgainstBids(book: OrderBook, taker: string, qty: bigint, minPrice: bigint): SellMatch {
  const out: SellMatch = { fills: [], filled: 0n, notional: 0n, refunds: [] };
  let remaining = qty;
  let i = 0;
  while (remaining > 0n && i < book.bids.length) {
    const bid = book.bids[i];
    if (bid.price_micros < minPrice) break;
    if (bid.owner_id === taker) {
      i += 1;
      continue;
    }
    const fill = M.minBig(remaining, bid.remaining_cu_scaled);
    const cost = M.notional(fill, bid.price_micros);
    bid.remaining_cu_scaled -= fill;
    bid.escrow_micros -= cost;
    out.fills.push({ order_id: bid.order_id, maker_id: bid.owner_id, vault_id: null, price_micros: bid.price_micros, cu_scaled: fill, notional_micros: cost });
    remaining -= fill;
    out.filled += fill;
    out.notional += cost;
    if (bid.remaining_cu_scaled === 0n) {
      const done = book.bids.splice(i, 1)[0];
      if (done.escrow_micros > 0n) out.refunds.push([done.owner_id, done.escrow_micros]);
    } else i += 1;
  }
  return out;
}

export function tradeReport(
  seriesId: string,
  taker: string,
  side: Side,
  requested: bigint,
  fills: FillDetail[],
  restingOrderId: number | null,
  stale: number[],
): TradeReport {
  const filled = fills.reduce((a, f) => a + f.cu_scaled, 0n);
  const total = fills.reduce((a, f) => a + f.notional_micros, 0n);
  return {
    series_id: seriesId,
    taker_id: taker,
    side,
    requested_cu_scaled: requested,
    filled_cu_scaled: filled,
    notional_micros: total,
    avg_price_micros: filled === 0n ? 0n : (total * M.CU_SCALE) / filled,
    fills: fills.map((f) => ({ ...f })),
    resting_order_id: restingOrderId,
    stale_orders_cancelled: stale,
  };
}

/** Quote hash helper for synthetic labels in tests/demos (`sha256(label)` as hex). */
export const labelQuoteHash = (label: string): string => sha256Hex(label);
