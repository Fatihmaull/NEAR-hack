//! # Paron v2 — Autonomous Compute Forward & Runway Hedging Desk for AI Agents on NEAR
//!
//! One contract, three canonical NEP-245 maturities (`CU-2026-11`, `CU-2026-12`, `CU-2027-01`) where
//! `1.00 CU = 1 hour of NVIDIA H100 SXM 80GB`. Modules:
//!
//! - [`nep245`]      NEP-245 multi-token ledger for the CU series (+ hardware-to-CU conversion).
//! - [`guardrails`]  `AgentGuardrailPolicy`: daily spend caps, TWAP slippage band, series allowlist, pause.
//! - [`margin`]      `ShortMarginVault`: 25% initial / 15% maintenance margin, health, liquidation.
//! - [`orderbook`]   Price-time priority CLOB with genesis depth, agent buys, bids, short supply.
//! - [`settlement`]  OutLayer TEE index attestations, Mode A cash settlement, Mode B TEE redemption + SLA slash.
//!
//! Collateral is USDC (NEP-141) deposited through `ft_transfer_call` (`ft_on_transfer`), e.g. directly
//! from a NEAR Intents 1Click swap using `customRecipientMsg`. Everything an agent can do through a
//! NEAR *Function Call access key* is non-payable; moving value out of the protocol
//! (`withdraw_usdc`, `mt_transfer*`) requires 1 yoctoNEAR and therefore a full-access key.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue, PublicKey,
};
use std::str::FromStr;

pub mod events;
pub mod guardrails;
pub mod margin;
pub mod nep245;
pub mod orderbook;
pub mod settlement;
pub mod types;

#[cfg(test)]
mod tests;

pub use types::*;

pub const DEFAULT_USDC_TOKEN_ID: &str = "usdc.fakes.testnet";
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub(crate) enum StorageKey {
    Series,
    MtBalances,
    MtSupply,
    LongPositions,
    UsdcBalances,
    Books,
    Vaults,
    VaultIndex,
    SeriesVaults,
    Guardrails,
    GuardrailDelegations,
    Redemptions,
    ProviderStats,
    UsedQuoteHashes,
    CashReceipts,
    LiquidationReceipts,
}

#[ext_contract(ext_ft)]
pub trait FungibleTokenCore {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// `msg` accepted by `ft_on_transfer`. An empty `msg` credits the sender.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq)]
pub enum DepositInstruction {
    /// Credit free USDC to `beneficiary` (defaults to the sender), e.g. an agent funded by its treasury.
    Deposit { beneficiary: Option<AccountId> },
    /// Fund the protocol insurance pool that backstops liquidation bad debt and slash shortfalls.
    Insurance,
    /// Repay the genesis liquidity credit created in `new()`; any excess is credited to the sender.
    FundGenesis,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ParonCore {
    pub(crate) owner_id: AccountId,
    pub(crate) usdc_token_id: AccountId,
    pub(crate) tee_signer_pubkey: [u8; 32],
    pub(crate) series_ids: Vec<SeriesId>,
    pub(crate) series: LookupMap<SeriesId, ComputeSeries>,
    pub(crate) mt_balances: LookupMap<(SeriesId, AccountId), u128>,
    pub(crate) mt_supply: LookupMap<SeriesId, u128>,
    pub(crate) long_positions: LookupMap<(SeriesId, AccountId), LongPosition>,
    pub(crate) usdc_balances: LookupMap<AccountId, u128>,
    pub(crate) books: LookupMap<SeriesId, OrderBook>,
    pub(crate) vaults: LookupMap<VaultId, ShortMarginVault>,
    pub(crate) vault_index: LookupMap<(AccountId, SeriesId), VaultId>,
    pub(crate) series_vaults: LookupMap<SeriesId, Vec<VaultId>>,
    pub(crate) guardrails: LookupMap<AccountId, AgentGuardrailPolicy>,
    pub(crate) guardrail_delegations: LookupMap<AccountId, AccountId>,
    pub(crate) redemptions: LookupMap<RequestId, RedemptionRequest>,
    pub(crate) provider_stats: LookupMap<AccountId, ProviderStats>,
    pub(crate) used_quote_hashes: LookupSet<String>,
    pub(crate) cash_receipts: Vector<CashSettlementReceipt>,
    pub(crate) liquidation_receipts: Vector<LiquidationReceipt>,
    pub(crate) next_order_id: u64,
    pub(crate) next_vault_id: u64,
    pub(crate) next_request_id: u64,
    pub(crate) insurance_pool_micros: u128,
    pub(crate) genesis_credit_outstanding_micros: u128,
    pub(crate) total_deposited_micros: u128,
    pub(crate) total_withdrawn_micros: u128,
    pub(crate) sla: SlaConfig,
}

/// Accepts `ed25519:<base58>` (NEAR format) or 64 hex characters.
pub fn parse_ed25519_public_key(value: &str) -> [u8; 32] {
    if value.starts_with("ed25519:") {
        let pk = PublicKey::from_str(value).unwrap_or_else(|_| env::panic_str("invalid ed25519 public key"));
        let bytes = pk.as_bytes();
        require!(bytes.len() == 33 && bytes[0] == 0, "TEE signer must be an ed25519 key");
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes[1..33]);
        out
    } else {
        let raw = hex::decode(value).unwrap_or_else(|_| env::panic_str("TEE signer key must be ed25519:<base58> or hex"));
        raw.try_into().unwrap_or_else(|_| env::panic_str("TEE signer key must be 32 bytes"))
    }
}

pub(crate) fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[near]
impl ParonCore {
    /// Initialise the protocol, register the OutLayer enclave signer and pre-seed the three canonical
    /// series with genesis order-book depth so the book is tradable immediately.
    ///
    /// The genesis vault is 100% covered and its bids are fully escrowed; both are funded by a protocol
    /// **genesis liquidity credit** that must be repaid with `ft_transfer_call(msg={"action":"fund_genesis"})`.
    /// Until it is repaid, *all* USDC withdrawals are disabled, so the credit can never be extracted.
    #[init]
    pub fn new(owner_id: AccountId, tee_signer_pubkey: String, usdc_token_id: Option<AccountId>) -> Self {
        let mut this = Self {
            owner_id,
            usdc_token_id: usdc_token_id.unwrap_or_else(|| DEFAULT_USDC_TOKEN_ID.parse().unwrap()),
            tee_signer_pubkey: parse_ed25519_public_key(&tee_signer_pubkey),
            series_ids: Vec::new(),
            series: LookupMap::new(StorageKey::Series),
            mt_balances: LookupMap::new(StorageKey::MtBalances),
            mt_supply: LookupMap::new(StorageKey::MtSupply),
            long_positions: LookupMap::new(StorageKey::LongPositions),
            usdc_balances: LookupMap::new(StorageKey::UsdcBalances),
            books: LookupMap::new(StorageKey::Books),
            vaults: LookupMap::new(StorageKey::Vaults),
            vault_index: LookupMap::new(StorageKey::VaultIndex),
            series_vaults: LookupMap::new(StorageKey::SeriesVaults),
            guardrails: LookupMap::new(StorageKey::Guardrails),
            guardrail_delegations: LookupMap::new(StorageKey::GuardrailDelegations),
            redemptions: LookupMap::new(StorageKey::Redemptions),
            provider_stats: LookupMap::new(StorageKey::ProviderStats),
            used_quote_hashes: LookupSet::new(StorageKey::UsedQuoteHashes),
            cash_receipts: Vector::new(StorageKey::CashReceipts),
            liquidation_receipts: Vector::new(StorageKey::LiquidationReceipts),
            next_order_id: 1,
            next_vault_id: 1,
            next_request_id: 1,
            insurance_pool_micros: 0,
            genesis_credit_outstanding_micros: 0,
            total_deposited_micros: 0,
            total_withdrawn_micros: 0,
            sla: SlaConfig {
                max_sla_latency_ms: DEFAULT_MAX_SLA_LATENCY_MS,
                ack_window_ms: DEFAULT_ACK_WINDOW_MS,
                delivery_window_ms: DEFAULT_DELIVERY_WINDOW_MS,
            },
        };
        this.seed_canonical_series();
        events::paron(
            "protocol_initialized",
            json!({
                "owner_id": this.owner_id,
                "usdc_token_id": this.usdc_token_id,
                "tee_signer_pubkey_hex": hex::encode(this.tee_signer_pubkey),
                "series": this.series_ids,
                "genesis_credit_micros": this.genesis_credit_outstanding_micros.to_string(),
            }),
        );
        this
    }

    // ------------------------------------------------------------------------------------------
    // USDC ledger (NEP-141 receiver)
    // ------------------------------------------------------------------------------------------

    /// NEP-141 receiver. Only the configured USDC token is accepted; an unknown `msg` panics so the
    /// token contract refunds the transfer.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc_token_id, "only the configured USDC token is accepted");
        let amount = amount.0;
        require!(amount > 0, "deposit amount must be positive");
        let instruction = if msg.trim().is_empty() {
            DepositInstruction::Deposit { beneficiary: None }
        } else {
            near_sdk::serde_json::from_str::<DepositInstruction>(&msg)
                .unwrap_or_else(|_| env::panic_str("invalid ft_on_transfer msg"))
        };
        self.total_deposited_micros += amount;
        match instruction {
            DepositInstruction::Deposit { beneficiary } => {
                let beneficiary = beneficiary.unwrap_or_else(|| sender_id.clone());
                self.credit_usdc(&beneficiary, amount);
                events::paron(
                    "usdc_deposited",
                    json!({ "sender_id": sender_id, "beneficiary": beneficiary, "amount_micros": amount.to_string() }),
                );
            }
            DepositInstruction::Insurance => {
                self.insurance_pool_micros += amount;
                events::paron("insurance_funded", json!({ "sender_id": sender_id, "amount_micros": amount.to_string() }));
            }
            DepositInstruction::FundGenesis => {
                let applied = amount.min(self.genesis_credit_outstanding_micros);
                self.genesis_credit_outstanding_micros -= applied;
                self.credit_usdc(&sender_id, amount - applied);
                events::paron(
                    "genesis_credit_funded",
                    json!({
                        "sender_id": sender_id,
                        "applied_micros": applied.to_string(),
                        "outstanding_micros": self.genesis_credit_outstanding_micros.to_string(),
                    }),
                );
            }
        }
        PromiseOrValue::Value(U128(0))
    }

    /// Withdraw free USDC. Requires 1 yoctoNEAR (full-access key) so an agent's Function Call key
    /// can never move funds out of the protocol.
    #[payable]
    pub fn withdraw_usdc(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        require!(
            self.genesis_credit_outstanding_micros == 0,
            "withdrawals unlock once the genesis liquidity credit is funded"
        );
        require!(amount.0 > 0, "amount must be positive");
        let account_id = env::predecessor_account_id();
        self.debit_usdc(&account_id, amount.0);
        self.total_withdrawn_micros += amount.0;
        ext_ft::ext(self.usdc_token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(account_id.clone(), amount, Some("paron:withdraw".to_string()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_WITHDRAW_CALLBACK).on_usdc_withdraw(account_id, amount))
    }

    /// Re-credits the internal balance if the outgoing `ft_transfer` failed.
    #[private]
    pub fn on_usdc_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        let succeeded = env::promise_result_checked(0, 1_024).is_ok();
        if succeeded {
            events::paron("usdc_withdrawn", json!({ "account_id": account_id, "amount_micros": amount.0.to_string() }));
        } else {
            self.credit_usdc(&account_id, amount.0);
            self.total_withdrawn_micros -= amount.0;
            events::paron("usdc_withdraw_refunded", json!({ "account_id": account_id, "amount_micros": amount.0.to_string() }));
        }
        succeeded
    }

    // ------------------------------------------------------------------------------------------
    // Owner administration (all require 1 yoctoNEAR)
    // ------------------------------------------------------------------------------------------

    /// Rotate the OutLayer enclave signer (e.g. after the worker is rebuilt and its derived key changes).
    #[payable]
    pub fn set_tee_signer_pubkey(&mut self, tee_signer_pubkey: String) {
        assert_one_yocto();
        self.assert_owner();
        self.tee_signer_pubkey = parse_ed25519_public_key(&tee_signer_pubkey);
        events::paron("tee_signer_rotated", json!({ "tee_signer_pubkey_hex": hex::encode(self.tee_signer_pubkey) }));
    }

    #[payable]
    pub fn set_sla_config(&mut self, max_sla_latency_ms: u32, ack_window_ms: u64, delivery_window_ms: u64) {
        assert_one_yocto();
        self.assert_owner();
        require!(max_sla_latency_ms > 0 && ack_window_ms > 0 && delivery_window_ms >= ack_window_ms, "invalid SLA config");
        self.sla = SlaConfig { max_sla_latency_ms, ack_window_ms, delivery_window_ms };
        events::paron("sla_config_updated", json!({ "sla": self.sla }));
    }

    // ------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------

    pub fn get_series(&self, series_id: SeriesId) -> Option<ComputeSeries> {
        self.series.get(&series_id).cloned().map(|s| self.with_live_open_interest(s))
    }

    pub fn list_series(&self) -> Vec<ComputeSeries> {
        self.series_ids.iter().filter_map(|id| self.get_series(id.clone())).collect()
    }

    pub fn usdc_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.usdc_of(&account_id))
    }

    pub fn get_long_position(&self, account_id: AccountId, series_id: SeriesId) -> LongPosition {
        self.position_of(&series_id, &account_id)
    }

    pub fn get_provider_stats(&self, provider_id: AccountId) -> ProviderStats {
        self.provider_stats_of(&provider_id)
    }

    pub fn get_cash_settlement_receipts(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<CashSettlementReceipt> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.cash_receipts.len().min(from.saturating_add(limit)))
            .filter_map(|i| self.cash_receipts.get(i).cloned())
            .collect()
    }

    pub fn get_liquidation_receipts(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<LiquidationReceipt> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.liquidation_receipts.len().min(from.saturating_add(limit)))
            .filter_map(|i| self.liquidation_receipts.get(i).cloned())
            .collect()
    }

    pub fn protocol_stats(&self) -> ProtocolStats {
        ProtocolStats {
            owner_id: self.owner_id.clone(),
            usdc_token_id: self.usdc_token_id.clone(),
            tee_signer_pubkey_hex: hex::encode(self.tee_signer_pubkey),
            insurance_pool_micros: U128(self.insurance_pool_micros),
            genesis_credit_outstanding_micros: U128(self.genesis_credit_outstanding_micros),
            withdrawals_enabled: self.genesis_credit_outstanding_micros == 0,
            total_deposited_micros: U128(self.total_deposited_micros),
            total_withdrawn_micros: U128(self.total_withdrawn_micros),
            sla: self.sla.clone(),
            series_ids: self.series_ids.clone(),
            next_order_id: self.next_order_id,
            next_vault_id: self.next_vault_id,
            next_request_id: self.next_request_id,
            cash_settlements: self.cash_receipts.len(),
            liquidations: self.liquidation_receipts.len(),
        }
    }

    /// Conservation check exposed to auditors and judges:
    /// before settlement `circulating supply == Σ open vault obligations`; after settlement
    /// `circulating supply == settlement_pool_cu`.
    pub fn audit_series_invariants(&self, series_id: SeriesId) -> SeriesInvariantReport {
        let series = self.series_or_panic(&series_id);
        let total_supply = self.mt_supply.get(&series_id).copied().unwrap_or(0);
        let escrowed = self.mt_balance_internal(&series_id, &env::current_account_id());
        let circulating = total_supply - escrowed;
        let open: u128 = self
            .vault_ids_of(&series_id)
            .iter()
            .filter_map(|id| self.vaults.get(id))
            .map(|v| v.shorted_cu_scaled.0)
            .sum();
        let holds = if series.is_settled {
            circulating == series.settlement_pool_cu.0 && open == 0
        } else {
            circulating == open
        };
        SeriesInvariantReport {
            series_id,
            total_supply_cu: U128(total_supply),
            escrowed_in_redemptions_cu: U128(escrowed),
            circulating_cu: U128(circulating),
            open_vault_obligations_cu: U128(open),
            settlement_pool_cu: series.settlement_pool_cu,
            holds,
        }
    }
}

// ----------------------------------------------------------------------------------------------
// Internal helpers shared by all modules
// ----------------------------------------------------------------------------------------------
impl ParonCore {
    fn seed_canonical_series(&mut self) {
        let now = env::block_timestamp_ms();
        let owner = self.owner_id.clone();
        for (id, label, maturity_ms, strike) in CANONICAL_SERIES {
            let series_id = id.to_string();
            self.series.insert(
                series_id.clone(),
                ComputeSeries {
                    series_id: series_id.clone(),
                    label: label.to_string(),
                    maturity_timestamp_ms: maturity_ms,
                    initial_strike_usdc_micros: U128(strike),
                    mark_price_usdc_micros: U128(strike),
                    index_twap_usdc_micros: U128(strike),
                    index_updated_at_ms: now,
                    index_observed_at_ms: now,
                    last_tee_attestation_hash: String::new(),
                    total_open_interest_cu: U128(0),
                    total_volume_cu: U128(0),
                    is_settled: false,
                    final_settlement_price_micros: None,
                    settlement_pool_micros: U128(0),
                    settlement_pool_cu: U128(0),
                },
            );
            self.series_ids.push(series_id.clone());
            self.mt_supply.insert(series_id.clone(), 0);

            // Genesis market-maker vault: 100% covered asks + fully escrowed bids.
            let mut vault = self.load_or_create_vault(&owner, &series_id);
            let mut book = OrderBook::default();
            let mut covered_collateral = 0u128;
            for (offset, size) in GENESIS_ASK_LEVELS {
                let price = strike + offset;
                let order_notional = notional(size, price);
                vault.listed_cu_scaled.0 += size;
                vault.listed_notional_micros.0 += order_notional;
                covered_collateral += order_notional;
                let order = Order {
                    order_id: self.take_order_id(),
                    owner_id: owner.clone(),
                    side: Side::Ask,
                    price_micros: U128(price),
                    original_cu_scaled: U128(size),
                    remaining_cu_scaled: U128(size),
                    escrow_micros: U128(0),
                    vault_id: Some(vault.vault_id),
                    created_at_ms: now,
                };
                orderbook::insert_order(&mut book, order);
            }
            vault.locked_collateral_micros = U128(covered_collateral);
            let mut bid_escrow = 0u128;
            for (offset, size) in GENESIS_BID_LEVELS {
                let price = strike - offset;
                let escrow = notional(size, price);
                bid_escrow += escrow;
                let order = Order {
                    order_id: self.take_order_id(),
                    owner_id: owner.clone(),
                    side: Side::Bid,
                    price_micros: U128(price),
                    original_cu_scaled: U128(size),
                    remaining_cu_scaled: U128(size),
                    escrow_micros: U128(escrow),
                    vault_id: None,
                    created_at_ms: now,
                };
                orderbook::insert_order(&mut book, order);
            }
            self.genesis_credit_outstanding_micros += covered_collateral + bid_escrow;
            self.save_vault(vault);
            self.books.insert(series_id, book);
        }
    }

    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "only the protocol owner may call this method");
    }

    pub(crate) fn usdc_of(&self, account_id: &AccountId) -> u128 {
        self.usdc_balances.get(account_id).copied().unwrap_or(0)
    }

    pub(crate) fn credit_usdc(&mut self, account_id: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let balance = self.usdc_of(account_id);
        self.usdc_balances.insert(account_id.clone(), balance + amount);
    }

    pub(crate) fn debit_usdc(&mut self, account_id: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let balance = self.usdc_of(account_id);
        require!(
            balance >= amount,
            format!("insufficient free USDC: {account_id} has {balance} micros, needs {amount}")
        );
        self.usdc_balances.insert(account_id.clone(), balance - amount);
    }

    pub(crate) fn series_or_panic(&self, series_id: &str) -> ComputeSeries {
        self.series
            .get(series_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("unknown series {series_id}")))
    }

    pub(crate) fn assert_tradable(series: &ComputeSeries) {
        require!(!series.is_settled, "series already settled");
        require!(
            env::block_timestamp_ms() < series.maturity_timestamp_ms,
            "series has matured: trading and redemptions are closed"
        );
    }

    pub(crate) fn with_live_open_interest(&self, mut series: ComputeSeries) -> ComputeSeries {
        series.total_open_interest_cu = U128(self.mt_supply.get(&series.series_id).copied().unwrap_or(0));
        series
    }

    /// Persist a series, keeping `total_open_interest_cu` in sync with the NEP-245 supply.
    pub(crate) fn save_series(&mut self, series: ComputeSeries) {
        let series = self.with_live_open_interest(series);
        self.series.insert(series.series_id.clone(), series);
    }

    pub(crate) fn take_order_id(&mut self) -> OrderId {
        let id = self.next_order_id;
        self.next_order_id += 1;
        id
    }

    pub(crate) fn book_of(&self, series_id: &str) -> OrderBook {
        self.books.get(series_id).cloned().unwrap_or_default()
    }

    pub(crate) fn vault_ids_of(&self, series_id: &str) -> Vec<VaultId> {
        self.series_vaults.get(series_id).cloned().unwrap_or_default()
    }

    pub(crate) fn vault_or_panic(&self, vault_id: VaultId) -> ShortMarginVault {
        self.vaults
            .get(&vault_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("unknown vault {vault_id}")))
    }

    pub(crate) fn find_vault_id(&self, provider: &AccountId, series_id: &str) -> Option<VaultId> {
        self.vault_index.get(&(provider.clone(), series_id.to_string())).copied()
    }

    /// Isolated margin: exactly one vault per (provider, series). A liquidated or settled vault is
    /// re-activated (it is empty) when the provider opens new supply.
    pub(crate) fn load_or_create_vault(&mut self, provider: &AccountId, series_id: &str) -> ShortMarginVault {
        if let Some(id) = self.find_vault_id(provider, series_id) {
            let mut vault = self.vault_or_panic(id);
            if vault.status != VaultStatus::Active {
                vault.status = VaultStatus::Active;
            }
            return vault;
        }
        let mut ids = self.vault_ids_of(series_id);
        require!(ids.len() < MAX_VAULTS_PER_SERIES, "vault capacity for this series reached");
        let vault_id = self.next_vault_id;
        self.next_vault_id += 1;
        ids.push(vault_id);
        self.series_vaults.insert(series_id.to_string(), ids);
        self.vault_index.insert((provider.clone(), series_id.to_string()), vault_id);
        let vault = ShortMarginVault {
            vault_id,
            provider: provider.clone(),
            series_id: series_id.to_string(),
            shorted_cu_scaled: U128(0),
            entry_price_micros: U128(0),
            locked_collateral_micros: U128(0),
            escrowed_proceeds_micros: U128(0),
            listed_cu_scaled: U128(0),
            listed_notional_micros: U128(0),
            delivered_cu_scaled: U128(0),
            delivered_count: 0,
            slashed_count: 0,
            status: VaultStatus::Active,
            created_at_ms: env::block_timestamp_ms(),
        };
        self.vaults.insert(vault_id, vault.clone());
        vault
    }

    pub(crate) fn save_vault(&mut self, mut vault: ShortMarginVault) {
        margin::refresh_entry_price(&mut vault);
        self.vaults.insert(vault.vault_id, vault);
    }

    pub(crate) fn provider_stats_of(&self, provider: &AccountId) -> ProviderStats {
        self.provider_stats.get(provider).cloned().unwrap_or(ProviderStats {
            reliability_bps: 10_000,
            ..Default::default()
        })
    }

    pub(crate) fn save_provider_stats(&mut self, provider: &AccountId, mut stats: ProviderStats) {
        let total = stats.delivered_count as u128 + stats.slashed_count as u128;
        stats.reliability_bps = if total == 0 { 10_000 } else { (stats.delivered_count as u128 * BPS / total) as u32 };
        self.provider_stats.insert(provider.clone(), stats);
    }

    pub(crate) fn position_of(&self, series_id: &str, account_id: &AccountId) -> LongPosition {
        self.long_positions.get(&(series_id.to_string(), account_id.clone())).cloned().unwrap_or_default()
    }

    fn save_position(&mut self, series_id: &str, account_id: &AccountId, cu: u128, cost: u128) {
        let key = (series_id.to_string(), account_id.clone());
        if cu == 0 {
            self.long_positions.remove(&key);
            return;
        }
        self.long_positions.insert(
            key,
            LongPosition {
                cu_scaled: U128(cu),
                cost_basis_micros: U128(cost),
                avg_entry_price_micros: U128(cost * CU_SCALE / cu),
            },
        );
    }

    pub(crate) fn position_add(&mut self, series_id: &str, account_id: &AccountId, cu: u128, cost: u128) {
        let pos = self.position_of(series_id, account_id);
        self.save_position(series_id, account_id, pos.cu_scaled.0 + cu, pos.cost_basis_micros.0 + cost);
    }

    /// Removes `cu` from a long position and returns the cost basis that was removed (pro-rata).
    pub(crate) fn position_remove(&mut self, series_id: &str, account_id: &AccountId, cu: u128) -> u128 {
        let pos = self.position_of(series_id, account_id);
        if pos.cu_scaled.0 == 0 {
            return 0;
        }
        let removed = cu.min(pos.cu_scaled.0);
        let basis = pos.cost_basis_micros.0 * removed / pos.cu_scaled.0;
        self.save_position(series_id, account_id, pos.cu_scaled.0 - removed, pos.cost_basis_micros.0 - basis);
        basis
    }

    pub(crate) fn position_move(&mut self, series_id: &str, from: &AccountId, to: &AccountId, cu: u128) {
        let basis = self.position_remove(series_id, from, cu);
        self.position_add(series_id, to, cu, basis);
    }

    pub(crate) fn verify_tee_signature(&self, message: &str, signature_hex: &str) {
        let raw = hex::decode(signature_hex).unwrap_or_else(|_| env::panic_str("TEE signature must be hex"));
        let signature: [u8; 64] = raw.try_into().unwrap_or_else(|_| env::panic_str("TEE signature must be 64 bytes"));
        require!(
            env::ed25519_verify(&signature, message.as_bytes(), &self.tee_signer_pubkey),
            "invalid OutLayer TEE signature"
        );
    }

    /// Every Intel TDX quote hash can be used exactly once (replay protection across index
    /// attestations and execution receipts).
    pub(crate) fn consume_quote_hash(&mut self, tdx_quote_hash: &str) {
        require!(is_lower_hex_64(tdx_quote_hash), "tdx_quote_hash must be 64 lowercase hex chars (SHA-256)");
        require!(self.used_quote_hashes.insert(tdx_quote_hash.to_string()), "TDX quote hash already consumed (replay)");
    }
}
