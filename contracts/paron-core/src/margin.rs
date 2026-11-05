//! Capital-efficient short margin engine.
//!
//! Legacy Paron v1 forced providers to post a 150% cash bond to pre-sell compute. Paron v2 vaults post
//! **25% initial margin** and are liquidatable below **15% maintenance**:
//!
//! ```text
//! obligation(P)   = Q * P                    (what the open short owes longs at mark P)
//! unrealized_loss = max(0, obligation(P) - X) (X = escrowed strike payments of the longs)
//! equity(P)       = C - unrealized_loss       (C = locked collateral)
//! initial  : equity >= 25% * (Q*P + resting ask notional)
//! maintain : equity >= 15% * Q*P              (else permissionless liquidation)
//! P_liq    = (C + X) / (1.15 * Q)
//! ```
//!
//! Liquidation transfers the whole obligation to the liquidator's vault at the attested mark:
//! the realised loss moves from the old collateral into the obligation's escrow (insurance covers
//! bad debt), the liquidator posts fresh 25% margin and earns a 2.5% bonus, and the provider gets the
//! remaining equity back. Longs stay fully backed throughout.

use crate::guardrails::PriceGuard;
use crate::*;

// ---------------------------------------------------------------------------------------------
// Pure vault math (mirrored 1:1 in agents/src/engine/math.ts)
// ---------------------------------------------------------------------------------------------

pub fn obligation_at(vault: &ShortMarginVault, mark: u128) -> u128 {
    notional(vault.shorted_cu_scaled.0, mark)
}

pub fn unrealized_loss(vault: &ShortMarginVault, mark: u128) -> u128 {
    obligation_at(vault, mark).saturating_sub(vault.escrowed_proceeds_micros.0)
}

/// `(equity, deficit)` — exactly one of them is non-zero unless both are zero.
pub fn vault_equity(vault: &ShortMarginVault, mark: u128) -> (u128, u128) {
    let loss = unrealized_loss(vault, mark);
    let collateral = vault.locked_collateral_micros.0;
    if collateral >= loss {
        (collateral - loss, 0)
    } else {
        (0, loss - collateral)
    }
}

pub fn health_bps(vault: &ShortMarginVault, mark: u128) -> Option<u128> {
    let obligation = obligation_at(vault, mark);
    if vault.shorted_cu_scaled.0 == 0 || obligation == 0 {
        return None;
    }
    Some(vault_equity(vault, mark).0 * BPS / obligation)
}

pub fn required_initial_margin(vault: &ShortMarginVault, mark: u128) -> u128 {
    apply_bps(obligation_at(vault, mark) + vault.listed_notional_micros.0, INITIAL_MARGIN_BPS)
}

pub fn required_maintenance_margin(vault: &ShortMarginVault, mark: u128) -> u128 {
    apply_bps(obligation_at(vault, mark), MAINTENANCE_MARGIN_BPS)
}

pub fn meets_initial_margin(vault: &ShortMarginVault, mark: u128) -> bool {
    vault_equity(vault, mark).0 >= required_initial_margin(vault, mark)
}

pub fn meets_maintenance_margin(vault: &ShortMarginVault, mark: u128) -> bool {
    vault.shorted_cu_scaled.0 == 0 || vault_equity(vault, mark).0 >= required_maintenance_margin(vault, mark)
}

pub fn is_liquidatable(vault: &ShortMarginVault, mark: u128) -> bool {
    vault.status == VaultStatus::Active && vault.shorted_cu_scaled.0 > 0 && !meets_maintenance_margin(vault, mark)
}

/// Mark price at which the vault reaches exactly 15% maintenance.
pub fn liquidation_price(vault: &ShortMarginVault) -> Option<u128> {
    let q = vault.shorted_cu_scaled.0;
    if q == 0 {
        return None;
    }
    let backing = vault.locked_collateral_micros.0 + vault.escrowed_proceeds_micros.0;
    Some(backing * CU_SCALE * BPS / (q * (BPS + MAINTENANCE_MARGIN_BPS)))
}

pub fn refresh_entry_price(vault: &mut ShortMarginVault) {
    let q = vault.shorted_cu_scaled.0;
    vault.entry_price_micros = U128(if q == 0 { 0 } else { vault.escrowed_proceeds_micros.0 * CU_SCALE / q });
}

/// Applies a fill of `fill` CU against one of the vault's resting asks (`ask_remaining_before` at `price`).
pub fn apply_ask_fill(vault: &mut ShortMarginVault, fill: u128, price: u128, ask_remaining_before: u128, cost: u128) {
    vault.shorted_cu_scaled.0 += fill;
    vault.escrowed_proceeds_micros.0 += cost;
    vault.listed_cu_scaled.0 -= fill;
    let released = notional(ask_remaining_before, price) - notional(ask_remaining_before - fill, price);
    vault.listed_notional_micros.0 -= released;
    refresh_entry_price(vault);
}

/// Removes a resting ask (`remaining` at `price`) from the vault's listing.
pub fn release_listing(vault: &mut ShortMarginVault, remaining: u128, price: u128) {
    vault.listed_cu_scaled.0 -= remaining;
    vault.listed_notional_micros.0 -= notional(remaining, price);
}

pub fn vault_health(vault: &ShortMarginVault, mark: u128) -> VaultHealth {
    let (equity, deficit) = vault_equity(vault, mark);
    let required_initial = required_initial_margin(vault, mark);
    VaultHealth {
        vault_id: vault.vault_id,
        series_id: vault.series_id.clone(),
        provider: vault.provider.clone(),
        mark_price_micros: U128(mark),
        open_notional_micros: U128(obligation_at(vault, mark)),
        unrealized_loss_micros: U128(unrealized_loss(vault, mark)),
        equity_micros: U128(equity),
        deficit_micros: U128(deficit),
        health_bps: health_bps(vault, mark).map(|h| h.min(u32::MAX as u128) as u32),
        required_initial_margin_micros: U128(required_initial),
        required_maintenance_margin_micros: U128(required_maintenance_margin(vault, mark)),
        excess_collateral_micros: U128(equity.saturating_sub(required_initial)),
        liquidation_price_micros: liquidation_price(vault).map(U128),
        is_liquidatable: is_liquidatable(vault, mark),
    }
}

#[near]
impl ParonCore {
    /// Pre-sell `cu_amount_scaled` of a series at `ask_price_micros` backed by at least 25% initial
    /// margin. The order first crosses resting bids at or above the ask (maker price), and the remainder
    /// rests on the CLOB backed by the provider's isolated vault for that series.
    pub fn open_short_supply(
        &mut self,
        series_id: SeriesId,
        cu_amount_scaled: U128,
        ask_price_micros: U128,
        margin_deposit_micros: U128,
    ) -> ShortSupplyOutcome {
        let provider = env::predecessor_account_id();
        let mut series = self.series_or_panic(&series_id);
        Self::assert_tradable(&series);
        let (qty, price, deposit) = (cu_amount_scaled.0, ask_price_micros.0, margin_deposit_micros.0);
        orderbook::validate_order_params(qty, price);
        self.assert_agent_policy_compliant(&provider, &series, deposit, PriceGuard::SellAtLeast(price), false);
        self.debit_usdc(&provider, deposit);

        let mark = series.index_twap_usdc_micros.0;
        let mut vault = self.load_or_create_vault(&provider, &series_id);
        vault.locked_collateral_micros.0 += deposit;

        let mut book = self.book_of(&series_id);
        let sell = orderbook::match_against_bids(&mut book, &provider, qty, price);
        for fill in &sell.fills {
            vault.shorted_cu_scaled.0 += fill.cu_scaled.0;
            vault.escrowed_proceeds_micros.0 += fill.notional_micros.0;
            self.internal_mint(&series_id, &fill.maker_id, fill.cu_scaled.0, Some("bid filled by short supply"));
            self.position_add(&series_id, &fill.maker_id, fill.cu_scaled.0, fill.notional_micros.0);
        }
        for (account, refund) in &sell.refunds {
            self.credit_usdc(account, *refund);
        }

        let remaining = qty - sell.filled;
        let mut resting_order_id = None;
        if remaining > 0 {
            orderbook::assert_no_self_cross(&book, Side::Ask, price);
            require!(book.asks.len() < MAX_ORDERS_PER_SIDE, "ask side of the book is full");
            let order_id = self.take_order_id();
            vault.listed_cu_scaled.0 += remaining;
            vault.listed_notional_micros.0 += notional(remaining, price);
            orderbook::insert_order(
                &mut book,
                Order {
                    order_id,
                    owner_id: provider.clone(),
                    side: Side::Ask,
                    price_micros: U128(price),
                    original_cu_scaled: U128(remaining),
                    remaining_cu_scaled: U128(remaining),
                    escrow_micros: U128(0),
                    vault_id: Some(vault.vault_id),
                    created_at_ms: env::block_timestamp_ms(),
                },
            );
            resting_order_id = Some(order_id);
        }

        refresh_entry_price(&mut vault);
        let required = required_initial_margin(&vault, mark);
        let (equity, _) = vault_equity(&vault, mark);
        require!(
            equity >= required,
            format!("insufficient initial margin: 25% requirement is {required} micros, vault equity is {equity}")
        );

        if let Some(last) = sell.fills.last() {
            series.mark_price_usdc_micros = last.price_micros;
        }
        series.total_volume_cu.0 += sell.filled;
        let vault_id = vault.vault_id;
        self.save_vault(vault);
        self.books.insert(series_id.clone(), book);
        self.save_series(series);

        let trade = orderbook::trade_report(&series_id, &provider, Side::Ask, qty, &sell.fills, resting_order_id, vec![]);
        events::paron(
            "short_supply_opened",
            json!({
                "provider": provider,
                "series_id": series_id,
                "vault_id": vault_id,
                "cu_amount_scaled": qty.to_string(),
                "ask_price_micros": price.to_string(),
                "margin_deposit_micros": deposit.to_string(),
                "required_initial_margin_micros": required.to_string(),
                "filled_cu_scaled": sell.filled.to_string(),
                "resting_order_id": resting_order_id,
            }),
        );
        ShortSupplyOutcome {
            vault_id,
            trade,
            margin_deposit_micros: U128(deposit),
            required_initial_margin_micros: U128(required),
            vault_equity_micros: U128(equity),
        }
    }

    /// Add collateral to the caller's vault for `series_id` (used by agents' risk loops on margin calls).
    pub fn top_up_margin(&mut self, series_id: SeriesId, amount_micros: U128) -> VaultHealth {
        let provider = env::predecessor_account_id();
        let series = self.series_or_panic(&series_id);
        require!(!series.is_settled, "series already settled");
        require!(amount_micros.0 > 0, "amount must be positive");
        let vault_id = self
            .find_vault_id(&provider, &series_id)
            .unwrap_or_else(|| env::panic_str("no margin vault for caller in this series"));
        let mut vault = self.vault_or_panic(vault_id);
        require!(vault.status == VaultStatus::Active, "vault is not active");
        self.assert_agent_policy_compliant(&provider, &series, amount_micros.0, PriceGuard::None, false);
        self.debit_usdc(&provider, amount_micros.0);
        vault.locked_collateral_micros.0 += amount_micros.0;
        let health = vault_health(&vault, series.index_twap_usdc_micros.0);
        self.save_vault(vault);
        events::paron(
            "margin_topped_up",
            json!({ "vault_id": vault_id, "provider": provider, "amount_micros": amount_micros.0.to_string() }),
        );
        health
    }

    /// Withdraw collateral above the 25% initial requirement back to the free USDC balance.
    pub fn withdraw_excess_margin(&mut self, series_id: SeriesId, amount_micros: U128) -> VaultHealth {
        let provider = env::predecessor_account_id();
        let series = self.series_or_panic(&series_id);
        let vault_id = self
            .find_vault_id(&provider, &series_id)
            .unwrap_or_else(|| env::panic_str("no margin vault for caller in this series"));
        let mut vault = self.vault_or_panic(vault_id);
        require!(vault.status == VaultStatus::Active, "vault is not active");
        let amount = amount_micros.0;
        require!(amount > 0 && amount <= vault.locked_collateral_micros.0, "invalid withdrawal amount");
        vault.locked_collateral_micros.0 -= amount;
        let mark = series.index_twap_usdc_micros.0;
        require!(meets_initial_margin(&vault, mark), "withdrawal would breach the 25% initial margin requirement");
        self.credit_usdc(&provider, amount);
        let health = vault_health(&vault, mark);
        self.save_vault(vault);
        events::paron(
            "margin_withdrawn",
            json!({ "vault_id": vault_id, "provider": provider, "amount_micros": amount.to_string() }),
        );
        health
    }

    /// Permissionless liquidation of a vault below 15% maintenance at the attested index.
    /// The caller re-hedges by absorbing the obligation at the mark with fresh 25% margin.
    pub fn liquidate_underwater_vault(&mut self, vault_id: VaultId) -> LiquidationReceipt {
        let liquidator = env::predecessor_account_id();
        let mut vault = self.vault_or_panic(vault_id);
        let series_id = vault.series_id.clone();
        let series = self.series_or_panic(&series_id);
        Self::assert_tradable(&series);
        require!(liquidator != vault.provider, "providers cannot self-liquidate; top up margin instead");
        let mark = series.index_twap_usdc_micros.0;
        require!(
            is_liquidatable(&vault, mark),
            format!(
                "vault {vault_id} is not liquidatable: health {} bps vs 1500 bps maintenance",
                health_bps(&vault, mark).unwrap_or(u128::MAX)
            )
        );
        let health_before = health_bps(&vault, mark).unwrap_or(0) as u32;
        let entry_before = vault.entry_price_micros.0;
        let q = vault.shorted_cu_scaled.0;
        let escrow = vault.escrowed_proceeds_micros.0;
        let collateral = vault.locked_collateral_micros.0;
        let obligation = notional(q, mark);
        let loss = obligation.saturating_sub(escrow);
        let variation = loss.min(collateral);
        let shortfall = loss - variation;
        let insurance_cover = shortfall.min(self.insurance_pool_micros);
        self.insurance_pool_micros -= insurance_cover;
        let uncovered = shortfall - insurance_cover;
        let remaining = collateral - variation;
        let bonus = remaining.min(apply_bps(obligation, LIQUIDATION_BONUS_BPS));
        let provider_refund = remaining - bonus;
        let rehedge_margin = apply_bps(obligation, INITIAL_MARGIN_BPS);

        self.assert_agent_policy_compliant(&liquidator, &series, rehedge_margin, PriceGuard::None, false);
        self.debit_usdc(&liquidator, rehedge_margin);

        let mut book = self.book_of(&series_id);
        orderbook::remove_vault_asks(&mut book, vault_id);

        let mut absorbing = self.load_or_create_vault(&liquidator, &series_id);
        absorbing.shorted_cu_scaled.0 += q;
        absorbing.escrowed_proceeds_micros.0 += escrow + variation + insurance_cover;
        absorbing.locked_collateral_micros.0 += rehedge_margin;
        refresh_entry_price(&mut absorbing);
        require!(
            meets_initial_margin(&absorbing, mark),
            "liquidator vault would breach initial margin after absorbing the position; top up first"
        );
        let liquidator_vault_id = absorbing.vault_id;

        let provider = vault.provider.clone();
        vault.shorted_cu_scaled = U128(0);
        vault.escrowed_proceeds_micros = U128(0);
        vault.locked_collateral_micros = U128(0);
        vault.listed_cu_scaled = U128(0);
        vault.listed_notional_micros = U128(0);
        vault.status = VaultStatus::Liquidated;
        self.credit_usdc(&provider, provider_refund);
        self.credit_usdc(&liquidator, bonus);
        self.save_vault(vault);
        self.save_vault(absorbing);
        self.books.insert(series_id.clone(), book);

        let receipt = LiquidationReceipt {
            receipt_id: self.liquidation_receipts.len() as u64,
            vault_id,
            series_id: series_id.clone(),
            provider,
            liquidator,
            liquidator_vault_id,
            cu_transferred_scaled: U128(q),
            mark_price_micros: U128(mark),
            entry_price_before_micros: U128(entry_before),
            health_bps_before: health_before,
            realized_loss_micros: U128(loss),
            variation_from_collateral_micros: U128(variation),
            insurance_cover_micros: U128(insurance_cover),
            uncovered_shortfall_micros: U128(uncovered),
            liquidator_bonus_micros: U128(bonus),
            provider_refund_micros: U128(provider_refund),
            rehedge_margin_micros: U128(rehedge_margin),
            liquidated_at_ms: env::block_timestamp_ms(),
        };
        self.liquidation_receipts.push(receipt.clone());
        events::paron("vault_liquidated", json!({ "receipt": receipt }));
        receipt
    }

    pub fn check_vault_health(&self, vault_id: VaultId) -> VaultHealth {
        let vault = self.vault_or_panic(vault_id);
        let series = self.series_or_panic(&vault.series_id);
        vault_health(&vault, series.index_twap_usdc_micros.0)
    }

    pub fn get_vault(&self, vault_id: VaultId) -> Option<ShortMarginVault> {
        self.vaults.get(&vault_id).cloned()
    }

    pub fn get_vault_by_provider(&self, provider_id: AccountId, series_id: SeriesId) -> Option<ShortMarginVault> {
        self.find_vault_id(&provider_id, &series_id).and_then(|id| self.vaults.get(&id).cloned())
    }

    pub fn list_vaults(&self, series_id: SeriesId) -> Vec<ShortMarginVault> {
        self.vault_ids_of(&series_id).iter().filter_map(|id| self.vaults.get(id).cloned()).collect()
    }

    pub fn list_vault_health(&self, series_id: SeriesId) -> Vec<VaultHealth> {
        let series = self.series_or_panic(&series_id);
        let mark = series.index_twap_usdc_micros.0;
        self.vault_ids_of(&series_id)
            .iter()
            .filter_map(|id| self.vaults.get(id))
            .filter(|v| v.status == VaultStatus::Active)
            .map(|v| vault_health(v, mark))
            .collect()
    }

    /// Helper view for UIs and agents: 25% initial margin for a fresh short of `cu_amount_scaled` at `price_micros`.
    pub fn quote_initial_margin(&self, cu_amount_scaled: U128, price_micros: U128) -> U128 {
        U128(apply_bps(notional(cu_amount_scaled.0, price_micros.0), INITIAL_MARGIN_BPS))
    }
}
