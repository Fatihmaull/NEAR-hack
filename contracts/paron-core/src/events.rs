//! NEP-297 structured events: NEP-245 `mt_mint` / `mt_burn` / `mt_transfer` plus Paron protocol events.

use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

pub const PARON_STANDARD: &str = "paron";
pub const PARON_VERSION: &str = "2.0.0";

fn emit(standard: &str, version: &str, event: &str, data: Value) {
    let payload = json!({ "standard": standard, "version": version, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

pub fn mt_mint(owner_id: &AccountId, token_id: &str, amount: u128, memo: Option<&str>) {
    let mut data = json!({ "owner_id": owner_id, "token_ids": [token_id], "amounts": [amount.to_string()] });
    if let Some(memo) = memo {
        data["memo"] = json!(memo);
    }
    emit("nep245", "1.0.0", "mt_mint", data);
}

pub fn mt_burn(owner_id: &AccountId, token_id: &str, amount: u128, memo: Option<&str>) {
    let mut data = json!({ "owner_id": owner_id, "token_ids": [token_id], "amounts": [amount.to_string()] });
    if let Some(memo) = memo {
        data["memo"] = json!(memo);
    }
    emit("nep245", "1.0.0", "mt_burn", data);
}

pub fn mt_transfer(
    old_owner_id: &AccountId,
    new_owner_id: &AccountId,
    token_ids: &[String],
    amounts: &[u128],
    memo: Option<&str>,
) {
    let amounts: Vec<String> = amounts.iter().map(|a| a.to_string()).collect();
    let mut data = json!({
        "old_owner_id": old_owner_id,
        "new_owner_id": new_owner_id,
        "token_ids": token_ids,
        "amounts": amounts,
    });
    if let Some(memo) = memo {
        data["memo"] = json!(memo);
    }
    emit("nep245", "1.0.0", "mt_transfer", data);
}

pub fn paron(event: &str, data: Value) {
    emit(PARON_STANDARD, PARON_VERSION, event, data);
}
