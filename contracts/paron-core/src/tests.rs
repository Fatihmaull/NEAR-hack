//! Unit & scenario tests for Paron v2 core.
//!
//! The OutLayer enclave is played by a real Ed25519 key (`ed25519-dalek`) and every attestation and
//! execution receipt is verified by the contract through `env::ed25519_verify` in near-sdk's mocked VM.

use super::*;
use crate::settlement::{execution_receipt_message, index_attestation_message};
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, NearToken, PromiseResult, RuntimeFeesConfig};

/// 2026-11-05T09:00:00Z
const T0: u64 = 1_793_869_200_000;
const MINUTE: u64 = 60_000;
const HOUR: u64 = 60 * MINUTE;
const NOV_MATURITY: u64 = 1_796_083_199_000;

fn acc(id: &str) -> AccountId {
    id.parse().unwrap()
}
fn owner() -> AccountId {
    acc("paron.testnet")
}
fn contract_id() -> AccountId {
    acc("market.paron.testnet")
}
fn usdc_token() -> AccountId {
    acc("usdc.fakes.testnet")
}
fn treasury() -> AccountId {
    acc("swarm-treasury.testnet")
}
fn cfo() -> AccountId {
    acc("cfo.swarm-treasury.testnet")
}
fn mm() -> AccountId {
    acc("mm.swarm-treasury.testnet")
}
fn consumer() -> AccountId {
    acc("consumer.swarm-treasury.testnet")
}
fn provider() -> AccountId {
    acc("batam-h100.testnet")
}
fn relayer() -> AccountId {
    acc("relayer.testnet")
}

const NOV: &str = SERIES_2026_11;
const DEC: &str = SERIES_2026_12;

fn usdc(units: u128) -> u128 {
    units * USDC
}
fn cu(units: u128) -> u128 {
    units * CU_SCALE
}

/// Test-only enclave key (the production key is derived inside the TDX enclave and never leaves it).
fn tee_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn quote_hash(label: &str) -> String {
    hex::encode(env::sha256(label.as_bytes()))
}

fn context(predecessor: &AccountId, now_ms: u64, deposit_yocto: u128) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor.clone())
        .block_timestamp(now_ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
        .build()
}

struct Harness {
    c: ParonCore,
    now: u64,
}

impl Harness {
    fn new() -> Self {
        Self::with_tee_signer(hex::encode(tee_key().verifying_key().to_bytes()))
    }

    fn with_tee_signer(pubkey: String) -> Self {
        testing_env!(context(&owner(), T0, 0));
        let c = ParonCore::new(owner(), pubkey, Some(usdc_token()));
        Self { c, now: T0 }
    }

    fn call(&self, who: &AccountId) -> &Self {
        testing_env!(context(who, self.now, 0));
        self
    }

    fn call_yocto(&self, who: &AccountId) {
        testing_env!(context(who, self.now, 1));
    }

    fn deposit(&mut self, who: &AccountId, amount_micros: u128) {
        testing_env!(context(&usdc_token(), self.now, 0));
        let _ = self.c.ft_on_transfer(who.clone(), U128(amount_micros), String::new());
    }

    fn fund_insurance(&mut self, amount_micros: u128) {
        testing_env!(context(&usdc_token(), self.now, 0));
        let _ = self.c.ft_on_transfer(owner(), U128(amount_micros), r#"{"action":"insurance"}"#.to_string());
    }

    fn guardrail(&mut self, agent: &AccountId, daily_cap: u128, slippage_bps: u16) -> AgentGuardrailPolicy {
        self.call_yocto(&treasury());
        self.c.configure_agent_guardrail(agent.clone(), U128(daily_cap), slippage_bps, None)
    }

    fn short(&mut self, who: &AccountId, series: &str, qty: u128, price: u128, margin: u128) -> ShortSupplyOutcome {
        self.call(who);
        self.c.open_short_supply(series.to_string(), U128(qty), U128(price), U128(margin))
    }

    fn buy(&mut self, who: &AccountId, series: &str, qty: u128, max_price: u128) -> TradeReport {
        self.call(who);
        self.c.agent_buy_forward(series.to_string(), U128(qty), U128(max_price))
    }

    fn attest(&mut self, series: &str, twap: u128, observed_at: u64, label: &str) -> AttestationOutcome {
        let hash = quote_hash(label);
        let message = index_attestation_message(series, twap, observed_at, &hash);
        let sig = hex::encode(tee_key().sign(message.as_bytes()).to_bytes());
        self.call(&relayer());
        self.c.submit_outlayer_index_attestation(series.to_string(), U128(twap), observed_at, hash, sig)
    }

    fn receipt(&mut self, request_id: u64, label: &str, latency: u32, sla_met: bool) -> RedemptionRequest {
        let hash = quote_hash(label);
        let message = execution_receipt_message(request_id, &hash, latency, sla_met);
        let sig = hex::encode(tee_key().sign(message.as_bytes()).to_bytes());
        self.call(&provider());
        self.c.finalize_redemption_with_tee_receipt(request_id, hash, latency, sla_met, sig)
    }

    fn free(&self, who: &AccountId) -> u128 {
        self.c.usdc_balance_of(who.clone()).0
    }

    fn balance(&self, who: &AccountId, series: &str) -> u128 {
        self.c.mt_balance_of(who.clone(), series.to_string()).0
    }

    fn invariants_hold(&self, series: &str) -> bool {
        self.c.audit_series_invariants(series.to_string()).holds
    }
}

/// Provider pre-sells Dec capacity and the consumer agent buys 60 CU of it.
fn mode_b_setup() -> Harness {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    h.short(&provider(), DEC, cu(200), 2_950_000, 147_500_000);
    h.deposit(&consumer(), usdc(500));
    h.guardrail(&consumer(), usdc(1_000), 150);
    let trade = h.buy(&consumer(), DEC, cu(60), 2_994_250);
    assert_eq!(trade.filled_cu_scaled.0, cu(60));
    assert_eq!(trade.notional_micros.0, 177_000_000);
    h
}

// ---------------------------------------------------------------------------------------------
// 1. Initialisation & genesis depth
// ---------------------------------------------------------------------------------------------

#[test]
fn init_preseeds_three_series_and_genesis_depth() {
    let h = Harness::new();
    let series = h.c.list_series();
    let ids: Vec<&str> = series.iter().map(|s| s.series_id.as_str()).collect();
    assert_eq!(ids, vec!["CU-2026-11", "CU-2026-12", "CU-2027-01"]);
    let strikes: Vec<u128> = series.iter().map(|s| s.initial_strike_usdc_micros.0).collect();
    assert_eq!(strikes, vec![2_800_000, 2_950_000, 3_100_000]);
    assert!(series.iter().all(|s| s.index_twap_usdc_micros == s.initial_strike_usdc_micros && !s.is_settled));
    assert_eq!(series[0].maturity_timestamp_ms, NOV_MATURITY);

    let book = h.c.get_order_book(NOV.to_string(), None);
    assert_eq!(book.asks.len(), 3);
    assert_eq!(book.bids.len(), 3);
    assert_eq!(book.best_ask_micros, Some(U128(2_820_000)));
    assert_eq!(book.best_bid_micros, Some(U128(2_760_000)));
    assert_eq!(book.asks[2].cu_scaled.0, cu(400));

    // Genesis vault is 100% covered, bids fully escrowed, financed by the genesis credit.
    let genesis = h.c.get_vault_by_provider(owner(), NOV.to_string()).unwrap();
    assert_eq!(genesis.locked_collateral_micros.0, 2_306_000_000);
    assert_eq!(genesis.listed_cu_scaled.0, cu(800));
    let stats = h.c.protocol_stats();
    assert!(!stats.withdrawals_enabled);
    // Per series: asks 150*(K+.02)+250*(K+.06)+400*(K+.12) + bids 150*(K-.04)+250*(K-.08)+400*(K-.14)
    assert_eq!(stats.genesis_credit_outstanding_micros.0, 4_464_000_000 + 4_704_000_000 + 4_944_000_000);
    assert_eq!(h.c.mt_supply(NOV.to_string()), Some(U128(0)));
    assert!(h.invariants_hold(NOV));
}

// ---------------------------------------------------------------------------------------------
// 2. Hardware weights
// ---------------------------------------------------------------------------------------------

#[test]
fn hardware_weight_conversion_all_five_tiers() {
    let h = Harness::new();
    let hours_100 = U128(cu(100));
    let expected = [
        (GpuTier::A100, cu(45)),
        (GpuTier::H100, cu(100)),
        (GpuTier::H200, cu(140)),
        (GpuTier::B200, cu(250)),
        (GpuTier::GB200, cu(350)),
    ];
    for (tier, want) in expected {
        assert_eq!(h.c.convert_hardware_to_cu(tier, hours_100).0, want, "{tier:?}");
    }
    // PRD examples: 40 h of H200 = 56 CU, 100 h of A100 = 45 CU, 1.5 h of B200 = 3.75 CU.
    assert_eq!(h.c.convert_hardware_to_cu(GpuTier::H200, U128(cu(40))).0, cu(56));
    assert_eq!(h.c.convert_hardware_to_cu(GpuTier::A100, U128(cu(100))).0, cu(45));
    assert_eq!(h.c.convert_hardware_to_cu(GpuTier::B200, U128(15_000)).0, 37_500);
}

// ---------------------------------------------------------------------------------------------
// 3. NEP-245
// ---------------------------------------------------------------------------------------------

#[test]
fn nep245_transfer_and_balances() {
    let mut h = Harness::new();
    h.deposit(&cfo(), usdc(100));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(10), 2_842_000);
    assert_eq!(h.balance(&cfo(), NOV), cu(10));
    assert_eq!(h.c.get_long_position(cfo(), NOV.to_string()).cost_basis_micros.0, 28_200_000);

    h.call_yocto(&cfo());
    h.c.mt_transfer(consumer(), NOV.to_string(), U128(cu(4)), None, Some("allocate inference budget".into()));
    assert_eq!(h.balance(&cfo(), NOV), cu(6));
    assert_eq!(h.balance(&consumer(), NOV), cu(4));
    assert_eq!(
        h.c.mt_batch_balance_of(consumer(), vec![NOV.into(), DEC.into()]),
        vec![U128(cu(4)), U128(0)]
    );
    assert_eq!(h.c.mt_supply(NOV.to_string()), Some(U128(cu(10))));
    assert_eq!(h.c.mt_batch_supply(vec![NOV.into(), "CU-1999-01".into()]), vec![Some(U128(cu(10))), None]);
    // Cost basis follows the tokens pro-rata.
    assert_eq!(h.c.get_long_position(cfo(), NOV.to_string()).cost_basis_micros.0, 16_920_000);
    assert_eq!(h.c.get_long_position(consumer(), NOV.to_string()).cost_basis_micros.0, 11_280_000);
    assert!(h.c.mt_token(vec![NOV.into()])[0].is_some());
    assert!(h.invariants_hold(NOV));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn mt_transfer_requires_full_access_key_yocto() {
    let mut h = Harness::new();
    h.deposit(&cfo(), usdc(100));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(10), 2_842_000);
    h.call(&cfo());
    h.c.mt_transfer(consumer(), NOV.to_string(), U128(cu(1)), None, None);
}

#[test]
fn mt_transfer_call_resolve_refunds_unused_amount() {
    let mut h = Harness::new();
    h.deposit(&cfo(), usdc(100));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(10), 2_842_000);
    let adapter = acc("budget-adapter.testnet");
    h.call_yocto(&cfo());
    let _ = h.c.mt_transfer_call(adapter.clone(), NOV.to_string(), U128(cu(10)), None, None, "allocate".into());
    assert_eq!(h.balance(&adapter, NOV), cu(10));
    // Receiver reports 3 CU unused -> refunded to the sender.
    let unused = near_sdk::serde_json::to_vec(&vec![U128(cu(3))]).unwrap();
    testing_env!(
        context(&contract_id(), h.now, 0),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(unused)]
    );
    let used = h.c.mt_resolve_transfer(vec![cfo()], adapter.clone(), vec![NOV.into()], vec![U128(cu(10))], None);
    assert_eq!(used, vec![U128(cu(7))]);
    assert_eq!(h.balance(&cfo(), NOV), cu(3));
    assert_eq!(h.balance(&adapter, NOV), cu(7));
}

// ---------------------------------------------------------------------------------------------
// 4-5. 25% initial margin
// ---------------------------------------------------------------------------------------------

#[test]
fn open_short_supply_with_valid_25pct_margin() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    // 300 CU * $2.81 = $843 notional -> 25% = $210.75 (vs $1,264.50 under the legacy 1.5x bond).
    let out = h.short(&provider(), NOV, cu(300), 2_810_000, 210_750_000);
    assert_eq!(out.required_initial_margin_micros.0, 210_750_000);
    assert!(out.trade.resting_order_id.is_some());
    assert_eq!(h.c.quote_initial_margin(U128(cu(300)), U128(2_810_000)).0, 210_750_000);
    let vault = h.c.get_vault(out.vault_id).unwrap();
    assert_eq!(vault.locked_collateral_micros.0, 210_750_000);
    assert_eq!(vault.listed_cu_scaled.0, cu(300));
    assert_eq!(vault.shorted_cu_scaled.0, 0);
    assert_eq!(h.free(&provider()), usdc(1_000) - 210_750_000);
    assert_eq!(h.c.get_order_book(NOV.to_string(), None).best_ask_micros, Some(U128(2_810_000)));
    let health = h.c.check_vault_health(out.vault_id);
    assert_eq!(health.health_bps, None);
    assert!(!health.is_liquidatable);
}

#[test]
#[should_panic(expected = "insufficient initial margin")]
fn open_short_supply_rejects_below_25pct_margin() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    h.short(&provider(), NOV, cu(300), 2_810_000, 210_749_999);
}

// ---------------------------------------------------------------------------------------------
// 6-11. Agent guardrails & CLOB
// ---------------------------------------------------------------------------------------------

#[test]
fn agent_guardrail_registration() {
    let mut h = Harness::new();
    let policy = h.guardrail(&cfo(), usdc(2_500), 150);
    assert_eq!(policy.owner_id, treasury());
    assert_eq!(policy.max_daily_spend_micros.0, usdc(2_500));
    assert_eq!(policy.max_slippage_bps, 150);
    assert!(!policy.paused);
    assert_eq!(policy.last_reset_day, T0 / MS_PER_DAY);
    assert_eq!(h.c.agent_remaining_allowance(cfo()).0, usdc(2_500));
    // Owner may tighten the policy and restrict series.
    h.call_yocto(&treasury());
    let updated = h.c.configure_agent_guardrail(cfo(), U128(usdc(2_000)), 100, Some(vec![NOV.into()]));
    assert_eq!(updated.allowed_series, vec![NOV.to_string()]);
    assert_eq!(h.c.get_agent_guardrail(cfo()).unwrap().max_slippage_bps, 100);
}

#[test]
#[should_panic(expected = "caller is not authorised to govern this agent")]
fn guardrail_rejects_unrelated_owner() {
    let h = Harness::new();
    h.call_yocto(&acc("attacker.testnet"));
    let mut c = h.c;
    c.configure_agent_guardrail(cfo(), U128(usdc(1)), 0, None);
}

#[test]
fn agent_buy_forward_happy_path() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    let supply = h.short(&provider(), NOV, cu(300), 2_810_000, 210_750_000);
    h.deposit(&cfo(), usdc(3_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    // Ceiling = 2.80 * 1.015 = 2.842: fills 300 @ 2.81 (provider) + 100 @ 2.82 (genesis).
    let trade = h.buy(&cfo(), NOV, cu(400), 2_842_000);
    assert_eq!(trade.filled_cu_scaled.0, cu(400));
    assert_eq!(trade.notional_micros.0, 843_000_000 + 282_000_000);
    assert_eq!(trade.avg_price_micros.0, 2_812_500);
    assert_eq!(trade.fills.len(), 2);
    assert_eq!(h.balance(&cfo(), NOV), cu(400));
    assert_eq!(h.free(&cfo()), usdc(3_000) - 1_125_000_000);
    let pos = h.c.get_long_position(cfo(), NOV.to_string());
    assert_eq!(pos.avg_entry_price_micros.0, 2_812_500);
    let vault = h.c.get_vault(supply.vault_id).unwrap();
    assert_eq!(vault.shorted_cu_scaled.0, cu(300));
    assert_eq!(vault.escrowed_proceeds_micros.0, 843_000_000);
    assert_eq!(vault.entry_price_micros.0, 2_810_000);
    assert_eq!(vault.listed_cu_scaled.0, 0);
    let policy = h.c.get_agent_guardrail(cfo()).unwrap();
    assert_eq!(policy.spent_today_micros.0, 1_125_000_000);
    assert_eq!(h.c.get_series(NOV.to_string()).unwrap().total_open_interest_cu.0, cu(400));
    assert_eq!(h.c.get_series(NOV.to_string()).unwrap().mark_price_usdc_micros.0, 2_820_000);
    assert!(h.invariants_hold(NOV));
}

#[test]
#[should_panic(expected = "daily spend cap exceeded")]
fn agent_buy_rejected_on_daily_spend_cap_overflow() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    h.short(&provider(), NOV, cu(300), 2_810_000, 210_750_000);
    h.deposit(&cfo(), usdc(3_000));
    // 400 CU would cost $1,125 > $1,000 daily cap.
    h.guardrail(&cfo(), usdc(1_000), 150);
    h.buy(&cfo(), NOV, cu(400), 2_842_000);
}

#[test]
#[should_panic(expected = "slippage guard: max price 2900000 exceeds TWAP band ceiling 2842000")]
fn agent_buy_rejected_on_slippage_violation_above_twap() {
    let mut h = Harness::new();
    h.deposit(&cfo(), usdc(3_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(500), 2_900_000);
}

#[test]
fn guardrail_daily_spend_resets_on_new_utc_day() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    h.short(&provider(), NOV, cu(300), 2_810_000, 210_750_000);
    h.deposit(&cfo(), usdc(3_000));
    h.guardrail(&cfo(), usdc(1_000), 150);
    h.buy(&cfo(), NOV, cu(300), 2_842_000); // $843 of the $1,000 cap
    assert_eq!(h.c.agent_remaining_allowance(cfo()).0, 157_000_000);
    h.now += 24 * HOUR;
    h.buy(&cfo(), NOV, cu(100), 2_842_000); // $282 -> only possible after the UTC-day reset
    let policy = h.c.get_agent_guardrail(cfo()).unwrap();
    assert_eq!(policy.spent_today_micros.0, 282_000_000);
    assert_eq!(policy.last_reset_day, T0 / MS_PER_DAY + 1);
    assert_eq!(policy.lifetime_spend_micros.0, 1_125_000_000);
}

#[test]
#[should_panic(expected = "agent is paused by its guardrail owner")]
fn paused_agent_cannot_trade() {
    let mut h = Harness::new();
    h.deposit(&cfo(), usdc(3_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.call_yocto(&treasury());
    h.c.set_agent_paused(cfo(), true);
    h.buy(&cfo(), NOV, cu(10), 2_842_000);
}

#[test]
fn sell_forward_into_bids_and_cancel_refunds_escrow() {
    let mut h = Harness::new();
    h.deposit(&cfo(), usdc(1_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(100), 2_842_000); // 100 @ 2.82 from genesis
    h.call(&cfo());
    // Early exit: sell 40 CU into the best bid (genesis 2.76) — floor 2.80 * 0.985 = 2.758.
    let sold = h.c.sell_forward(NOV.to_string(), U128(cu(40)), U128(2_760_000));
    assert_eq!(sold.notional_micros.0, 110_400_000);
    assert_eq!(h.balance(&owner(), NOV), cu(40));
    assert_eq!(h.free(&cfo()), usdc(1_000) - 282_000_000 + 110_400_000);
    assert!(h.invariants_hold(NOV));

    h.deposit(&mm(), usdc(500));
    h.call(&mm());
    let bid = h.c.place_bid(NOV.to_string(), U128(cu(50)), U128(2_780_000));
    let order_id = bid.resting_order_id.unwrap();
    assert_eq!(h.free(&mm()), usdc(500) - 139_000_000);
    assert_eq!(h.c.get_order_book(NOV.to_string(), None).best_bid_micros, Some(U128(2_780_000)));
    h.call(&mm());
    h.c.cancel_order(NOV.to_string(), order_id);
    assert_eq!(h.free(&mm()), usdc(500));
}

#[test]
fn index_spike_purges_asks_below_the_5pct_band() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    let supply = h.short(&provider(), NOV, cu(300), 2_810_000, 210_750_000);
    h.now = T0 + HOUR;
    // Band floor at a $3.40 index = $3.23: the provider's $2.81 ask and the genesis $2.82/$2.86/$2.92 asks
    // would otherwise be picked off at a 14-17% discount.
    let out = h.attest(NOV, 3_400_000, T0 + HOUR - MINUTE, "spike-purges-asks");
    assert_eq!(out.purged_orders.len(), 4);
    assert!(out.purged_orders.contains(&supply.trade.resting_order_id.unwrap()));
    assert_eq!(h.c.get_order_book(NOV.to_string(), None).best_ask_micros, None);
    let vault = h.c.get_vault(supply.vault_id).unwrap();
    assert_eq!((vault.listed_cu_scaled.0, vault.listed_notional_micros.0), (0, 0));
    // Nothing open or listed any more: the provider can take its whole margin back.
    h.call(&provider());
    h.c.withdraw_excess_margin(NOV.to_string(), U128(210_750_000));
    assert_eq!(h.free(&provider()), usdc(1_000));
    // Genesis bids (below the index) are untouched.
    assert_eq!(h.c.get_order_book(NOV.to_string(), None).bids.len(), 3);
    assert!(h.invariants_hold(NOV));
}

#[test]
fn index_drop_purges_bids_above_the_5pct_band() {
    let mut h = Harness::new();
    h.deposit(&mm(), usdc(500));
    h.call(&mm());
    h.c.place_bid(NOV.to_string(), U128(cu(50)), U128(2_780_000));
    assert_eq!(h.free(&mm()), usdc(500) - 139_000_000);
    h.now = T0 + HOUR;
    // Band ceiling at a $2.40 index = $2.52: every resting bid ($2.78, $2.76, $2.72, $2.66) is refunded.
    let out = h.attest(NOV, 2_400_000, T0 + HOUR - MINUTE, "drop-purges-bids");
    assert_eq!(out.purged_orders.len(), 4);
    assert_eq!(h.free(&mm()), usdc(500));
    assert_eq!(h.free(&owner()), 414_000_000 + 680_000_000 + 1_064_000_000);
    assert_eq!(h.c.get_order_book(NOV.to_string(), None).best_bid_micros, None);
}

#[test]
fn stale_quote_protection_cancels_ask_that_would_breach_maintenance() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    h.short(&provider(), NOV, cu(300), 2_810_000, 210_750_000);
    h.deposit(&cfo(), usdc(2_000));
    h.guardrail(&cfo(), usdc(5_000), 150);
    h.buy(&cfo(), NOV, cu(200), 2_842_000);
    // The provider adds a $3.25 ask using its vault's excess margin plus 25% of the new notional.
    let late = h.short(&provider(), NOV, cu(10), 3_250_000, 8_125_000);
    h.now = T0 + HOUR;
    h.attest(NOV, 3_400_000, T0 + HOUR - MINUTE, "maintenance-stale");
    // A healthy third party quotes inside the band.
    let other = acc("jakarta-gpu.testnet");
    h.deposit(&other, usdc(100));
    h.short(&other, NOV, cu(10), 3_300_000, 8_250_000);
    // $3.25 survives the band (>= $3.23) but filling it would push the provider's already-losing vault
    // below 15% maintenance, so it is cancelled instead of filled; the healthy $3.30 ask fills.
    let trade = h.buy(&cfo(), NOV, cu(20), 3_451_000);
    assert_eq!(trade.stale_orders_cancelled, vec![late.trade.resting_order_id.unwrap()]);
    assert_eq!(trade.filled_cu_scaled.0, cu(10));
    assert_eq!(trade.fills[0].maker_id, other);
    assert!(h.invariants_hold(NOV));
}

// ---------------------------------------------------------------------------------------------
// 12-15. OutLayer attestations
// ---------------------------------------------------------------------------------------------

#[test]
fn outlayer_ed25519_attestation_updates_index() {
    let mut h = Harness::new();
    h.now = T0 + 2 * HOUR;
    let out = h.attest(NOV, 3_050_000, T0 + 2 * HOUR - 10 * MINUTE, "cri-h100-window-1");
    assert_eq!(out.previous_twap_micros.0, 2_800_000);
    assert_eq!(out.twap_micros.0, 3_050_000);
    assert!(out.flagged_vaults.is_empty());
    let series = h.c.get_series(NOV.to_string()).unwrap();
    assert_eq!(series.index_twap_usdc_micros.0, 3_050_000);
    assert_eq!(series.last_tee_attestation_hash, quote_hash("cri-h100-window-1"));
    assert_eq!(series.index_observed_at_ms, T0 + 2 * HOUR - 10 * MINUTE);
}

#[test]
#[should_panic(expected = "invalid OutLayer TEE signature")]
fn outlayer_invalid_signature_rejected() {
    let mut h = Harness::new();
    h.now = T0 + HOUR;
    let hash = quote_hash("forged");
    // Signed by an attacker key instead of the registered enclave key.
    let forged = SigningKey::from_bytes(&[9u8; 32]);
    let message = index_attestation_message(NOV, 9_000_000, T0 + 50 * MINUTE, &hash);
    let sig = hex::encode(forged.sign(message.as_bytes()).to_bytes());
    h.call(&relayer());
    h.c.submit_outlayer_index_attestation(NOV.into(), U128(9_000_000), T0 + 50 * MINUTE, hash, sig);
}

#[test]
#[should_panic(expected = "invalid OutLayer TEE signature")]
fn outlayer_tampered_twap_rejected() {
    let mut h = Harness::new();
    h.now = T0 + HOUR;
    let hash = quote_hash("tampered");
    let message = index_attestation_message(NOV, 3_000_000, T0 + 50 * MINUTE, &hash);
    let sig = hex::encode(tee_key().sign(message.as_bytes()).to_bytes());
    h.call(&relayer());
    // Relayer swaps the TWAP after signing.
    h.c.submit_outlayer_index_attestation(NOV.into(), U128(4_000_000), T0 + 50 * MINUTE, hash, sig);
}

#[test]
#[should_panic(expected = "TDX quote hash already consumed (replay)")]
fn outlayer_quote_hash_replay_rejected() {
    let mut h = Harness::new();
    h.now = T0 + HOUR;
    h.attest(NOV, 3_000_000, T0 + 40 * MINUTE, "replayed-quote");
    h.attest(NOV, 3_000_000, T0 + 50 * MINUTE, "replayed-quote");
}

#[test]
#[should_panic(expected = "attestation is stale")]
fn withheld_stale_attestation_rejected() {
    let mut h = Harness::new();
    h.now = T0 + 3 * HOUR;
    h.attest(NOV, 2_100_000, T0 + HOUR, "withheld");
}

#[test]
#[should_panic(expected = "circuit breaker")]
fn index_circuit_breaker_rejects_more_than_100pct_jump() {
    let mut h = Harness::new();
    h.now = T0 + HOUR;
    h.attest(NOV, 5_700_000, T0 + 50 * MINUTE, "jump");
}

// ---------------------------------------------------------------------------------------------
// 16-17. Mode A cash settlement
// ---------------------------------------------------------------------------------------------

fn mode_a_setup(margin_micros: u128) -> (Harness, VaultId) {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    let supply = h.short(&provider(), NOV, cu(100), 2_800_000, margin_micros);
    h.deposit(&cfo(), usdc(1_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    let trade = h.buy(&cfo(), NOV, cu(100), 2_842_000);
    assert_eq!(trade.avg_price_micros.0, 2_800_000);
    (h, supply.vault_id)
}

#[test]
fn mode_a_cash_settlement_when_index_spikes_2_80_to_4_10() {
    let (mut h, vault_id) = mode_a_setup(140_000_000); // 50% covered
    h.now = NOV_MATURITY + 5 * MINUTE;
    let out = h.attest(NOV, 4_100_000, NOV_MATURITY + MINUTE, "final-twap-spike");
    assert_eq!(out.flagged_vaults, vec![vault_id]);
    h.call(&cfo());
    let receipt = h.c.settle_cash_hedge(NOV.to_string(), U128(cu(100)));
    // ΔV = Q × (P_index − P_strike) = 100 × (4.10 − 2.80) = +$130; payout = $410.
    assert_eq!(receipt.payout_micros.0, 410_000_000);
    assert_eq!(receipt.hedge_pnl_micros, "130000000");
    assert_eq!(receipt.avg_entry_price_micros.0, 2_800_000);
    assert!(matches!(
        receipt.state,
        RedemptionState::CashSettledAtMaturity { index_price_micros: U128(4_100_000), payout_micros: U128(410_000_000), .. }
    ));
    assert_eq!(h.free(&cfo()), usdc(1_000) - 280_000_000 + 410_000_000);
    // Provider: escrow 280 + margin 140 - obligation 410 = $10 back.
    assert_eq!(h.free(&provider()), usdc(1_000) - 140_000_000 + 10_000_000);
    let series = h.c.get_series(NOV.to_string()).unwrap();
    assert!(series.is_settled);
    assert_eq!(series.final_settlement_price_micros, Some(U128(4_100_000)));
    assert_eq!(series.settlement_pool_micros.0, 0);
    assert_eq!(h.balance(&cfo(), NOV), 0);
    assert!(h.invariants_hold(NOV));
    assert_eq!(h.c.get_cash_settlement_receipts(None, None).len(), 1);
}

#[test]
fn mode_a_cash_settlement_when_index_drops_2_80_to_2_20() {
    let (mut h, _) = mode_a_setup(70_000_000); // exactly 25%
    h.now = NOV_MATURITY + 5 * MINUTE;
    h.attest(NOV, 2_200_000, NOV_MATURITY + MINUTE, "final-twap-drop");
    h.call(&cfo());
    let receipt = h.c.settle_cash_hedge(NOV.to_string(), U128(cu(100)));
    assert_eq!(receipt.payout_micros.0, 220_000_000);
    assert_eq!(receipt.hedge_pnl_micros, "-60000000");
    // Provider keeps the $0.60/CU hedge gain: 280 + 70 - 220 = $130 back on a $70 margin.
    assert_eq!(h.free(&provider()), usdc(1_000) - 70_000_000 + 130_000_000);
    assert!(h.invariants_hold(NOV));
}

#[test]
#[should_panic(expected = "series has not matured yet")]
fn mode_a_rejects_cash_settlement_before_maturity() {
    let (mut h, _) = mode_a_setup(70_000_000);
    h.now = T0 + HOUR;
    h.attest(NOV, 4_100_000, T0 + 50 * MINUTE, "early");
    h.call(&cfo());
    h.c.settle_cash_hedge(NOV.to_string(), U128(cu(100)));
}

// ---------------------------------------------------------------------------------------------
// 18-19. Liquidation below 15% maintenance
// ---------------------------------------------------------------------------------------------

#[test]
fn underwater_short_vault_liquidation_below_15pct_maintenance() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    let supply = h.short(&provider(), NOV, cu(300), 2_810_000, 210_750_000);
    h.deposit(&cfo(), usdc(1_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(200), 2_842_000);

    h.now = T0 + HOUR;
    let out = h.attest(NOV, 3_400_000, T0 + HOUR - MINUTE, "spike-3.40");
    assert_eq!(out.flagged_vaults, vec![supply.vault_id]);
    let health = h.c.check_vault_health(supply.vault_id);
    // equity = 210.75 - (680 - 562) = 92.75 -> 1363 bps < 1500 bps.
    assert_eq!(health.health_bps, Some(1_363));
    assert!(health.is_liquidatable);
    assert_eq!(health.liquidation_price_micros, Some(U128(3_359_782)));

    h.deposit(&mm(), usdc(1_000));
    h.call(&mm());
    let receipt = h.c.liquidate_underwater_vault(supply.vault_id);
    assert_eq!(receipt.realized_loss_micros.0, 118_000_000);
    assert_eq!(receipt.variation_from_collateral_micros.0, 118_000_000);
    assert_eq!(receipt.liquidator_bonus_micros.0, 17_000_000);
    assert_eq!(receipt.provider_refund_micros.0, 75_750_000);
    assert_eq!(receipt.rehedge_margin_micros.0, 170_000_000);
    assert_eq!(receipt.insurance_cover_micros.0, 0);

    let old = h.c.get_vault(supply.vault_id).unwrap();
    assert_eq!(old.status, VaultStatus::Liquidated);
    let absorbed = h.c.get_vault(receipt.liquidator_vault_id).unwrap();
    assert_eq!(absorbed.provider, mm());
    assert_eq!(absorbed.shorted_cu_scaled.0, cu(200));
    assert_eq!(absorbed.entry_price_micros.0, 3_400_000);
    assert_eq!(h.c.check_vault_health(receipt.liquidator_vault_id).health_bps, Some(2_500));
    assert_eq!(h.free(&provider()), usdc(1_000) - 210_750_000 + 75_750_000);
    assert_eq!(h.free(&mm()), usdc(1_000) - 170_000_000 + 17_000_000);
    // The provider's remaining $2.81 ask was already purged by the attestation's stale-quote band.
    assert_eq!(h.c.get_order_book(NOV.to_string(), None).best_ask_micros, None);
    assert!(h.invariants_hold(NOV));
    assert_eq!(h.c.get_liquidation_receipts(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "is not liquidatable")]
fn healthy_vault_cannot_be_liquidated() {
    let mut h = Harness::new();
    h.deposit(&provider(), usdc(1_000));
    let supply = h.short(&provider(), NOV, cu(100), 2_800_000, 70_000_000);
    h.deposit(&cfo(), usdc(1_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(100), 2_842_000);
    h.deposit(&mm(), usdc(1_000));
    h.call(&mm());
    h.c.liquidate_underwater_vault(supply.vault_id);
}

#[test]
fn insurance_pool_backstops_liquidation_bad_debt() {
    let mut h = Harness::new();
    h.fund_insurance(usdc(100));
    h.deposit(&provider(), usdc(1_000));
    let supply = h.short(&provider(), NOV, cu(200), 2_810_000, 140_500_000);
    h.deposit(&cfo(), usdc(1_000));
    h.guardrail(&cfo(), usdc(2_500), 150);
    h.buy(&cfo(), NOV, cu(200), 2_842_000);
    h.now = T0 + HOUR;
    h.attest(NOV, 3_700_000, T0 + 55 * MINUTE, "gap-3.70");
    h.deposit(&mm(), usdc(1_000));
    h.call(&mm());
    let receipt = h.c.liquidate_underwater_vault(supply.vault_id);
    // Loss 740 - 562 = 178 > 140.5 collateral -> 37.5 covered by insurance, longs stay fully backed.
    assert_eq!(receipt.insurance_cover_micros.0, 37_500_000);
    assert_eq!(receipt.uncovered_shortfall_micros.0, 0);
    assert_eq!(receipt.provider_refund_micros.0, 0);
    let absorbed = h.c.get_vault(receipt.liquidator_vault_id).unwrap();
    assert_eq!(absorbed.escrowed_proceeds_micros.0, 740_000_000);
    assert_eq!(h.c.protocol_stats().insurance_pool_micros.0, 62_500_000);
    assert!(h.invariants_hold(NOV));
}

// ---------------------------------------------------------------------------------------------
// 20-23. Mode B — OutLayer TEE redemption & deterministic SLA slashing
// ---------------------------------------------------------------------------------------------

#[test]
fn mode_b_tee_redemption_happy_path_pays_provider() {
    let mut h = mode_b_setup();
    h.call(&consumer());
    let request_id = h.c.request_compute_redemption(DEC.into(), provider(), U128(cu(24)));
    let request = h.c.get_redemption(request_id).unwrap();
    assert_eq!(request.strike_payment_micros.0, 70_800_000);
    assert_eq!(request.provider_collateral_micros.0, 17_700_000);
    assert_eq!(request.ack_deadline_ms, h.now + DEFAULT_ACK_WINDOW_MS);
    assert_eq!(request.delivery_deadline_ms, h.now + DEFAULT_DELIVERY_WINDOW_MS);
    assert_eq!(h.balance(&consumer(), DEC), cu(36));
    assert_eq!(h.balance(&contract_id(), DEC), cu(24));
    assert!(h.invariants_hold(DEC));

    h.now += 2 * MINUTE;
    h.call(&provider());
    h.c.acknowledge_redemption(request_id);
    h.now += 40 * MINUTE;
    let done = h.receipt(request_id, "job-1-h100x8", 180, true);
    assert!(matches!(done.state, RedemptionState::DeliveredViaTee { latency_ms: 180, .. }));
    assert_eq!(done.history.len(), 3);
    assert_eq!(h.free(&provider()), usdc(1_000) - 147_500_000 + 70_800_000 + 17_700_000);
    assert_eq!(h.c.mt_supply(DEC.into()), Some(U128(cu(36))));
    assert_eq!(h.balance(&contract_id(), DEC), 0);
    let stats = h.c.get_provider_stats(provider());
    assert_eq!((stats.delivered_count, stats.slashed_count, stats.reliability_bps), (1, 0, 10_000));
    assert_eq!(h.c.get_vault_by_provider(provider(), DEC.into()).unwrap().delivered_cu_scaled.0, cu(24));
    assert!(h.invariants_hold(DEC));
}

#[test]
fn mode_b_automatic_sla_slash_on_high_latency_receipt() {
    let mut h = mode_b_setup();
    h.call(&consumer());
    let request_id = h.c.request_compute_redemption(DEC.into(), provider(), U128(cu(16)));
    h.call(&provider());
    h.c.acknowledge_redemption(request_id);
    h.now += 30 * MINUTE;
    // Throttled GPU: TTFT 1,450 ms -> the enclave signs sla_met = false.
    let done = h.receipt(request_id, "job-2-throttled", 1_450, false);
    match &done.state {
        RedemptionState::SlashedForSlaBreach { reason, payout_micros, .. } => {
            assert_eq!(reason, "tee_receipt_sla_violation");
            // 100% refund of $47.20 + 15% penalty $7.08 from the provider's margin.
            assert_eq!(payout_micros.0, 54_280_000);
        }
        other => panic!("expected slash, got {other:?}"),
    }
    assert_eq!(h.free(&consumer()), usdc(500) - 177_000_000 + 54_280_000);
    assert_eq!(h.free(&provider()), usdc(1_000) - 147_500_000 + 4_720_000);
    let stats = h.c.get_provider_stats(provider());
    assert_eq!((stats.slashed_count, stats.penalties_paid_micros.0, stats.reliability_bps), (1, 7_080_000, 0));
    assert_eq!(h.c.get_vault_by_provider(provider(), DEC.into()).unwrap().slashed_count, 1);
    assert!(h.invariants_hold(DEC));
}

#[test]
fn mode_b_slash_when_latency_exceeds_onchain_ceiling() {
    let mut h = mode_b_setup();
    h.call(&consumer());
    let request_id = h.c.request_compute_redemption(DEC.into(), provider(), U128(cu(10)));
    // Even a receipt claiming sla_met is slashed if TTFT exceeds the on-chain 500 ms ceiling.
    let done = h.receipt(request_id, "job-latency", 900, true);
    assert!(matches!(&done.state, RedemptionState::SlashedForSlaBreach { reason, .. } if reason == "latency_exceeds_sla_ceiling"));
}

#[test]
fn mode_b_timeout_slash_after_ack_deadline_expiry() {
    let mut h = mode_b_setup();
    h.call(&consumer());
    let request_id = h.c.request_compute_redemption(DEC.into(), provider(), U128(cu(10)));
    h.now += DEFAULT_ACK_WINDOW_MS + MINUTE; // provider never acknowledged
    h.call(&relayer()); // permissionless
    let done = h.c.claim_sla_breach_slash(request_id);
    match &done.state {
        RedemptionState::SlashedForSlaBreach { reason, payout_micros, .. } => {
            assert_eq!(reason, "ack_deadline_missed");
            assert_eq!(payout_micros.0, 29_500_000 + 4_425_000);
        }
        other => panic!("expected slash, got {other:?}"),
    }
    assert_eq!(h.free(&consumer()), usdc(500) - 177_000_000 + 33_925_000);
    assert!(h.invariants_hold(DEC));
}

#[test]
#[should_panic(expected = "no SLA breach: deadlines have not expired")]
fn sla_claim_before_deadline_rejected() {
    let mut h = mode_b_setup();
    h.call(&consumer());
    let request_id = h.c.request_compute_redemption(DEC.into(), provider(), U128(cu(10)));
    h.call(&relayer());
    h.c.claim_sla_breach_slash(request_id);
}

// ---------------------------------------------------------------------------------------------
// USDC ledger & genesis credit
// ---------------------------------------------------------------------------------------------

#[test]
#[should_panic(expected = "withdrawals unlock once the genesis liquidity credit is funded")]
fn withdrawals_locked_until_genesis_credit_funded() {
    let mut h = Harness::new();
    h.deposit(&cfo(), usdc(100));
    h.call_yocto(&cfo());
    let _ = h.c.withdraw_usdc(U128(usdc(10)));
}

#[test]
fn genesis_funding_unlocks_withdrawals_and_failed_transfer_is_refunded() {
    let mut h = Harness::new();
    let outstanding = h.c.protocol_stats().genesis_credit_outstanding_micros.0;
    testing_env!(context(&usdc_token(), h.now, 0));
    let _ = h.c.ft_on_transfer(owner(), U128(outstanding + usdc(5)), r#"{"action":"fund_genesis"}"#.into());
    assert!(h.c.protocol_stats().withdrawals_enabled);
    assert_eq!(h.free(&owner()), usdc(5));

    // Treasury funds an agent directly (e.g. 1Click customRecipientMsg).
    testing_env!(context(&usdc_token(), h.now, 0));
    let _ = h.c.ft_on_transfer(
        treasury(),
        U128(usdc(100)),
        format!(r#"{{"action":"deposit","beneficiary":"{}"}}"#, cfo()),
    );
    assert_eq!(h.free(&cfo()), usdc(100));
    h.call_yocto(&cfo());
    let _ = h.c.withdraw_usdc(U128(usdc(40)));
    assert_eq!(h.free(&cfo()), usdc(60));
    // ft_transfer failed -> callback re-credits the internal balance.
    testing_env!(
        context(&contract_id(), h.now, 0),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!h.c.on_usdc_withdraw(cfo(), U128(usdc(40))));
    assert_eq!(h.free(&cfo()), usdc(100));
}

#[test]
#[should_panic(expected = "only the configured USDC token is accepted")]
fn foreign_token_deposit_rejected() {
    let mut h = Harness::new();
    testing_env!(context(&acc("scam-usdc.testnet"), h.now, 0));
    let _ = h.c.ft_on_transfer(cfo(), U128(usdc(1_000_000)), String::new());
}

// ---------------------------------------------------------------------------------------------
// End-to-end: attestations produced by the real OutLayer worker crate verify on-chain
// ---------------------------------------------------------------------------------------------

#[test]
fn outlayer_worker_attestations_and_receipts_verify_end_to_end() {
    use outlayer_cri_oracle::{scenario, EnclaveSigner, LocalSigner, SlaPolicy};
    let worker = LocalSigner::local_dev();
    // Register the worker's key in NEAR format, exactly as a deployment would.
    let mut h = Harness::with_tee_signer(outlayer_cri_oracle::near_public_key(&worker.public_key().unwrap()));

    // Index: the worker's outlier-clipped TWAP lands on-chain verbatim.
    let (_, series, target, end, spoof) = scenario::DEMO_INDEX_PATH[0];
    let attested = outlayer_cri_oracle::compute_cri_twap(&scenario::index_request(series, target, end, spoof), &worker).unwrap();
    h.now = end + MINUTE;
    h.call(&relayer());
    let out = h.c.submit_outlayer_index_attestation(
        series.to_string(),
        U128(attested.twap_micros as u128),
        attested.observed_at_ms,
        attested.tdx_quote_hash.clone(),
        attested.signature_hex.clone(),
    );
    assert_eq!(out.twap_micros.0, 2_800_000);
    assert_eq!(h.c.get_series(series.to_string()).unwrap().last_tee_attestation_hash, attested.tdx_quote_hash);

    // Mode B: the worker's signed SLA verdicts drive delivery and slashing.
    h.deposit(&provider(), usdc(1_000));
    h.short(&provider(), DEC, cu(200), 2_950_000, 147_500_000);
    h.deposit(&consumer(), usdc(500));
    h.guardrail(&consumer(), usdc(1_000), 150);
    h.buy(&consumer(), DEC, cu(60), 2_994_250);
    h.call(&consumer());
    let r1 = h.c.request_compute_redemption(DEC.into(), provider(), U128(cu(24)));
    h.call(&consumer());
    let r2 = h.c.request_compute_redemption(DEC.into(), provider(), U128(cu(16)));
    let sla = SlaPolicy::default();
    let happy = outlayer_cri_oracle::verify_inference_job(&scenario::happy_job(r1, h.now), &sla, &worker).unwrap();
    let throttled = outlayer_cri_oracle::verify_inference_job(&scenario::throttled_job(r2, h.now), &sla, &worker).unwrap();
    h.call(&provider());
    let done = h.c.finalize_redemption_with_tee_receipt(r1, happy.tdx_quote_hash, happy.measured_latency_ms, happy.sla_met, happy.signature_hex);
    assert!(matches!(done.state, RedemptionState::DeliveredViaTee { .. }));
    h.call(&consumer());
    let slashed = h.c.finalize_redemption_with_tee_receipt(
        r2,
        throttled.tdx_quote_hash,
        throttled.measured_latency_ms,
        throttled.sla_met,
        throttled.signature_hex,
    );
    assert!(matches!(slashed.state, RedemptionState::SlashedForSlaBreach { .. }));
    assert!(h.invariants_hold(DEC));
}
