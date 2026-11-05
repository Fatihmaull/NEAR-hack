//! Central limit order book per series with price-time priority.
//!
//! * Asks are always backed by a provider's isolated margin vault (`open_short_supply`).
//! * Bids escrow the full USDC notional (`place_bid`).
//! * Takers: `agent_buy_forward` (guardrailed IOC buy), `place_bid` (limit buy that may rest),
//!   `sell_forward` (long holders exit early into bids), `open_short_supply` (may cross bids).
//! * **Stale-quote protection**: before a resting ask is filled the engine simulates the fill on the
//!   backing vault at the attested index; if the vault would fall below 15% maintenance the ask is
//!   cancelled instead of filled, so a stale cheap ask can never under-collateralise new longs.
//! * **Stale-quote band**: each OutLayer attestation purges asks below `index × 0.95` and bids above
//!   `index × 1.05` (`purge_off_band_orders`), so resting depth never sits far through the attested index.
//! * Self-trade prevention: an account's own orders are skipped and a resting order may not cross the
//!   same account's opposite quote.

use crate::guardrails::PriceGuard;
use crate::*;
use std::collections::BTreeMap;

pub fn validate_order_params(qty: u128, price: u128) {
    require!(qty >= MIN_ORDER_CU_SCALED, "minimum order size is 1.00 CU (10000 scaled)");
    require!(price > 0 && price <= MAX_PRICE_MICROS, "price out of range (0, $1000] per CU");
}

/// Inserts keeping asks ascending / bids descending; equal prices keep FIFO (time priority).
pub fn insert_order(book: &mut OrderBook, order: Order) {
    match order.side {
        Side::Ask => {
            let pos = book.asks.iter().position(|o| o.price_micros.0 > order.price_micros.0).unwrap_or(book.asks.len());
            book.asks.insert(pos, order);
        }
        Side::Bid => {
            let pos = book.bids.iter().position(|o| o.price_micros.0 < order.price_micros.0).unwrap_or(book.bids.len());
            book.bids.insert(pos, order);
        }
    }
}

/// After matching, any opposite order still crossing `price` can only be the caller's own quote.
pub fn assert_no_self_cross(book: &OrderBook, side: Side, price: u128) {
    match side {
        Side::Ask => require!(
            book.bids.first().map_or(true, |b| b.price_micros.0 < price),
            "order would cross your own resting bid"
        ),
        Side::Bid => require!(
            book.asks.first().map_or(true, |a| a.price_micros.0 > price),
            "order would cross your own resting ask"
        ),
    }
}

pub fn remove_vault_asks(book: &mut OrderBook, vault_id: VaultId) -> Vec<Order> {
    let (removed, kept): (Vec<Order>, Vec<Order>) = book.asks.drain(..).partition(|o| o.vault_id == Some(vault_id));
    book.asks = kept;
    removed
}

pub struct SellMatch {
    pub fills: Vec<FillDetail>,
    pub filled: u128,
    pub notional: u128,
    /// Escrow dust returned to bidders whose orders were completely filled.
    pub refunds: Vec<(AccountId, u128)>,
}

/// Taker sell into resting bids priced at or above `min_price` (fills at the bid's price).
pub fn match_against_bids(book: &mut OrderBook, taker: &AccountId, qty: u128, min_price: u128) -> SellMatch {
    let mut out = SellMatch { fills: vec![], filled: 0, notional: 0, refunds: vec![] };
    let mut remaining = qty;
    let mut i = 0;
    while remaining > 0 && i < book.bids.len() {
        let bid = &mut book.bids[i];
        if bid.price_micros.0 < min_price {
            break;
        }
        if &bid.owner_id == taker {
            i += 1;
            continue;
        }
        let fill = remaining.min(bid.remaining_cu_scaled.0);
        let cost = notional(fill, bid.price_micros.0);
        bid.remaining_cu_scaled.0 -= fill;
        bid.escrow_micros.0 -= cost;
        out.fills.push(FillDetail {
            order_id: bid.order_id,
            maker_id: bid.owner_id.clone(),
            vault_id: None,
            price_micros: bid.price_micros,
            cu_scaled: U128(fill),
            notional_micros: U128(cost),
        });
        remaining -= fill;
        out.filled += fill;
        out.notional += cost;
        if bid.remaining_cu_scaled.0 == 0 {
            let done = book.bids.remove(i);
            if done.escrow_micros.0 > 0 {
                out.refunds.push((done.owner_id, done.escrow_micros.0));
            }
        } else {
            i += 1;
        }
    }
    out
}

pub struct BuyMatch {
    pub fills: Vec<FillDetail>,
    pub filled: u128,
    pub notional: u128,
    pub stale_cancelled: Vec<OrderId>,
    /// Updated copies of every vault touched (committed only if the whole call succeeds).
    pub vaults: BTreeMap<VaultId, ShortMarginVault>,
}

pub fn trade_report(
    series_id: &str,
    taker: &AccountId,
    side: Side,
    requested: u128,
    fills: &[FillDetail],
    resting_order_id: Option<OrderId>,
    stale_orders_cancelled: Vec<OrderId>,
) -> TradeReport {
    let filled: u128 = fills.iter().map(|f| f.cu_scaled.0).sum();
    let notional_total: u128 = fills.iter().map(|f| f.notional_micros.0).sum();
    TradeReport {
        series_id: series_id.to_string(),
        taker_id: taker.clone(),
        side,
        requested_cu_scaled: U128(requested),
        filled_cu_scaled: U128(filled),
        notional_micros: U128(notional_total),
        avg_price_micros: U128(if filled == 0 { 0 } else { notional_total * CU_SCALE / filled }),
        fills: fills.to_vec(),
        resting_order_id,
        stale_orders_cancelled,
    }
}

#[near]
impl ParonCore {
    /// Guardrailed immediate-or-cancel buy for autonomous agents (callable with a Function Call key).
    ///
    /// Enforces the agent's `AgentGuardrailPolicy` (pause, series allowlist, slippage band
    /// `max_price <= twap * (1 + max_slippage_bps)`, daily spend cap on the *filled* notional), matches
    /// the best asks, escrows the strike payments in the backing vaults and mints NEP-245 CU tokens.
    pub fn agent_buy_forward(&mut self, series_id: SeriesId, cu_amount_scaled: U128, max_price_micros: U128) -> TradeReport {
        let agent = env::predecessor_account_id();
        let mut series = self.series_or_panic(&series_id);
        Self::assert_tradable(&series);
        let (qty, max_price) = (cu_amount_scaled.0, max_price_micros.0);
        validate_order_params(qty, max_price);
        self.assert_agent_policy_compliant(&agent, &series, 0, PriceGuard::BuyAtMost(max_price), true);

        let mut book = self.book_of(&series_id);
        let matched = self.match_against_asks(&mut book, &agent, qty, max_price, series.index_twap_usdc_micros.0);
        require!(matched.filled > 0, "no ask liquidity within the limit price");
        self.assert_agent_policy_compliant(&agent, &series, matched.notional, PriceGuard::None, true);
        self.debit_usdc(&agent, matched.notional);

        let report = trade_report(&series_id, &agent, Side::Bid, qty, &matched.fills, None, matched.stale_cancelled.clone());
        self.commit_buy(&mut series, &agent, matched);
        self.books.insert(series_id.clone(), book);
        self.save_series(series);
        events::paron("forward_bought", json!({ "trade": report, "guardrailed": true }));
        report
    }

    /// Limit buy: crosses asks up to `price_micros`, the remainder rests as a fully escrowed bid.
    pub fn place_bid(&mut self, series_id: SeriesId, cu_amount_scaled: U128, price_micros: U128) -> TradeReport {
        let bidder = env::predecessor_account_id();
        let mut series = self.series_or_panic(&series_id);
        Self::assert_tradable(&series);
        let (qty, price) = (cu_amount_scaled.0, price_micros.0);
        validate_order_params(qty, price);
        self.assert_agent_policy_compliant(&bidder, &series, 0, PriceGuard::BuyAtMost(price), false);

        let mut book = self.book_of(&series_id);
        let matched = self.match_against_asks(&mut book, &bidder, qty, price, series.index_twap_usdc_micros.0);
        let remaining = qty - matched.filled;
        let resting_escrow = notional(remaining, price);
        let total_debit = matched.notional + resting_escrow;
        self.assert_agent_policy_compliant(&bidder, &series, total_debit, PriceGuard::None, false);
        self.debit_usdc(&bidder, total_debit);

        let mut resting_order_id = None;
        if remaining > 0 {
            assert_no_self_cross(&book, Side::Bid, price);
            require!(book.bids.len() < MAX_ORDERS_PER_SIDE, "bid side of the book is full");
            let order_id = self.take_order_id();
            insert_order(
                &mut book,
                Order {
                    order_id,
                    owner_id: bidder.clone(),
                    side: Side::Bid,
                    price_micros: U128(price),
                    original_cu_scaled: U128(remaining),
                    remaining_cu_scaled: U128(remaining),
                    escrow_micros: U128(resting_escrow),
                    vault_id: None,
                    created_at_ms: env::block_timestamp_ms(),
                },
            );
            resting_order_id = Some(order_id);
        }
        let report =
            trade_report(&series_id, &bidder, Side::Bid, qty, &matched.fills, resting_order_id, matched.stale_cancelled.clone());
        if matched.filled > 0 {
            self.commit_buy(&mut series, &bidder, matched);
        } else {
            for (_, vault) in matched.vaults {
                self.save_vault(vault);
            }
        }
        self.books.insert(series_id.clone(), book);
        self.save_series(series);
        events::paron("bid_placed", json!({ "trade": report }));
        report
    }

    /// Early exit for long holders: sell CU tokens into resting bids at or above `min_price_micros`.
    /// (Index cash settlement is only available at maturity, so longs hold no free option on the index.)
    pub fn sell_forward(&mut self, series_id: SeriesId, cu_amount_scaled: U128, min_price_micros: U128) -> TradeReport {
        let seller = env::predecessor_account_id();
        let mut series = self.series_or_panic(&series_id);
        Self::assert_tradable(&series);
        let (qty, min_price) = (cu_amount_scaled.0, min_price_micros.0);
        validate_order_params(qty, min_price);
        require!(self.mt_balance_internal(&series_id, &seller) >= qty, "insufficient CU balance to sell");
        self.assert_agent_policy_compliant(&seller, &series, 0, PriceGuard::SellAtLeast(min_price), false);

        let mut book = self.book_of(&series_id);
        let matched = match_against_bids(&mut book, &seller, qty, min_price);
        require!(matched.filled > 0, "no bid liquidity at or above the limit price");
        for fill in &matched.fills {
            self.move_tokens(&series_id, &seller, &fill.maker_id, fill.cu_scaled.0);
            self.position_remove(&series_id, &seller, fill.cu_scaled.0);
            self.position_add(&series_id, &fill.maker_id, fill.cu_scaled.0, fill.notional_micros.0);
            events::mt_transfer(&seller, &fill.maker_id, &[series_id.clone()], &[fill.cu_scaled.0], Some("sell_forward"));
        }
        self.credit_usdc(&seller, matched.notional);
        for (account, refund) in &matched.refunds {
            self.credit_usdc(account, *refund);
        }
        if let Some(last) = matched.fills.last() {
            series.mark_price_usdc_micros = last.price_micros;
        }
        series.total_volume_cu.0 += matched.filled;
        let report = trade_report(&series_id, &seller, Side::Ask, qty, &matched.fills, None, vec![]);
        self.books.insert(series_id.clone(), book);
        self.save_series(series);
        events::paron("forward_sold", json!({ "trade": report }));
        report
    }

    /// Cancel a resting order. Bids refund their escrow; asks release the vault listing.
    pub fn cancel_order(&mut self, series_id: SeriesId, order_id: OrderId) -> Order {
        let caller = env::predecessor_account_id();
        let mut book = self.book_of(&series_id);
        let order = if let Some(pos) = book.bids.iter().position(|o| o.order_id == order_id) {
            require!(book.bids[pos].owner_id == caller, "only the order owner may cancel");
            let order = book.bids.remove(pos);
            self.credit_usdc(&caller, order.escrow_micros.0);
            order
        } else if let Some(pos) = book.asks.iter().position(|o| o.order_id == order_id) {
            require!(book.asks[pos].owner_id == caller, "only the order owner may cancel");
            let order = book.asks.remove(pos);
            let vault_id = order.vault_id.unwrap_or_else(|| env::panic_str("ask without vault"));
            let mut vault = self.vault_or_panic(vault_id);
            margin::release_listing(&mut vault, order.remaining_cu_scaled.0, order.price_micros.0);
            self.save_vault(vault);
            order
        } else {
            env::panic_str("order not found");
        };
        self.books.insert(series_id.clone(), book);
        events::paron(
            "order_cancelled",
            json!({ "series_id": series_id, "order_id": order_id, "owner_id": caller }),
        );
        order
    }

    pub fn get_order_book(&self, series_id: SeriesId, depth: Option<u32>) -> OrderBookView {
        let series = self.series_or_panic(&series_id);
        let book = self.book_of(&series_id);
        let depth = depth.unwrap_or(10) as usize;
        let levels = |orders: &[Order]| -> Vec<PriceLevel> {
            let mut out: Vec<PriceLevel> = Vec::new();
            for o in orders {
                match out.last_mut() {
                    Some(level) if level.price_micros == o.price_micros => {
                        level.cu_scaled.0 += o.remaining_cu_scaled.0;
                        level.orders += 1;
                    }
                    _ => {
                        if out.len() == depth {
                            break;
                        }
                        out.push(PriceLevel { price_micros: o.price_micros, cu_scaled: o.remaining_cu_scaled, orders: 1 });
                    }
                }
            }
            out
        };
        OrderBookView {
            series_id,
            bids: levels(&book.bids),
            asks: levels(&book.asks),
            best_bid_micros: book.bids.first().map(|o| o.price_micros),
            best_ask_micros: book.asks.first().map(|o| o.price_micros),
            index_twap_usdc_micros: series.index_twap_usdc_micros,
        }
    }

    pub fn get_open_orders(&self, series_id: SeriesId, account_id: AccountId) -> Vec<Order> {
        let book = self.book_of(&series_id);
        book.bids.into_iter().chain(book.asks).filter(|o| o.owner_id == account_id).collect()
    }

    pub fn get_raw_order_book(&self, series_id: SeriesId) -> OrderBook {
        self.book_of(&series_id)
    }
}

impl ParonCore {
    /// Taker buy against resting asks priced at or below `max_price` (fills at the ask's price), with
    /// stale-quote protection evaluated at the attested `mark`.
    pub(crate) fn match_against_asks(
        &self,
        book: &mut OrderBook,
        taker: &AccountId,
        qty: u128,
        max_price: u128,
        mark: u128,
    ) -> BuyMatch {
        let mut out = BuyMatch { fills: vec![], filled: 0, notional: 0, stale_cancelled: vec![], vaults: BTreeMap::new() };
        let mut remaining = qty;
        let mut i = 0;
        while remaining > 0 && i < book.asks.len() {
            let ask = book.asks[i].clone();
            let price = ask.price_micros.0;
            if price > max_price {
                break;
            }
            if &ask.owner_id == taker {
                i += 1;
                continue;
            }
            let vault_id = ask.vault_id.unwrap_or_else(|| env::panic_str("ask without backing vault"));
            if !out.vaults.contains_key(&vault_id) {
                out.vaults.insert(vault_id, self.vault_or_panic(vault_id));
            }
            let vault = out.vaults.get_mut(&vault_id).unwrap();
            let fill = remaining.min(ask.remaining_cu_scaled.0);
            let cost = notional(fill, price);
            let mut simulated = vault.clone();
            margin::apply_ask_fill(&mut simulated, fill, price, ask.remaining_cu_scaled.0, cost);
            if !margin::meets_maintenance_margin(&simulated, mark) {
                let stale = book.asks.remove(i);
                margin::release_listing(vault, stale.remaining_cu_scaled.0, stale.price_micros.0);
                out.stale_cancelled.push(stale.order_id);
                continue;
            }
            *vault = simulated;
            out.fills.push(FillDetail {
                order_id: ask.order_id,
                maker_id: ask.owner_id.clone(),
                vault_id: Some(vault_id),
                price_micros: ask.price_micros,
                cu_scaled: U128(fill),
                notional_micros: U128(cost),
            });
            remaining -= fill;
            out.filled += fill;
            out.notional += cost;
            book.asks[i].remaining_cu_scaled.0 -= fill;
            if book.asks[i].remaining_cu_scaled.0 == 0 {
                book.asks.remove(i);
            } else {
                i += 1;
            }
        }
        out
    }

    /// Cancels resting orders outside the stale-quote band around a freshly attested `index`.
    pub(crate) fn purge_off_band_orders(&mut self, series_id: &str, index: u128) -> Vec<OrderId> {
        let mut book = self.book_of(series_id);
        let ask_floor = index * (BPS - STALE_QUOTE_BAND_BPS) / BPS;
        let bid_ceiling = index * (BPS + STALE_QUOTE_BAND_BPS) / BPS;
        let mut purged = Vec::new();
        let (stale_asks, asks): (Vec<Order>, Vec<Order>) = book.asks.drain(..).partition(|o| o.price_micros.0 < ask_floor);
        let (stale_bids, bids): (Vec<Order>, Vec<Order>) = book.bids.drain(..).partition(|o| o.price_micros.0 > bid_ceiling);
        book.asks = asks;
        book.bids = bids;
        for order in stale_asks {
            let vault_id = order.vault_id.unwrap_or_else(|| env::panic_str("ask without vault"));
            let mut vault = self.vault_or_panic(vault_id);
            margin::release_listing(&mut vault, order.remaining_cu_scaled.0, order.price_micros.0);
            self.save_vault(vault);
            purged.push(order.order_id);
        }
        for order in stale_bids {
            self.credit_usdc(&order.owner_id, order.escrow_micros.0);
            purged.push(order.order_id);
        }
        if !purged.is_empty() {
            self.books.insert(series_id.to_string(), book);
            events::paron(
                "stale_quotes_purged",
                json!({ "series_id": series_id, "index_micros": index.to_string(), "order_ids": purged }),
            );
        }
        purged
    }

    pub(crate) fn commit_buy(&mut self, series: &mut ComputeSeries, buyer: &AccountId, matched: BuyMatch) {
        for (_, vault) in matched.vaults {
            self.save_vault(vault);
        }
        self.internal_mint(&series.series_id, buyer, matched.filled, Some("forward fill"));
        self.position_add(&series.series_id, buyer, matched.filled, matched.notional);
        if let Some(last) = matched.fills.last() {
            series.mark_price_usdc_micros = last.price_micros;
        }
        series.total_volume_cu.0 += matched.filled;
    }
}
