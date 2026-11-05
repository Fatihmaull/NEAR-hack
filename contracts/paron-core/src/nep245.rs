//! NEP-245 multi-token ledger for the canonical compute series (`token_id == series_id`).
//!
//! Amounts are CU scaled by 1e4. Transfers require 1 yoctoNEAR (full-access key), exactly like
//! NEP-141/NEP-171, so an autonomous agent's Function Call key can trade but never move tokens out.

use crate::*;
use near_sdk::{Gas, PromiseOrValue};

const GAS_FOR_MT_ON_TRANSFER: Gas = Gas::from_tgas(35);
const GAS_FOR_MT_RESOLVE_TRANSFER: Gas = Gas::from_tgas(15);

/// NEP-245 `Token` view.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MtToken {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[ext_contract(ext_mt_receiver)]
pub trait MultiTokenReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

#[near]
impl ParonCore {
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approval.is_none(), "NEP-245 approvals are not supported by this contract");
        let sender_id = env::predecessor_account_id();
        self.internal_mt_transfer(&sender_id, &receiver_id, &token_id, amount.0, memo.as_deref());
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approvals.map_or(true, |a| a.iter().all(|x| x.is_none())), "NEP-245 approvals are not supported");
        require!(!token_ids.is_empty() && token_ids.len() == amounts.len(), "token_ids and amounts length mismatch");
        let sender_id = env::predecessor_account_id();
        for (token_id, amount) in token_ids.iter().zip(amounts.iter()) {
            self.internal_mt_transfer(&sender_id, &receiver_id, token_id, amount.0, memo.as_deref());
        }
    }

    /// Transfer and notify the receiver (`mt_on_transfer`); unused amounts are refunded in
    /// `mt_resolve_transfer`.
    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(approval.is_none(), "NEP-245 approvals are not supported by this contract");
        let sender_id = env::predecessor_account_id();
        self.internal_mt_transfer(&sender_id, &receiver_id, &token_id, amount.0, memo.as_deref());
        ext_mt_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_MT_ON_TRANSFER)
            .mt_on_transfer(sender_id.clone(), vec![sender_id.clone()], vec![token_id.clone()], vec![amount], msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_MT_RESOLVE_TRANSFER)
                    .mt_resolve_transfer(vec![sender_id], receiver_id, vec![token_id], vec![amount], None),
            )
            .into()
    }

    /// Returns the amounts actually used by the receiver; refunds the rest to the previous owners.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        #[allow(unused_variables)] approvals: Option<Vec<Option<Vec<(AccountId, u64, U128)>>>>,
    ) -> Vec<U128> {
        let unused: Vec<U128> = env::promise_result_checked(0, 16 * 1_024)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<Vec<U128>>(&bytes).ok())
            .filter(|v| v.len() == amounts.len())
            .unwrap_or_else(|| amounts.clone());
        let mut used = Vec::with_capacity(token_ids.len());
        for i in 0..token_ids.len() {
            let requested_refund = unused[i].0.min(amounts[i].0);
            let refund = requested_refund.min(self.mt_balance_internal(&token_ids[i], &receiver_id));
            if refund > 0 {
                let previous_owner = &previous_owner_ids[i.min(previous_owner_ids.len() - 1)];
                self.move_tokens(&token_ids[i], &receiver_id, previous_owner, refund);
                self.position_move(&token_ids[i], &receiver_id, previous_owner, refund);
                events::mt_transfer(&receiver_id, previous_owner, &[token_ids[i].clone()], &[refund], Some("refund"));
            }
            used.push(U128(amounts[i].0 - refund));
        }
        used
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.mt_balance_internal(&token_id, &account_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.mt_balance_internal(t, &account_id))).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.mt_supply.get(&token_id).map(|s| U128(*s))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.iter().map(|t| self.mt_supply.get(t).map(|s| U128(*s))).collect()
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<MtToken>> {
        token_ids
            .into_iter()
            .map(|t| self.series.contains_key(&t).then(|| MtToken { token_id: t, owner_id: None }))
            .collect()
    }

    /// Pure view: convert raw GPU hours (scaled by 1e4) on any tier into canonical CU (scaled by 1e4).
    /// `A100 = 0.45x`, `H100 = 1.00x`, `H200 = 1.40x`, `B200 = 2.50x`, `GB200 = 3.50x`.
    pub fn convert_hardware_to_cu(&self, gpu_tier: GpuTier, hours_scaled: U128) -> U128 {
        U128(hardware_to_cu_scaled(gpu_tier, hours_scaled.0))
    }
}

impl ParonCore {
    pub(crate) fn mt_balance_internal(&self, token_id: &str, account_id: &AccountId) -> u128 {
        self.mt_balances.get(&(token_id.to_string(), account_id.clone())).copied().unwrap_or(0)
    }

    fn set_mt_balance(&mut self, token_id: &str, account_id: &AccountId, value: u128) {
        let key = (token_id.to_string(), account_id.clone());
        if value == 0 {
            self.mt_balances.remove(&key);
        } else {
            self.mt_balances.insert(key, value);
        }
    }

    /// Raw balance move (no events, no position accounting).
    pub(crate) fn move_tokens(&mut self, token_id: &str, from: &AccountId, to: &AccountId, amount: u128) {
        let from_balance = self.mt_balance_internal(token_id, from);
        require!(
            from_balance >= amount,
            format!("insufficient {token_id} balance: {from} has {from_balance}, needs {amount}")
        );
        self.set_mt_balance(token_id, from, from_balance - amount);
        let to_balance = self.mt_balance_internal(token_id, to);
        self.set_mt_balance(token_id, to, to_balance + amount);
    }

    pub(crate) fn internal_mt_transfer(
        &mut self,
        sender_id: &AccountId,
        receiver_id: &AccountId,
        token_id: &str,
        amount: u128,
        memo: Option<&str>,
    ) {
        require!(sender_id != receiver_id, "sender and receiver must differ");
        require!(receiver_id != &env::current_account_id(), "cannot transfer into the protocol escrow account");
        require!(amount > 0, "amount must be positive");
        require!(self.series.contains_key(token_id), format!("unknown token_id {token_id}"));
        self.move_tokens(token_id, sender_id, receiver_id, amount);
        self.position_move(token_id, sender_id, receiver_id, amount);
        events::mt_transfer(sender_id, receiver_id, &[token_id.to_string()], &[amount], memo);
    }

    pub(crate) fn internal_mint(&mut self, token_id: &str, owner_id: &AccountId, amount: u128, memo: Option<&str>) {
        if amount == 0 {
            return;
        }
        let balance = self.mt_balance_internal(token_id, owner_id);
        self.set_mt_balance(token_id, owner_id, balance + amount);
        let supply = self.mt_supply.get(token_id).copied().unwrap_or(0);
        self.mt_supply.insert(token_id.to_string(), supply + amount);
        events::mt_mint(owner_id, token_id, amount, memo);
    }

    pub(crate) fn internal_burn(&mut self, token_id: &str, owner_id: &AccountId, amount: u128, memo: Option<&str>) {
        if amount == 0 {
            return;
        }
        let balance = self.mt_balance_internal(token_id, owner_id);
        require!(balance >= amount, format!("cannot burn {amount} {token_id}: {owner_id} holds {balance}"));
        self.set_mt_balance(token_id, owner_id, balance - amount);
        let supply = self.mt_supply.get(token_id).copied().unwrap_or(0);
        self.mt_supply.insert(token_id.to_string(), supply - amount);
        events::mt_burn(owner_id, token_id, amount, memo);
    }
}
