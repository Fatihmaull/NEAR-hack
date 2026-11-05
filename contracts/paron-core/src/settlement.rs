//! Dual settlement engine — zero human verifiers, zero physical-delivery oracle.
//!
//! **OutLayer TEE index**: the `outlayer-cri-oracle` worker runs inside an Intel TDX enclave, computes
//! the outlier-clipped CRI-H100 TWAP and signs `"{series_id}:{twap_micros}:{observed_at_ms}:{tdx_quote_hash}"`
//! with its enclave Ed25519 key. Anyone may relay it; the contract verifies the signature with
//! `env::ed25519_verify`, rejects replays, stale or out-of-order observations and >100% jumps, then
//! sweeps vault health.
//!
//! **Mode A — cash settlement at maturity**: once an attestation observed at/after maturity lands, the
//! series is finalised: every vault pays `Q * P_final` from escrow + collateral (insurance backstops
//! shortfalls) into the settlement pool, and each long token redeems for `P_final`, so
//! `ΔV = Q × (P_index − P_strike)` exactly.
//!
//! **Mode B — direct compute drawdown via OutLayer TDX receipts**: an agent escrows CU against a
//! provider; the provider's job is measured inside the enclave, which signs
//! `"{request_id}:{tdx_quote_hash}:{measured_latency_ms}:{sla_met}"`. A clean receipt pays the provider;
//! an SLA violation or a missed deadline refunds 100% of the strike payment **plus a 15% penalty** taken
//! from the provider's margin.

use crate::guardrails::PriceGuard;
use crate::*;

/// Canonical message signed by the OutLayer enclave for index attestations.
pub fn index_attestation_message(series_id: &str, twap_micros: u128, observed_at_ms: u64, tdx_quote_hash: &str) -> String {
    format!("{series_id}:{twap_micros}:{observed_at_ms}:{tdx_quote_hash}")
}

/// Canonical message signed by the OutLayer enclave for Mode B execution receipts.
pub fn execution_receipt_message(request_id: RequestId, tdx_quote_hash: &str, measured_latency_ms: u32, sla_met: bool) -> String {
    format!("{request_id}:{tdx_quote_hash}:{measured_latency_ms}:{sla_met}")
}

#[near]
impl ParonCore {
    /// Relay an OutLayer TEE-attested CRI-H100 TWAP for `series_id` (permissionless; the enclave
    /// signature is the authority). Returns the vaults that are now below 15% maintenance.
    pub fn submit_outlayer_index_attestation(
        &mut self,
        series_id: SeriesId,
        twap_micros: U128,
        observed_at_ms: u64,
        tdx_quote_hash: String,
        signature_hex: String,
    ) -> AttestationOutcome {
        let mut series = self.series_or_panic(&series_id);
        require!(!series.is_settled, "series already settled");
        let twap = twap_micros.0;
        require!(twap > 0 && twap <= MAX_PRICE_MICROS, "attested TWAP out of range");
        let now = env::block_timestamp_ms();
        require!(observed_at_ms <= now + MAX_ATTESTATION_CLOCK_SKEW_MS, "attestation observed in the future");
        require!(now <= observed_at_ms + MAX_ATTESTATION_AGE_MS, "attestation is stale (older than 1 hour)");
        require!(observed_at_ms > series.index_observed_at_ms, "attestation is older than the current index");
        let message = index_attestation_message(&series_id, twap, observed_at_ms, &tdx_quote_hash);
        self.verify_tee_signature(&message, &signature_hex);
        self.consume_quote_hash(&tdx_quote_hash);

        let previous = series.index_twap_usdc_micros.0;
        require!(
            twap.abs_diff(previous) <= apply_bps(previous, MAX_INDEX_MOVE_BPS),
            "circuit breaker: attested index moved more than 100% in one update"
        );
        series.index_twap_usdc_micros = U128(twap);
        series.index_updated_at_ms = now;
        series.index_observed_at_ms = observed_at_ms;
        series.last_tee_attestation_hash = tdx_quote_hash.clone();

        let flagged: Vec<VaultId> = self
            .vault_ids_of(&series_id)
            .into_iter()
            .filter(|id| self.vaults.get(id).map_or(false, |v| margin::is_liquidatable(v, twap)))
            .collect();
        self.save_series(series);
        events::paron(
            "index_attested",
            json!({
                "series_id": series_id,
                "previous_twap_micros": previous.to_string(),
                "twap_micros": twap.to_string(),
                "observed_at_ms": observed_at_ms,
                "tdx_quote_hash": tdx_quote_hash,
                "flagged_vaults": flagged,
            }),
        );
        for vault_id in &flagged {
            events::paron("flag_liquidation_eligible", json!({ "series_id": series_id, "vault_id": vault_id }));
        }
        AttestationOutcome {
            series_id,
            previous_twap_micros: U128(previous),
            twap_micros: U128(twap),
            tdx_quote_hash,
            flagged_vaults: flagged,
        }
    }

    /// Permissionless: finalise a matured series against its post-maturity attested TWAP.
    pub fn finalize_series_settlement(&mut self, series_id: SeriesId) -> ComputeSeries {
        self.internal_finalize_series(&series_id);
        self.get_series(series_id).unwrap()
    }

    /// Mode A: burn `cu_amount_scaled` of the caller's CU tokens and receive `Q * P_final` in free USDC.
    pub fn settle_cash_hedge(&mut self, series_id: SeriesId, cu_amount_scaled: U128) -> CashSettlementReceipt {
        let account = env::predecessor_account_id();
        let qty = cu_amount_scaled.0;
        require!(qty > 0, "amount must be positive");
        self.internal_finalize_series(&series_id);
        let mut series = self.series_or_panic(&series_id);
        let final_price = series.final_settlement_price_micros.map(|p| p.0).unwrap();
        let pool = series.settlement_pool_micros.0;
        let pool_cu = series.settlement_pool_cu.0;
        require!(qty <= pool_cu, "amount exceeds the settleable supply");

        self.internal_burn(&series_id, &account, qty, Some("mode-a cash settlement"));
        let cost_basis = self.position_remove(&series_id, &account, qty);
        let full_value = notional(qty, final_price);
        let payout = if pool >= notional(pool_cu, final_price) { full_value.min(pool) } else { pool * qty / pool_cu };
        series.settlement_pool_micros = U128(pool - payout);
        series.settlement_pool_cu = U128(pool_cu - qty);
        self.credit_usdc(&account, payout);

        let now = env::block_timestamp_ms();
        let receipt = CashSettlementReceipt {
            receipt_id: self.cash_receipts.len() as u64,
            series_id: series_id.clone(),
            account_id: account,
            cu_amount_scaled: U128(qty),
            avg_entry_price_micros: U128(cost_basis * CU_SCALE / qty),
            cost_basis_micros: U128(cost_basis),
            index_price_micros: U128(final_price),
            payout_micros: U128(payout),
            hedge_pnl_micros: signed_string(payout, cost_basis),
            tdx_quote_hash: series.last_tee_attestation_hash.clone(),
            state: RedemptionState::CashSettledAtMaturity {
                settled_at_ms: now,
                index_price_micros: U128(final_price),
                payout_micros: U128(payout),
            },
        };
        self.cash_receipts.push(receipt.clone());
        self.save_series(series);
        events::paron("cash_settled", json!({ "receipt": receipt }));
        receipt
    }

    /// Mode B step 1: escrow CU tokens against `provider_id`'s open supply and start the SLA clock.
    pub fn request_compute_redemption(&mut self, series_id: SeriesId, provider_id: AccountId, cu_amount_scaled: U128) -> RequestId {
        let agent = env::predecessor_account_id();
        let series = self.series_or_panic(&series_id);
        Self::assert_tradable(&series);
        let qty = cu_amount_scaled.0;
        require!(qty >= MIN_ORDER_CU_SCALED, "minimum redemption is 1.00 CU");
        require!(agent != provider_id, "cannot redeem against yourself");
        self.assert_agent_policy_compliant(&agent, &series, 0, PriceGuard::None, false);
        let vault_id = self
            .find_vault_id(&provider_id, &series_id)
            .unwrap_or_else(|| env::panic_str("provider has no margin vault in this series"));
        let mut vault = self.vault_or_panic(vault_id);
        require!(
            vault.status == VaultStatus::Active && vault.shorted_cu_scaled.0 >= qty,
            "provider has insufficient open supply in this series"
        );

        let escrow_account = env::current_account_id();
        self.move_tokens(&series_id, &agent, &escrow_account, qty);
        events::mt_transfer(&agent, &escrow_account, &[series_id.clone()], &[qty], Some("mode-b redemption escrow"));
        let cost_basis = self.position_remove(&series_id, &agent, qty);

        let strike_payment = vault.escrowed_proceeds_micros.0 * qty / vault.shorted_cu_scaled.0;
        let collateral = apply_bps(strike_payment, INITIAL_MARGIN_BPS).min(vault.locked_collateral_micros.0);
        vault.shorted_cu_scaled.0 -= qty;
        vault.escrowed_proceeds_micros.0 -= strike_payment;
        vault.locked_collateral_micros.0 -= collateral;
        self.save_vault(vault);

        let now = env::block_timestamp_ms();
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        let state = RedemptionState::Requested { requested_at_ms: now, ack_deadline_ms: now + self.sla.ack_window_ms };
        let request = RedemptionRequest {
            request_id,
            series_id: series_id.clone(),
            agent_id: agent,
            provider_id,
            vault_id,
            cu_amount_scaled: U128(qty),
            strike_payment_micros: U128(strike_payment),
            provider_collateral_micros: U128(collateral),
            agent_cost_basis_micros: U128(cost_basis),
            requested_at_ms: now,
            ack_deadline_ms: now + self.sla.ack_window_ms,
            delivery_deadline_ms: now + self.sla.delivery_window_ms,
            state: state.clone(),
            history: vec![state],
        };
        events::paron("redemption_requested", json!({ "request": request }));
        self.redemptions.insert(request_id, request);
        request_id
    }

    /// Mode B: provider acknowledges the job before `ack_deadline_ms`.
    pub fn acknowledge_redemption(&mut self, request_id: RequestId) -> RedemptionRequest {
        let mut request = self.redemption_or_panic(request_id);
        require!(env::predecessor_account_id() == request.provider_id, "only the provider may acknowledge");
        let now = env::block_timestamp_ms();
        match request.state {
            RedemptionState::Requested { ack_deadline_ms, .. } => {
                require!(now <= ack_deadline_ms, "acknowledgement deadline has passed");
            }
            _ => env::panic_str("redemption is not awaiting acknowledgement"),
        }
        let state = RedemptionState::Acknowledged { ack_at_ms: now, delivery_deadline_ms: request.delivery_deadline_ms };
        request.state = state.clone();
        request.history.push(state);
        self.redemptions.insert(request_id, request.clone());
        events::paron("redemption_acknowledged", json!({ "request_id": request_id, "ack_at_ms": now }));
        request
    }

    /// Mode B step 2A: submit the OutLayer TDX execution receipt. A valid receipt that meets the SLA
    /// pays the provider; an SLA violation, a latency above the on-chain ceiling or a late delivery is
    /// slashed automatically.
    pub fn finalize_redemption_with_tee_receipt(
        &mut self,
        request_id: RequestId,
        tdx_quote_hash: String,
        measured_latency_ms: u32,
        sla_met: bool,
        worker_sig: String,
    ) -> RedemptionRequest {
        let mut request = self.redemption_or_panic(request_id);
        require!(!request.state.is_final(), "redemption already finalized");
        let message = execution_receipt_message(request_id, &tdx_quote_hash, measured_latency_ms, sla_met);
        self.verify_tee_signature(&message, &worker_sig);
        self.consume_quote_hash(&tdx_quote_hash);
        let now = env::block_timestamp_ms();
        let breach = match request.state {
            RedemptionState::Requested { ack_deadline_ms, .. } if now > ack_deadline_ms => Some("ack_deadline_missed"),
            _ if now > request.delivery_deadline_ms => Some("delivery_deadline_missed"),
            _ if !sla_met => Some("tee_receipt_sla_violation"),
            _ if measured_latency_ms > self.sla.max_sla_latency_ms => Some("latency_exceeds_sla_ceiling"),
            _ => None,
        };
        match breach {
            Some(reason) => self.execute_sla_slash(&mut request, reason),
            None => self.execute_delivery(&mut request, tdx_quote_hash, measured_latency_ms),
        }
        self.redemptions.insert(request_id, request.clone());
        request
    }

    /// Mode B step 2B: permissionless deterministic slash once the ack or delivery deadline expired.
    pub fn claim_sla_breach_slash(&mut self, request_id: RequestId) -> RedemptionRequest {
        let mut request = self.redemption_or_panic(request_id);
        require!(!request.state.is_final(), "redemption already finalized");
        let now = env::block_timestamp_ms();
        let reason = match request.state {
            RedemptionState::Requested { ack_deadline_ms, .. } if now > ack_deadline_ms => "ack_deadline_missed",
            RedemptionState::Acknowledged { delivery_deadline_ms, .. } if now > delivery_deadline_ms => {
                "delivery_deadline_missed"
            }
            _ => env::panic_str("no SLA breach: deadlines have not expired"),
        };
        self.execute_sla_slash(&mut request, reason);
        self.redemptions.insert(request_id, request.clone());
        request
    }

    pub fn get_redemption(&self, request_id: RequestId) -> Option<RedemptionRequest> {
        self.redemptions.get(&request_id).cloned()
    }

    pub fn get_redemptions(&self, from_request_id: Option<u64>, limit: Option<u64>) -> Vec<RedemptionRequest> {
        let from = from_request_id.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.next_request_id.min(from.saturating_add(limit)))
            .filter_map(|id| self.redemptions.get(&id).cloned())
            .collect()
    }
}

impl ParonCore {
    fn redemption_or_panic(&self, request_id: RequestId) -> RedemptionRequest {
        self.redemptions
            .get(&request_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("unknown redemption request {request_id}")))
    }

    pub(crate) fn internal_finalize_series(&mut self, series_id: &str) {
        let mut series = self.series_or_panic(series_id);
        if series.is_settled {
            return;
        }
        require!(
            env::block_timestamp_ms() >= series.maturity_timestamp_ms,
            "series has not matured yet; exit early by selling into the CLOB"
        );
        require!(
            series.index_observed_at_ms >= series.maturity_timestamp_ms,
            "final settlement requires an OutLayer TWAP attestation observed at or after maturity"
        );
        let final_price = series.index_twap_usdc_micros.0;

        let book = self.book_of(series_id);
        for bid in &book.bids {
            self.credit_usdc(&bid.owner_id, bid.escrow_micros.0);
        }
        self.books.insert(series_id.to_string(), OrderBook::default());

        let mut pool = 0u128;
        let mut pool_cu = 0u128;
        for vault_id in self.vault_ids_of(series_id) {
            let mut vault = self.vault_or_panic(vault_id);
            if vault.status != VaultStatus::Active {
                continue;
            }
            let qty = vault.shorted_cu_scaled.0;
            let available = vault.escrowed_proceeds_micros.0 + vault.locked_collateral_micros.0;
            let obligation = notional(qty, final_price);
            let (to_pool, refund, insurance_cover) = if available >= obligation {
                (obligation, available - obligation, 0)
            } else {
                let cover = (obligation - available).min(self.insurance_pool_micros);
                self.insurance_pool_micros -= cover;
                (available + cover, 0, cover)
            };
            pool += to_pool;
            pool_cu += qty;
            self.credit_usdc(&vault.provider, refund);
            events::paron(
                "vault_settled",
                json!({
                    "vault_id": vault_id,
                    "provider": vault.provider,
                    "series_id": series_id,
                    "settled_cu_scaled": qty.to_string(),
                    "final_price_micros": final_price.to_string(),
                    "obligation_micros": obligation.to_string(),
                    "provider_refund_micros": refund.to_string(),
                    "provider_hedge_pnl_micros": signed_string(vault.escrowed_proceeds_micros.0, obligation),
                    "insurance_cover_micros": insurance_cover.to_string(),
                }),
            );
            vault.shorted_cu_scaled = U128(0);
            vault.escrowed_proceeds_micros = U128(0);
            vault.locked_collateral_micros = U128(0);
            vault.listed_cu_scaled = U128(0);
            vault.listed_notional_micros = U128(0);
            vault.status = VaultStatus::Settled;
            self.save_vault(vault);
        }
        series.is_settled = true;
        series.final_settlement_price_micros = Some(U128(final_price));
        series.settlement_pool_micros = U128(pool);
        series.settlement_pool_cu = U128(pool_cu);
        events::paron(
            "series_settled",
            json!({
                "series_id": series_id,
                "final_settlement_price_micros": final_price.to_string(),
                "settlement_pool_micros": pool.to_string(),
                "settlement_pool_cu": pool_cu.to_string(),
            }),
        );
        self.save_series(series);
    }

    fn execute_delivery(&mut self, request: &mut RedemptionRequest, tdx_quote_hash: String, latency_ms: u32) {
        let qty = request.cu_amount_scaled.0;
        let escrow_account = env::current_account_id();
        self.internal_burn(&request.series_id, &escrow_account, qty, Some("mode-b delivered via OutLayer TEE"));
        let provider_payment = request.strike_payment_micros.0 + request.provider_collateral_micros.0;
        self.credit_usdc(&request.provider_id, provider_payment);
        if let Some(mut vault) = self.vaults.get(&request.vault_id).cloned() {
            vault.delivered_cu_scaled.0 += qty;
            vault.delivered_count += 1;
            self.save_vault(vault);
        }
        let mut stats = self.provider_stats_of(&request.provider_id);
        stats.delivered_count += 1;
        stats.delivered_cu_scaled.0 += qty;
        self.save_provider_stats(&request.provider_id, stats);
        let now = env::block_timestamp_ms();
        let state = RedemptionState::DeliveredViaTee { delivered_at_ms: now, tdx_quote_hash, latency_ms };
        request.state = state.clone();
        request.history.push(state);
        events::paron(
            "redemption_delivered",
            json!({
                "request_id": request.request_id,
                "provider_id": request.provider_id,
                "cu_amount_scaled": qty.to_string(),
                "provider_payment_micros": provider_payment.to_string(),
            }),
        );
    }

    fn execute_sla_slash(&mut self, request: &mut RedemptionRequest, reason: &str) {
        let qty = request.cu_amount_scaled.0;
        let escrow_account = env::current_account_id();
        self.internal_burn(&request.series_id, &escrow_account, qty, Some("mode-b sla slash"));
        let strike = request.strike_payment_micros.0;
        let collateral = request.provider_collateral_micros.0;
        let penalty_target = apply_bps(strike, SLA_BREACH_PENALTY_BPS);
        let from_collateral = penalty_target.min(collateral);
        let insurance_cover = (penalty_target - from_collateral).min(self.insurance_pool_micros);
        self.insurance_pool_micros -= insurance_cover;
        let payout = strike + from_collateral + insurance_cover;
        self.credit_usdc(&request.agent_id, payout);
        self.credit_usdc(&request.provider_id, collateral - from_collateral);
        if let Some(mut vault) = self.vaults.get(&request.vault_id).cloned() {
            vault.slashed_count += 1;
            self.save_vault(vault);
        }
        let mut stats = self.provider_stats_of(&request.provider_id);
        stats.slashed_count += 1;
        stats.slashed_cu_scaled.0 += qty;
        stats.penalties_paid_micros.0 += from_collateral;
        self.save_provider_stats(&request.provider_id, stats);
        let now = env::block_timestamp_ms();
        let state = RedemptionState::SlashedForSlaBreach {
            slashed_at_ms: now,
            reason: reason.to_string(),
            payout_micros: U128(payout),
        };
        request.state = state.clone();
        request.history.push(state);
        events::paron(
            "sla_slashed",
            json!({
                "request_id": request.request_id,
                "provider_id": request.provider_id,
                "agent_id": request.agent_id,
                "reason": reason,
                "refund_micros": strike.to_string(),
                "penalty_micros": (from_collateral + insurance_cover).to_string(),
                "payout_micros": payout.to_string(),
            }),
        );
    }
}
