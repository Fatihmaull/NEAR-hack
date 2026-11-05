import assert from "node:assert/strict";
import { test } from "node:test";
import { base58, hexToBytes } from "../src/crypto";
import { buildErc20TransferPayload, buildMpcSignRequest, buildSolanaTransferMessage, deriveAgentMultichainAddresses, rlpEncode } from "../src/chain-signatures";
import { usdc } from "../src/engine/math";
import { LocalNearRuntime } from "../src/engine/runtime";
import { deterministicQuote, INTENTS_ASSETS, OneClickIntentsBridge, paronFundingQuoteRequest } from "../src/intents-bridge";

const T0 = 1_793_869_200_000;

function runtime() {
  const rt = new LocalNearRuntime("market.paron.testnet", "usdc.fakes.testnet", T0);
  const contract = rt.createAccount("market.paron.testnet");
  rt.createAccount("paron.testnet");
  const agent = rt.createAccount("cfo.swarm-treasury.testnet");
  rt.deployParon(contract, "paron.testnet", "11".repeat(32));
  return { rt, agent };
}

test("Function Call access keys enforce receiver, method allowlist, zero deposit and allowance (nearcore rules)", () => {
  const { rt, agent } = runtime();
  const fc = rt.addFunctionCallKey(agent, "cfo", "market.paron.testnet", ["agent_buy_forward", "settle_cash_hedge"], 6_000_000_000_000_000_000_000n);
  assert.match(rt.call(fc, "withdraw_usdc", { amount: "1" }, { depositYocto: 1n }).error!, /MethodNameMismatch/);
  assert.match(rt.call(fc, "agent_buy_forward", {}, { depositYocto: 1n }).error!, /DepositWithFunctionCall/);
  const nonceBefore = rt.accessKey(fc).nonce;
  // 30 TGas at 1e8 yocto/gas = 0.003 NEAR per call -> a 0.006 NEAR allowance funds exactly two calls.
  assert.equal(rt.call(fc, "agent_buy_forward", { series_id: "CU-2026-11", cu_amount_scaled: "10000", max_price_micros: "2842000" }).ok, false);
  assert.equal(rt.call(fc, "agent_buy_forward", { series_id: "CU-2026-11", cu_amount_scaled: "10000", max_price_micros: "2842000" }).ok, false);
  assert.match(rt.call(fc, "agent_buy_forward", {}).error!, /NotEnoughAllowance/);
  assert.equal(rt.accessKey(fc).nonce, nonceBefore + 2, "rejected-at-validation txs do not consume nonces");
  // Contract panics are FunctionCallErrors and leave no state behind.
  assert.equal(rt.view("mt_supply", { token_id: "CU-2026-11" }), "0");
});

test("ft_transfer_call refunds the sender when ft_on_transfer panics", () => {
  const { rt, agent } = runtime();
  rt.creditUsdcWallet("cfo.swarm-treasury.testnet", usdc(50));
  const out = rt.ftTransferCall(agent, usdc(50), "not-json");
  assert.equal(out.ok, false);
  assert.equal(rt.usdcWalletBalance("cfo.swarm-treasury.testnet"), usdc(50));
  assert.equal(rt.view("usdc_balance_of", { account_id: "cfo.swarm-treasury.testnet" }), "0");
});

test("Chain Signatures derivation matches chainsig.js v1.1.16 for v1.signer-prod.testnet", () => {
  // Reference values produced by chainsig.js `utils.cryptography.deriveChildPublicKey{,Ed25519}`.
  const a = deriveAgentMultichainAddresses("cfo.swarm-treasury.testnet", "base-1");
  assert.equal(a.evm.address.toLowerCase(), "0x67796863b08ba0761907148999af0c07f536f938");
  const s = deriveAgentMultichainAddresses("cfo.swarm-treasury.testnet", "solana-1");
  assert.equal(s.solana.address, "DJwG6m6JpD2riTvj6oE2L6Mgr9bDg6GE7qkAuw4J8gbd");
  assert.equal(a.mpcContractId, "v1.signer-prod.testnet");
  assert.match(a.evm.address, /^0x[0-9a-fA-F]{40}$/);
});

test("EIP-1559 ERC-20 payload, Solana transfer message and MPC sign request are well-formed", () => {
  assert.deepEqual([...rlpEncode(hexToBytes("7f"))], [0x7f]);
  assert.deepEqual([...rlpEncode([])], [0xc0]);
  const tx = buildErc20TransferPayload({
    chainId: 8453n,
    nonce: 0n,
    maxPriorityFeePerGas: 1_000_000n,
    maxFeePerGas: 12_000_000n,
    gasLimit: 65_000n,
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    to: "0x7cf1121499330b985d9030ea71ca418905c4296e",
    amount: 2_600_000_000n,
  });
  assert.ok(tx.unsignedTxHex.startsWith("0x02"));
  assert.ok(tx.calldataHex.startsWith("0xa9059cbb"));
  assert.equal(tx.signingPayload.length, 32);
  const from = base58.encode(new Uint8Array(32).fill(1));
  const to = base58.encode(new Uint8Array(32).fill(2));
  const msg = buildSolanaTransferMessage(from, to, 2_500_000_000n, base58.encode(new Uint8Array(32).fill(3)));
  assert.equal(msg.length, 3 + 1 + 96 + 32 + 1 + 1 + 1 + 2 + 1 + 12);
  const req = buildMpcSignRequest(tx.signingPayload, "paron-funding", "Ecdsa");
  assert.equal(req.receiverId, "v1.signer-prod.testnet");
  assert.equal(req.args.request.domain_id, 0);
  assert.equal(req.deposit, "1");
  assert.equal(buildMpcSignRequest(msg, "paron-funding", "Eddsa").args.request.domain_id, 1);
});

test("1Click: deterministic local quote math and live requests carry the JWT", async () => {
  const req = paronFundingQuoteRequest({ originAsset: INTENTS_ASSETS.SOL, amount: 2_500_000_000n, refundTo: "sol-refund", paronContractId: "market.paron.testnet", beneficiary: "consumer.near", deadlineIso: "2026-11-05T10:00:00.000Z" });
  const q = deterministicQuote(req, "2026-11-05T09:00:00.000Z");
  assert.equal(q.quote.amountOut, "412170000"); // 2.5 SOL × $165 − 8 bps
  assert.equal(q.quote.minAmountOut, "408048300"); // − 1% slippage
  assert.equal(q.simulated, true);
  assert.equal(JSON.parse(req.customRecipientMsg!).beneficiary, "consumer.near");
  let seen: { url: string; auth: string | null } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, auth: new Headers(init.headers).get("authorization") };
    return new Response(JSON.stringify({ ...q, simulated: undefined }), { status: 200 });
  }) as unknown as typeof fetch;
  const live = new OneClickIntentsBridge({ jwt: "test-jwt", fetchImpl });
  assert.equal(live.mode, "live");
  await live.quote(req);
  assert.equal(seen?.url, "https://1click.chaindefuser.com/v0/quote");
  assert.equal(seen?.auth, "Bearer test-jwt");
});
