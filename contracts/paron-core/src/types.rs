//! Shared protocol types, constants and fixed-point math.
//!
//! Units used everywhere in the contract (and mirrored 1:1 by the TypeScript engine
//! in `agents/src/engine`):
//! - **CU amounts** are scaled by `CU_SCALE` (`10_000 = 1.00 CU = 1 hour of NVIDIA H100 SXM 80GB`).
//! - **USDC amounts** are integer micros (`1_000_000 = 1 USDC`, the NEP-141 base unit of USDC on NEAR).
//! - **Prices** are USDC micros per `1.00 CU`.
//! - **Ratios** are basis points (`10_000 bps = 100%`).

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

pub type SeriesId = String;
pub type VaultId = u64;
pub type OrderId = u64;
pub type RequestId = u64;

/// `10_000` scaled units = `1.00 CU`.
pub const CU_SCALE: u128 = 10_000;
/// Basis-point denominator.
pub const BPS: u128 = 10_000;
/// One USDC in micros.
pub const USDC: u128 = 1_000_000;

/// 25% initial margin on short supply (replaces the legacy 150% cash bond).
pub const INITIAL_MARGIN_BPS: u128 = 2_500;
/// 15% maintenance margin; below this a vault is liquidatable.
pub const MAINTENANCE_MARGIN_BPS: u128 = 1_500;
/// 15% SLA breach penalty paid to the agent out of the provider's margin.
pub const SLA_BREACH_PENALTY_BPS: u128 = 1_500;
/// 2.5% of the liquidated notional is paid to the liquidator that re-hedges the position.
pub const LIQUIDATION_BONUS_BPS: u128 = 250;
/// Circuit breaker: a single TEE attestation may not move a series index by more than 100%.
pub const MAX_INDEX_MOVE_BPS: u128 = 10_000;
/// Stale-quote band: on every attestation, asks below `index * 0.95` and bids above `index * 1.05` are
/// purged so slow makers (and the genesis ladder) cannot be picked off after an attested jump.
pub const STALE_QUOTE_BAND_BPS: u128 = 500;
/// Hard ceiling for the per-agent slippage guard.
pub const MAX_SLIPPAGE_BPS: u16 = 2_000;
/// An index attestation must be submitted within 1 hour of the end of its observation window.
pub const MAX_ATTESTATION_AGE_MS: u64 = 60 * 60 * 1_000;
/// Tolerated clock skew between the enclave clock and NEAR block time.
pub const MAX_ATTESTATION_CLOCK_SKEW_MS: u64 = 5 * 60 * 1_000;

pub const MS_PER_DAY: u64 = 86_400_000;
/// Provider must acknowledge a Mode B redemption within 15 minutes.
pub const DEFAULT_ACK_WINDOW_MS: u64 = 15 * 60 * 1_000;
/// Provider must deliver an attested job within 4 hours of the request.
pub const DEFAULT_DELIVERY_WINDOW_MS: u64 = 4 * 60 * 60 * 1_000;
/// Time-to-first-token ceiling enforced on-chain for TEE receipts.
pub const DEFAULT_MAX_SLA_LATENCY_MS: u32 = 500;

/// Minimum order / redemption size: 1.00 CU (bounds state growth).
pub const MIN_ORDER_CU_SCALED: u128 = CU_SCALE;
/// Sanity ceiling on quoted prices: $1,000 per CU.
pub const MAX_PRICE_MICROS: u128 = 1_000 * USDC;
/// Bounded book depth per side (bounds gas of matching and storage).
pub const MAX_ORDERS_PER_SIDE: usize = 64;
/// Bounded number of margin vaults per series (bounds gas of health sweeps and final settlement).
pub const MAX_VAULTS_PER_SERIES: usize = 48;

/// Canonical NEP-245 token ids. Liquidity is never fragmented by city, chip or provider.
pub const SERIES_2026_11: &str = "CU-2026-11";
pub const SERIES_2026_12: &str = "CU-2026-12";
pub const SERIES_2027_01: &str = "CU-2027-01";

/// (series id, label, maturity timestamp ms, initial strike micros)
pub const CANONICAL_SERIES: [(&str, &str, u64, u128); 3] = [
    // 2026-11-30T23:59:59Z
    (SERIES_2026_11, "Front-month forward (Nov 2026)", 1_796_083_199_000, 2_800_000),
    // 2026-12-31T23:59:59Z
    (SERIES_2026_12, "Next-month forward (Dec 2026)", 1_798_761_599_000, 2_950_000),
    // 2027-01-31T23:59:59Z
    (SERIES_2027_01, "Quarter-out forward (Jan 2027)", 1_801_439_999_000, 3_100_000),
];

/// Genesis liquidity ladder posted by the protocol market maker in `new()`:
/// (price offset from strike in micros, size in CU scaled).
pub const GENESIS_ASK_LEVELS: [(u128, u128); 3] =
    [(20_000, 150 * CU_SCALE), (60_000, 250 * CU_SCALE), (120_000, 400 * CU_SCALE)];
pub const GENESIS_BID_LEVELS: [(u128, u128); 3] =
    [(40_000, 150 * CU_SCALE), (80_000, 250 * CU_SCALE), (140_000, 400 * CU_SCALE)];

/// Hardware tiers normalised into canonical CU.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GpuTier {
    A100,
    H100,
    H200,
    B200,
    GB200,
}

impl GpuTier {
    pub const ALL: [GpuTier; 5] = [GpuTier::A100, GpuTier::H100, GpuTier::H200, GpuTier::B200, GpuTier::GB200];

    /// Canonical weight in basis points of one H100 SXM 80GB hour.
    pub const fn weight_bps(self) -> u128 {
        match self {
            GpuTier::A100 => 4_500,
            GpuTier::H100 => 10_000,
            GpuTier::H200 => 14_000,
            GpuTier::B200 => 25_000,
            GpuTier::GB200 => 35_000,
        }
    }
}

/// Pure deterministic conversion: GPU hours (scaled by 1e4) into canonical CU (scaled by 1e4).
pub fn hardware_to_cu_scaled(gpu_tier: GpuTier, hours_scaled: u128) -> u128 {
    hours_scaled * gpu_tier.weight_bps() / BPS
}

/// USDC notional of `cu_scaled` at `price_micros` per CU (floor).
pub fn notional(cu_scaled: u128, price_micros: u128) -> u128 {
    cu_scaled * price_micros / CU_SCALE
}

/// `amount * bps / 10_000` (floor).
pub fn apply_bps(amount: u128, bps: u128) -> u128 {
    amount * bps / BPS
}

/// Signed decimal string helper for PnL fields (JSON-safe for any magnitude).
pub fn signed_string(gain: u128, loss: u128) -> String {
    if gain >= loss {
        (gain - loss).to_string()
    } else {
        format!("-{}", loss - gain)
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ComputeSeries {
    pub series_id: SeriesId,
    pub label: String,
    pub maturity_timestamp_ms: u64,
    pub initial_strike_usdc_micros: U128,
    /// Last traded price on the CLOB.
    pub mark_price_usdc_micros: U128,
    /// Latest OutLayer TEE-attested CRI-H100 TWAP for this maturity (used for margin and settlement).
    pub index_twap_usdc_micros: U128,
    /// Block time at which the current index was submitted.
    pub index_updated_at_ms: u64,
    /// End of the TEE observation window of the current index (signed by the enclave).
    pub index_observed_at_ms: u64,
    /// Hex SHA-256 of the Intel TDX quote that attested the current index.
    pub last_tee_attestation_hash: String,
    /// Outstanding NEP-245 supply (circulating + escrowed in Mode B redemptions).
    pub total_open_interest_cu: U128,
    pub total_volume_cu: U128,
    pub is_settled: bool,
    pub final_settlement_price_micros: Option<U128>,
    /// USDC set aside at final settlement to pay every circulating long token.
    pub settlement_pool_micros: U128,
    /// Circulating long CU still to be paid out of the settlement pool.
    pub settlement_pool_cu: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultStatus {
    Active,
    Liquidated,
    Settled,
}

/// Isolated short-margin vault (one per provider per series).
///
/// `escrowed_proceeds_micros` always equals the strike payments of the open obligation, so the
/// volume-weighted entry price is exactly `escrowed_proceeds * CU_SCALE / shorted_cu`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ShortMarginVault {
    pub vault_id: VaultId,
    pub provider: AccountId,
    pub series_id: SeriesId,
    /// Filled, outstanding short obligation (10_000 = 1.00 CU).
    pub shorted_cu_scaled: U128,
    /// Average short entry price ($/CU in micros).
    pub entry_price_micros: U128,
    /// Margin locked (min 25% initial, 15% maintenance).
    pub locked_collateral_micros: U128,
    /// Buyers' strike payments held against this vault's open obligation.
    pub escrowed_proceeds_micros: U128,
    /// Resting ask quantity backed by this vault.
    pub listed_cu_scaled: U128,
    /// Sum of resting ask notionals backed by this vault.
    pub listed_notional_micros: U128,
    pub delivered_cu_scaled: U128,
    pub delivered_count: u32,
    pub slashed_count: u32,
    pub status: VaultStatus,
    pub created_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Bid,
    Ask,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Order {
    pub order_id: OrderId,
    pub owner_id: AccountId,
    pub side: Side,
    pub price_micros: U128,
    pub original_cu_scaled: U128,
    pub remaining_cu_scaled: U128,
    /// Bids only: USDC still escrowed for the unfilled remainder.
    pub escrow_micros: U128,
    /// Asks only: the margin vault that backs the order.
    pub vault_id: Option<VaultId>,
    pub created_at_ms: u64,
}

/// Price-time priority book: asks ascending, bids descending, FIFO within a price level.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OrderBook {
    pub bids: Vec<Order>,
    pub asks: Vec<Order>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentGuardrailPolicy {
    pub agent_id: AccountId,
    pub owner_id: AccountId,
    pub max_daily_spend_micros: U128,
    pub spent_today_micros: U128,
    /// UTC day epoch (`block_timestamp_ms / 86_400_000`) of the last spend reset.
    pub last_reset_day: u64,
    /// e.g. 150 bps (1.5%) above the OutLayer TWAP.
    pub max_slippage_bps: u16,
    /// Empty = all canonical series allowed.
    pub allowed_series: Vec<SeriesId>,
    pub paused: bool,
    pub lifetime_spend_micros: U128,
}

/// Mode B lifecycle (`Requested -> Acknowledged -> DeliveredViaTee | SlashedForSlaBreach`) and the
/// Mode A cash settlement receipt state.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum RedemptionState {
    Requested { requested_at_ms: u64, ack_deadline_ms: u64 },
    Acknowledged { ack_at_ms: u64, delivery_deadline_ms: u64 },
    DeliveredViaTee { delivered_at_ms: u64, tdx_quote_hash: String, latency_ms: u32 },
    SlashedForSlaBreach { slashed_at_ms: u64, reason: String, payout_micros: U128 },
    CashSettledAtMaturity { settled_at_ms: u64, index_price_micros: U128, payout_micros: U128 },
}

impl RedemptionState {
    pub fn is_final(&self) -> bool {
        matches!(
            self,
            RedemptionState::DeliveredViaTee { .. }
                | RedemptionState::SlashedForSlaBreach { .. }
                | RedemptionState::CashSettledAtMaturity { .. }
        )
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct RedemptionRequest {
    pub request_id: RequestId,
    pub series_id: SeriesId,
    pub agent_id: AccountId,
    pub provider_id: AccountId,
    pub vault_id: VaultId,
    pub cu_amount_scaled: U128,
    /// Strike payment escrowed for this drawdown (released to provider or refunded to agent).
    pub strike_payment_micros: U128,
    /// Provider margin moved into the redemption escrow (25% of the strike payment).
    pub provider_collateral_micros: U128,
    pub agent_cost_basis_micros: U128,
    pub requested_at_ms: u64,
    pub ack_deadline_ms: u64,
    pub delivery_deadline_ms: u64,
    pub state: RedemptionState,
    pub history: Vec<RedemptionState>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct CashSettlementReceipt {
    pub receipt_id: u64,
    pub series_id: SeriesId,
    pub account_id: AccountId,
    pub cu_amount_scaled: U128,
    pub avg_entry_price_micros: U128,
    pub cost_basis_micros: U128,
    pub index_price_micros: U128,
    pub payout_micros: U128,
    /// Exact hedge PnL `Q * (P_index - P_strike)` as a signed decimal string (micros).
    pub hedge_pnl_micros: String,
    pub tdx_quote_hash: String,
    pub state: RedemptionState,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LiquidationReceipt {
    pub receipt_id: u64,
    pub vault_id: VaultId,
    pub series_id: SeriesId,
    pub provider: AccountId,
    pub liquidator: AccountId,
    pub liquidator_vault_id: VaultId,
    pub cu_transferred_scaled: U128,
    pub mark_price_micros: U128,
    pub entry_price_before_micros: U128,
    pub health_bps_before: u32,
    pub realized_loss_micros: U128,
    pub variation_from_collateral_micros: U128,
    pub insurance_cover_micros: U128,
    pub uncovered_shortfall_micros: U128,
    pub liquidator_bonus_micros: U128,
    pub provider_refund_micros: U128,
    pub rehedge_margin_micros: U128,
    pub liquidated_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProviderStats {
    pub delivered_count: u32,
    pub slashed_count: u32,
    pub delivered_cu_scaled: U128,
    pub slashed_cu_scaled: U128,
    pub penalties_paid_micros: U128,
    /// delivered / (delivered + slashed) in bps; 10_000 when no history.
    pub reliability_bps: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LongPosition {
    pub cu_scaled: U128,
    pub cost_basis_micros: U128,
    pub avg_entry_price_micros: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SlaConfig {
    pub max_sla_latency_ms: u32,
    pub ack_window_ms: u64,
    pub delivery_window_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct FillDetail {
    pub order_id: OrderId,
    pub maker_id: AccountId,
    pub vault_id: Option<VaultId>,
    pub price_micros: U128,
    pub cu_scaled: U128,
    pub notional_micros: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TradeReport {
    pub series_id: SeriesId,
    pub taker_id: AccountId,
    pub side: Side,
    pub requested_cu_scaled: U128,
    pub filled_cu_scaled: U128,
    pub notional_micros: U128,
    pub avg_price_micros: U128,
    pub fills: Vec<FillDetail>,
    pub resting_order_id: Option<OrderId>,
    pub stale_orders_cancelled: Vec<OrderId>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ShortSupplyOutcome {
    pub vault_id: VaultId,
    pub trade: TradeReport,
    pub margin_deposit_micros: U128,
    pub required_initial_margin_micros: U128,
    pub vault_equity_micros: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AttestationOutcome {
    pub series_id: SeriesId,
    pub previous_twap_micros: U128,
    pub twap_micros: U128,
    pub tdx_quote_hash: String,
    pub flagged_vaults: Vec<VaultId>,
    pub purged_orders: Vec<OrderId>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VaultHealth {
    pub vault_id: VaultId,
    pub series_id: SeriesId,
    pub provider: AccountId,
    pub mark_price_micros: U128,
    pub open_notional_micros: U128,
    pub unrealized_loss_micros: U128,
    pub equity_micros: U128,
    pub deficit_micros: U128,
    /// `None` when the vault has no open obligation (infinitely healthy).
    pub health_bps: Option<u32>,
    pub required_initial_margin_micros: U128,
    pub required_maintenance_margin_micros: U128,
    pub excess_collateral_micros: U128,
    pub liquidation_price_micros: Option<U128>,
    pub is_liquidatable: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceLevel {
    pub price_micros: U128,
    pub cu_scaled: U128,
    pub orders: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OrderBookView {
    pub series_id: SeriesId,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub best_bid_micros: Option<U128>,
    pub best_ask_micros: Option<U128>,
    pub index_twap_usdc_micros: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SeriesInvariantReport {
    pub series_id: SeriesId,
    pub total_supply_cu: U128,
    pub escrowed_in_redemptions_cu: U128,
    pub circulating_cu: U128,
    pub open_vault_obligations_cu: U128,
    pub settlement_pool_cu: U128,
    pub holds: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ProtocolStats {
    pub owner_id: AccountId,
    pub usdc_token_id: AccountId,
    pub tee_signer_pubkey_hex: String,
    pub insurance_pool_micros: U128,
    pub genesis_credit_outstanding_micros: U128,
    pub withdrawals_enabled: bool,
    pub total_deposited_micros: U128,
    pub total_withdrawn_micros: U128,
    pub sla: SlaConfig,
    pub series_ids: Vec<SeriesId>,
    pub next_order_id: u64,
    pub next_vault_id: u64,
    pub next_request_id: u64,
    pub cash_settlements: u32,
    pub liquidations: u32,
}
