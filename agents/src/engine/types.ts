/**
 * TypeScript mirror of `contracts/paron-core/src/types.rs`.
 * `bigint` fields are `U128` on-chain (JSON strings); `number` fields are `u64`/`u32` (JSON numbers).
 */

export type SeriesId = "CU-2026-11" | "CU-2026-12" | "CU-2027-01" | string;
export type GpuTier = "A100" | "H100" | "H200" | "B200" | "GB200";
export type Side = "Bid" | "Ask";
export type VaultStatus = "Active" | "Liquidated" | "Settled";

export interface ComputeSeries {
  series_id: SeriesId;
  label: string;
  maturity_timestamp_ms: number;
  initial_strike_usdc_micros: bigint;
  mark_price_usdc_micros: bigint;
  index_twap_usdc_micros: bigint;
  index_updated_at_ms: number;
  index_observed_at_ms: number;
  last_tee_attestation_hash: string;
  total_open_interest_cu: bigint;
  total_volume_cu: bigint;
  is_settled: boolean;
  final_settlement_price_micros: bigint | null;
  settlement_pool_micros: bigint;
  settlement_pool_cu: bigint;
}

export interface ShortMarginVault {
  vault_id: number;
  provider: string;
  series_id: SeriesId;
  shorted_cu_scaled: bigint;
  entry_price_micros: bigint;
  locked_collateral_micros: bigint;
  escrowed_proceeds_micros: bigint;
  listed_cu_scaled: bigint;
  listed_notional_micros: bigint;
  delivered_cu_scaled: bigint;
  delivered_count: number;
  slashed_count: number;
  status: VaultStatus;
  created_at_ms: number;
}

export interface Order {
  order_id: number;
  owner_id: string;
  side: Side;
  price_micros: bigint;
  original_cu_scaled: bigint;
  remaining_cu_scaled: bigint;
  escrow_micros: bigint;
  vault_id: number | null;
  created_at_ms: number;
}

export interface OrderBook {
  bids: Order[];
  asks: Order[];
}

export interface AgentGuardrailPolicy {
  agent_id: string;
  owner_id: string;
  max_daily_spend_micros: bigint;
  spent_today_micros: bigint;
  last_reset_day: number;
  max_slippage_bps: number;
  allowed_series: SeriesId[];
  paused: boolean;
  lifetime_spend_micros: bigint;
}

export type RedemptionState =
  | { Requested: { requested_at_ms: number; ack_deadline_ms: number } }
  | { Acknowledged: { ack_at_ms: number; delivery_deadline_ms: number } }
  | { DeliveredViaTee: { delivered_at_ms: number; tdx_quote_hash: string; latency_ms: number } }
  | { SlashedForSlaBreach: { slashed_at_ms: number; reason: string; payout_micros: bigint } }
  | { CashSettledAtMaturity: { settled_at_ms: number; index_price_micros: bigint; payout_micros: bigint } };

export interface RedemptionRequest {
  request_id: number;
  series_id: SeriesId;
  agent_id: string;
  provider_id: string;
  vault_id: number;
  cu_amount_scaled: bigint;
  strike_payment_micros: bigint;
  provider_collateral_micros: bigint;
  agent_cost_basis_micros: bigint;
  requested_at_ms: number;
  ack_deadline_ms: number;
  delivery_deadline_ms: number;
  state: RedemptionState;
  history: RedemptionState[];
}

export interface CashSettlementReceipt {
  receipt_id: number;
  series_id: SeriesId;
  account_id: string;
  cu_amount_scaled: bigint;
  avg_entry_price_micros: bigint;
  cost_basis_micros: bigint;
  index_price_micros: bigint;
  payout_micros: bigint;
  hedge_pnl_micros: string;
  tdx_quote_hash: string;
  state: RedemptionState;
}

export interface LiquidationReceipt {
  receipt_id: number;
  vault_id: number;
  series_id: SeriesId;
  provider: string;
  liquidator: string;
  liquidator_vault_id: number;
  cu_transferred_scaled: bigint;
  mark_price_micros: bigint;
  entry_price_before_micros: bigint;
  health_bps_before: number;
  realized_loss_micros: bigint;
  variation_from_collateral_micros: bigint;
  insurance_cover_micros: bigint;
  uncovered_shortfall_micros: bigint;
  liquidator_bonus_micros: bigint;
  provider_refund_micros: bigint;
  rehedge_margin_micros: bigint;
  liquidated_at_ms: number;
}

export interface ProviderStats {
  delivered_count: number;
  slashed_count: number;
  delivered_cu_scaled: bigint;
  slashed_cu_scaled: bigint;
  penalties_paid_micros: bigint;
  reliability_bps: number;
}

export interface LongPosition {
  cu_scaled: bigint;
  cost_basis_micros: bigint;
  avg_entry_price_micros: bigint;
}

export interface SlaConfig {
  max_sla_latency_ms: number;
  ack_window_ms: number;
  delivery_window_ms: number;
}

export interface FillDetail {
  order_id: number;
  maker_id: string;
  vault_id: number | null;
  price_micros: bigint;
  cu_scaled: bigint;
  notional_micros: bigint;
}

export interface TradeReport {
  series_id: SeriesId;
  taker_id: string;
  side: Side;
  requested_cu_scaled: bigint;
  filled_cu_scaled: bigint;
  notional_micros: bigint;
  avg_price_micros: bigint;
  fills: FillDetail[];
  resting_order_id: number | null;
  stale_orders_cancelled: number[];
}

export interface ShortSupplyOutcome {
  vault_id: number;
  trade: TradeReport;
  margin_deposit_micros: bigint;
  required_initial_margin_micros: bigint;
  vault_equity_micros: bigint;
}

export interface AttestationOutcome {
  series_id: SeriesId;
  previous_twap_micros: bigint;
  twap_micros: bigint;
  tdx_quote_hash: string;
  flagged_vaults: number[];
  purged_orders: number[];
}

export interface VaultHealth {
  vault_id: number;
  series_id: SeriesId;
  provider: string;
  mark_price_micros: bigint;
  open_notional_micros: bigint;
  unrealized_loss_micros: bigint;
  equity_micros: bigint;
  deficit_micros: bigint;
  health_bps: number | null;
  required_initial_margin_micros: bigint;
  required_maintenance_margin_micros: bigint;
  excess_collateral_micros: bigint;
  liquidation_price_micros: bigint | null;
  is_liquidatable: boolean;
}

export interface PriceLevel {
  price_micros: bigint;
  cu_scaled: bigint;
  orders: number;
}

export interface OrderBookView {
  series_id: SeriesId;
  bids: PriceLevel[];
  asks: PriceLevel[];
  best_bid_micros: bigint | null;
  best_ask_micros: bigint | null;
  index_twap_usdc_micros: bigint;
}

export interface SeriesInvariantReport {
  series_id: SeriesId;
  total_supply_cu: bigint;
  escrowed_in_redemptions_cu: bigint;
  circulating_cu: bigint;
  open_vault_obligations_cu: bigint;
  settlement_pool_cu: bigint;
  holds: boolean;
}

export interface ProtocolStats {
  owner_id: string;
  usdc_token_id: string;
  tee_signer_pubkey_hex: string;
  insurance_pool_micros: bigint;
  genesis_credit_outstanding_micros: bigint;
  withdrawals_enabled: boolean;
  total_deposited_micros: bigint;
  total_withdrawn_micros: bigint;
  sla: SlaConfig;
  series_ids: SeriesId[];
  next_order_id: number;
  next_vault_id: number;
  next_request_id: number;
  cash_settlements: number;
  liquidations: number;
}
