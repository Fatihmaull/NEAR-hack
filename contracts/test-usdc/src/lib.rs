//! Testnet-only USDC stand-in (NEP-141 + NEP-145 + NEP-148, 6 decimals).
//!
//! `usdc.fakes.testnet` balances cannot be obtained programmatically, so Paron's testnet deployment uses
//! this token instead (passed as `usdc_token_id` to `paron-core::new`). It has **no value**: anyone may
//! call `faucet` (capped per call) and the owner may `mint`. Accounts are registered automatically on
//! mint/faucet; other accounts register through standard `storage_deposit`.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

/// 100,000 test USDC per faucet call (6 decimals).
pub const FAUCET_CAP: u128 = 100_000 * 1_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestUsdc {
    owner_id: AccountId,
    token: FungibleToken,
}

#[near]
impl TestUsdc {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self { owner_id, token: FungibleToken::new(StorageKey::Token) }
    }

    /// Owner-only mint (auto-registers the receiver).
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.owner_id, "only the owner can mint");
        self.internal_mint(&account_id, amount.0, "owner mint");
    }

    /// Public testnet faucet: mints up to 100,000 test USDC to the caller.
    pub fn faucet(&mut self, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= FAUCET_CAP, "faucet amount must be in (0, 100000] USDC");
        let account_id = env::predecessor_account_id();
        self.internal_mint(&account_id, amount.0, "testnet faucet");
    }
}

impl TestUsdc {
    fn internal_mint(&mut self, account_id: &AccountId, amount: u128, memo: &str) {
        if !self.token.accounts.contains_key(account_id) {
            self.token.internal_register_account(account_id);
        }
        self.token.internal_deposit(account_id, amount);
        FtMint { owner_id: account_id, amount: U128(amount), memo: Some(memo) }.emit();
    }
}

#[near]
impl FungibleTokenCore for TestUsdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestUsdc {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for TestUsdc {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Paron Test USDC (testnet, no value)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).build());
    }

    #[test]
    fn faucet_and_owner_mint_register_and_credit() {
        ctx("owner.testnet");
        let mut t = TestUsdc::new("owner.testnet".parse().unwrap());
        t.mint("alice.testnet".parse().unwrap(), U128(5_000_000));
        ctx("bob.testnet");
        t.faucet(U128(FAUCET_CAP));
        assert_eq!(t.ft_balance_of("alice.testnet".parse().unwrap()).0, 5_000_000);
        assert_eq!(t.ft_balance_of("bob.testnet".parse().unwrap()).0, FAUCET_CAP);
        assert_eq!(t.ft_total_supply().0, FAUCET_CAP + 5_000_000);
        assert_eq!(t.ft_metadata().decimals, 6);
    }

    #[test]
    #[should_panic(expected = "only the owner can mint")]
    fn non_owner_cannot_mint() {
        ctx("owner.testnet");
        let mut t = TestUsdc::new("owner.testnet".parse().unwrap());
        ctx("mallory.testnet");
        t.mint("mallory.testnet".parse().unwrap(), U128(1));
    }

    #[test]
    #[should_panic(expected = "faucet amount must be in")]
    fn faucet_is_capped() {
        ctx("owner.testnet");
        let mut t = TestUsdc::new("owner.testnet".parse().unwrap());
        ctx("bob.testnet");
        t.faucet(U128(FAUCET_CAP + 1));
    }
}
