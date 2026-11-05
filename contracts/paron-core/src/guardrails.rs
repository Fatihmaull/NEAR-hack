//! Autonomous agent guardrails.
//!
//! A treasury (Trezu / Sputnik DAO / multisig) registers an `AgentGuardrailPolicy` for each agent
//! account. The agent itself only holds a **NEAR Function Call access key** scoped to this contract
//! and to non-payable trading methods, so:
//! - it can trade, quote, redeem and settle — always inside the policy enforced here;
//! - it can never call `withdraw_usdc` / `mt_transfer*` / `configure_agent_guardrail`, which require
//!   1 yoctoNEAR and therefore a full-access key.
//!
//! Policy checks: pause switch, series allowlist, rolling UTC-day spend cap and a slippage band
//! around the OutLayer-attested CRI-H100 TWAP.

use crate::*;

/// Price constraint evaluated against the series' attested TWAP.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PriceGuard {
    /// Buying: limit price must be `<= twap * (1 + slippage)`.
    BuyAtMost(u128),
    /// Selling / shorting: limit price must be `>= twap * (1 - slippage)`.
    SellAtLeast(u128),
    None,
}

pub fn is_sub_account(child: &AccountId, parent: &AccountId) -> bool {
    child.as_str().len() > parent.as_str().len() && child.as_str().ends_with(&format!(".{}", parent.as_str()))
}

#[near]
impl ParonCore {
    /// Called once by the agent's own full-access key to designate a non-parent treasury as its
    /// guardrail owner (sub-accounts are governed by their parent automatically).
    #[payable]
    pub fn delegate_guardrail_owner(&mut self, owner_id: AccountId) {
        assert_one_yocto();
        let agent_id = env::predecessor_account_id();
        self.guardrail_delegations.insert(agent_id.clone(), owner_id.clone());
        events::paron("guardrail_owner_delegated", json!({ "agent_id": agent_id, "owner_id": owner_id }));
    }

    /// Register or update the spending & slippage policy of an agent. The caller becomes (or must
    /// already be) the policy owner. Authorised callers: the agent's parent account
    /// (`cfo.treasury.near` is governed by `treasury.near`), the agent itself, or an owner the agent
    /// delegated to via `delegate_guardrail_owner`.
    #[payable]
    pub fn configure_agent_guardrail(
        &mut self,
        agent_id: AccountId,
        max_daily_spend_micros: U128,
        max_slippage_bps: u16,
        allowed_series: Option<Vec<SeriesId>>,
    ) -> AgentGuardrailPolicy {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let existing = self.guardrails.get(&agent_id).cloned();
        match &existing {
            Some(policy) => require!(policy.owner_id == caller, "only the policy owner may reconfigure this agent"),
            None => require!(
                caller == agent_id
                    || is_sub_account(&agent_id, &caller)
                    || self.guardrail_delegations.get(&agent_id) == Some(&caller),
                "caller is not authorised to govern this agent (must be parent account, self, or delegated owner)"
            ),
        }
        require!(max_daily_spend_micros.0 > 0, "max_daily_spend_micros must be positive");
        require!(max_slippage_bps <= MAX_SLIPPAGE_BPS, "max_slippage_bps exceeds protocol ceiling (2000)");
        let allowed_series = allowed_series.unwrap_or_default();
        for series_id in &allowed_series {
            require!(self.series.contains_key(series_id), format!("unknown series {series_id}"));
        }
        let today = env::block_timestamp_ms() / MS_PER_DAY;
        let policy = AgentGuardrailPolicy {
            agent_id: agent_id.clone(),
            owner_id: caller,
            max_daily_spend_micros,
            spent_today_micros: existing.as_ref().map_or(U128(0), |p| p.spent_today_micros),
            last_reset_day: existing.as_ref().map_or(today, |p| p.last_reset_day),
            max_slippage_bps,
            allowed_series,
            paused: existing.as_ref().map_or(false, |p| p.paused),
            lifetime_spend_micros: existing.as_ref().map_or(U128(0), |p| p.lifetime_spend_micros),
        };
        self.guardrails.insert(agent_id, policy.clone());
        events::paron("guardrail_configured", json!({ "policy": policy }));
        policy
    }

    /// Emergency brake for the policy owner.
    #[payable]
    pub fn set_agent_paused(&mut self, agent_id: AccountId, paused: bool) {
        assert_one_yocto();
        let mut policy = self
            .guardrails
            .get(&agent_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no guardrail policy for agent"));
        require!(policy.owner_id == env::predecessor_account_id(), "only the policy owner may pause this agent");
        policy.paused = paused;
        self.guardrails.insert(agent_id.clone(), policy);
        events::paron("guardrail_paused", json!({ "agent_id": agent_id, "paused": paused }));
    }

    pub fn get_agent_guardrail(&self, agent_id: AccountId) -> Option<AgentGuardrailPolicy> {
        self.guardrails.get(&agent_id).cloned().map(|mut p| {
            let today = env::block_timestamp_ms() / MS_PER_DAY;
            if today > p.last_reset_day {
                p.spent_today_micros = U128(0);
                p.last_reset_day = today;
            }
            p
        })
    }

    /// Remaining spend allowance for the current UTC day.
    pub fn agent_remaining_allowance(&self, agent_id: AccountId) -> U128 {
        self.get_agent_guardrail(agent_id)
            .map_or(U128(0), |p| U128(p.max_daily_spend_micros.0.saturating_sub(p.spent_today_micros.0)))
    }
}

impl ParonCore {
    /// Enforces the agent's policy and books `spend` against today's allowance.
    ///
    /// * `require_policy = true` for agent-only entrypoints (`agent_buy_forward`).
    /// * Otherwise the policy is enforced only when one is registered for the caller — an agent can
    ///   never escape its policy by calling a different method.
    pub(crate) fn assert_agent_policy_compliant(
        &mut self,
        agent_id: &AccountId,
        series: &ComputeSeries,
        spend_micros: u128,
        guard: PriceGuard,
        require_policy: bool,
    ) {
        let Some(mut policy) = self.guardrails.get(agent_id).cloned() else {
            require!(!require_policy, "no AgentGuardrailPolicy registered for this agent");
            return;
        };
        require!(!policy.paused, "agent is paused by its guardrail owner");
        if !policy.allowed_series.is_empty() {
            require!(policy.allowed_series.contains(&series.series_id), "series not allowed by agent policy");
        }
        let today = env::block_timestamp_ms() / MS_PER_DAY;
        if today > policy.last_reset_day {
            policy.spent_today_micros = U128(0);
            policy.last_reset_day = today;
        }
        let twap = series.index_twap_usdc_micros.0;
        let slippage = policy.max_slippage_bps as u128;
        match guard {
            PriceGuard::BuyAtMost(max_price) => {
                let ceiling = twap * (BPS + slippage) / BPS;
                require!(
                    max_price <= ceiling,
                    format!("slippage guard: max price {max_price} exceeds TWAP band ceiling {ceiling}")
                );
            }
            PriceGuard::SellAtLeast(min_price) => {
                let floor = twap * (BPS - slippage) / BPS;
                require!(
                    min_price >= floor,
                    format!("slippage guard: price {min_price} below TWAP band floor {floor}")
                );
            }
            PriceGuard::None => {}
        }
        let spent = policy.spent_today_micros.0 + spend_micros;
        require!(
            spent <= policy.max_daily_spend_micros.0,
            format!(
                "daily spend cap exceeded: {} + {} > {}",
                policy.spent_today_micros.0, spend_micros, policy.max_daily_spend_micros.0
            )
        );
        policy.spent_today_micros = U128(spent);
        policy.lifetime_spend_micros = U128(policy.lifetime_spend_micros.0 + spend_micros);
        self.guardrails.insert(agent_id.clone(), policy);
    }
}
