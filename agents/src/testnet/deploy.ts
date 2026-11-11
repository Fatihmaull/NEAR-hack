/**
 * One-shot, resumable NEAR testnet deployment of Paron v2.
 *
 *   npm run build:contract && npm run testnet:deploy        (from the repo root)
 *
 * 1. creates three faucet-funded top-level accounts (protocol owner, swarm treasury, compute provider)
 *    and the sub-accounts market./usdc./relayer. (protocol) and cfo./mm./consumer. (treasury);
 * 2. deploys `test-usdc` (NEP-141, 6 decimals, no value) and `paron-core`, registering a freshly generated
 *    OutLayer signer key (seed stays in the local keystore);
 * 3. repays the genesis liquidity credit, seeds the insurance pool and funds every agent;
 * 4. the treasury registers on-chain guardrails; each agent installs a Function Call key scoped to
 *    `paron-core` with zero deposit rights.
 *
 * Every step checks on-chain state first, so re-running continues where it stopped. Public results are
 * written to `deployments/testnet.json`; keys only to the local keystore (see common.ts).
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nearToYocto } from "near-api-js";
import { nearPublicKey } from "../crypto";
import { usdc } from "../engine/math";
import { seedSigner } from "../oracle/cri-oracle";
import { FUNCTION_CALL_KEY_METHODS, GUARDRAILS, SWARM_ACCOUNTS } from "../swarm";
import {
  account,
  accountExists,
  CREDENTIALS_DIR,
  DEPLOYMENT_FILE,
  FAUCET_URL,
  hashOf,
  loadKey,
  loadOrCreateKey,
  loadOrCreateTeeSeed,
  provider,
  readDeployment,
  REPO_ROOT,
  RPC_URL,
  txUrl,
  waitForAccount,
  writeDeployment,
  type Deployment,
} from "./common";

const ONE_YOCTO = 1n;
const TGAS = 1_000_000_000_000n;
const STORAGE_DEPOSIT = nearToYocto("0.00125");
const AGENT_KEY_ALLOWANCE = "0.25" as const;

const suffix = readDeployment()?.suffix ?? process.env.PARON_TESTNET_SUFFIX?.trim() ?? Date.now().toString(36);
const owner = `paron-${suffix}.testnet`;
const treasury = `swarm-${suffix}.testnet`;
const providerId = `batam-${suffix}.testnet`;

const d: Deployment = readDeployment() ?? {
  network: "testnet",
  rpc_url: RPC_URL,
  suffix,
  created_at: new Date().toISOString(),
  accounts: {
    owner,
    contract: `market.${owner}`,
    usdc_token: `usdc.${owner}`,
    relayer: `relayer.${owner}`,
    treasury,
    cfo: `cfo.${treasury}`,
    market_maker: `mm.${treasury}`,
    consumer: `consumer.${treasury}`,
    provider: providerId,
  },
  contracts: {},
  function_call_keys: {},
  guardrails: {},
  steps: {},
};
const A = d.accounts;

function record(step: string, label: string, accountId: string, outcome: unknown): void {
  const hash = typeof outcome === "string" ? outcome : hashOf(outcome);
  (d.steps[step] ??= []).push({ label, account: accountId, hash, url: txUrl(hash) });
  writeDeployment(d);
  console.log(`  ✓ ${label}  ${txUrl(hash)}`);
}

async function faucetAccount(accountId: string): Promise<void> {
  if (await accountExists(accountId)) return console.log(`  · ${accountId} exists`);
  const key = loadOrCreateKey(accountId);
  const res = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.public_key }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`faucet refused ${accountId}: ${res.status} ${body.slice(0, 200)}`);
  await waitForAccount(accountId);
  let hash = "";
  try {
    hash = (JSON.parse(body) as { transaction?: { hash?: string } }).transaction?.hash ?? "";
  } catch {
    /* faucet returned a non-JSON body */
  }
  record("accounts", `faucet created ${accountId} (10 NEAR)`, accountId, hash);
}

async function subAccount(parentId: string, accountId: string, near: `${number}`): Promise<void> {
  if (await accountExists(accountId)) return console.log(`  · ${accountId} exists`);
  const key = loadOrCreateKey(accountId);
  const out = await account(parentId).createSubAccount({ accountOrPrefix: accountId, publicKey: key.public_key, nearToTransfer: nearToYocto(near) });
  record("accounts", `created ${accountId} with ${near} NEAR`, parentId, out);
}

function wasm(name: string): { code: Uint8Array; sha256: string } {
  const path = join(REPO_ROOT, "target/near", name, `${name}.wasm`);
  const code = new Uint8Array(readFileSync(path));
  return { code, sha256: createHash("sha256").update(code).digest("hex") };
}

async function deploy(accountId: string, crate: string, init: { method: string; args: Record<string, unknown> }): Promise<void> {
  const { code, sha256 } = wasm(crate);
  const view = await provider().viewAccount({ accountId });
  const codeHash = (view as { code_hash?: string }).code_hash ?? "";
  if (codeHash && codeHash !== "11111111111111111111111111111111") {
    console.log(`  · ${crate} already deployed on ${accountId} (${codeHash})`);
    d.contracts[crate] = { account: accountId, wasm_sha256: sha256, code_hash: codeHash, bytes: code.length };
    writeDeployment(d);
    return;
  }
  const acct = account(accountId);
  const out = await acct.deployContract(code);
  record("deploy", `deployed ${crate} (${code.length} bytes) to ${accountId}`, accountId, out);
  const initOut = await acct.callFunctionRaw({ contractId: accountId, methodName: init.method, args: init.args, gas: 300n * TGAS });
  record("deploy", `${crate}.${init.method}(${JSON.stringify(init.args)})`, accountId, initOut);
  const after = await provider().viewAccount({ accountId });
  d.contracts[crate] = { account: accountId, wasm_sha256: sha256, code_hash: (after as { code_hash?: string }).code_hash, bytes: code.length };
  writeDeployment(d);
}

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider().callFunction({ contractId, method, args })) as T;
}

async function call(signer: string, contractId: string, method: string, args: Record<string, unknown>, deposit = 0n, gasTgas = 100n) {
  return account(signer).callFunctionRaw({ contractId, methodName: method, args, deposit, gas: gasTgas * TGAS });
}

async function ensureTokenRegistration(accountId: string): Promise<void> {
  const bal = await view<unknown>(A.usdc_token, "storage_balance_of", { account_id: accountId });
  if (bal) return;
  const out = await call(A.owner, A.usdc_token, "storage_deposit", { account_id: accountId, registration_only: true }, STORAGE_DEPOSIT, 30n);
  record("funding", `registered ${accountId} on ${A.usdc_token}`, A.owner, out);
}

async function mint(to: string, amount: bigint): Promise<void> {
  const out = await call(A.owner, A.usdc_token, "mint", { account_id: to, amount: amount.toString() }, 0n, 30n);
  record("funding", `minted ${Number(amount) / 1e6} tUSDC to ${to}`, A.owner, out);
}

async function transferCall(from: string, amount: bigint, msg: string, label: string): Promise<void> {
  const out = await call(from, A.usdc_token, "ft_transfer_call", { receiver_id: A.contract, amount: amount.toString(), msg }, ONE_YOCTO, 150n);
  record("funding", label, from, out);
}

async function main(): Promise<void> {
  console.log(`Paron v2 → NEAR testnet (${RPC_URL}) · suffix ${suffix} · keystore ${CREDENTIALS_DIR}`);
  writeDeployment(d);

  console.log("1/5 accounts");
  for (const id of [A.owner, A.treasury, A.provider]) await faucetAccount(id);
  await subAccount(A.owner, A.contract, "6");
  await subAccount(A.owner, A.usdc_token, "2.2");
  await subAccount(A.owner, A.relayer, "0.4");
  for (const id of [A.cfo, A.market_maker, A.consumer]) await subAccount(A.treasury, id, "1");

  console.log("2/5 contracts");
  const seedHex = loadOrCreateTeeSeed(A.contract, () => randomBytes(32).toString("hex"));
  const tee = seedSigner(seedHex);
  d.tee_signer_public_key = nearPublicKey(tee.keyPair.publicKey);
  await deploy(A.usdc_token, "test_usdc", { method: "new", args: { owner_id: A.owner } });
  await deploy(A.contract, "paron_core", { method: "new", args: { owner_id: A.owner, tee_signer_pubkey: d.tee_signer_public_key, usdc_token_id: A.usdc_token } });

  console.log("3/5 funding (test USDC, no value)");
  await ensureTokenRegistration(A.contract);
  const stats = await view<{ genesis_credit_outstanding_micros: string; insurance_pool_micros: string }>(A.contract, "protocol_stats");
  const credit = BigInt(stats.genesis_credit_outstanding_micros);
  if (credit > 0n) {
    await mint(A.owner, credit + usdc(1_000));
    await transferCall(A.owner, credit, JSON.stringify({ action: "fund_genesis" }), `repaid genesis liquidity credit ${Number(credit) / 1e6} USDC (withdrawals unlocked)`);
    await transferCall(A.owner, usdc(1_000), JSON.stringify({ action: "insurance" }), "seeded insurance pool with 1,000 USDC");
  }
  const agentFunding: Array<[string, bigint]> = [
    [A.market_maker, usdc(6_000)],
    [A.cfo, usdc(2_600)],
    [A.consumer, usdc(500)],
  ];
  const free = async (id: string) => BigInt(await view<string>(A.contract, "usdc_balance_of", { account_id: id }));
  const unfunded = [];
  for (const [id, amt] of agentFunding) if ((await free(id)) === 0n) unfunded.push([id, amt] as const);
  if (unfunded.length) {
    await mint(A.treasury, unfunded.reduce((a, [, x]) => a + x, 0n));
    for (const [id, amt] of unfunded)
      await transferCall(A.treasury, amt, JSON.stringify({ action: "deposit", beneficiary: id }), `treasury funded ${id} with ${Number(amt) / 1e6} USDC margin`);
  }
  if ((await free(A.provider)) === 0n) {
    await mint(A.provider, usdc(1_500));
    await transferCall(A.provider, usdc(1_500), "", `provider ${A.provider} posted 1,500 USDC to its margin account`);
  }

  console.log("4/5 guardrails");
  const roleOf: Record<string, string> = { [SWARM_ACCOUNTS.cfo]: A.cfo, [SWARM_ACCOUNTS.marketMaker]: A.market_maker, [SWARM_ACCOUNTS.consumer]: A.consumer };
  for (const [simId, g] of Object.entries(GUARDRAILS)) {
    const agentId = roleOf[simId];
    d.guardrails[agentId] = { max_daily_spend_usdc: (Number(g.maxDailySpend) / 1e6).toString(), max_slippage_bps: g.slippageBps, allowed_series: [...g.series] };
    if (await view(A.contract, "get_agent_guardrail", { agent_id: agentId })) continue;
    const out = await call(A.treasury, A.contract, "configure_agent_guardrail", {
      agent_id: agentId,
      max_daily_spend_micros: g.maxDailySpend.toString(),
      max_slippage_bps: g.slippageBps,
      allowed_series: g.series,
    }, ONE_YOCTO, 30n);
    record("guardrails", `treasury set guardrail for ${agentId}: ${Number(g.maxDailySpend) / 1e6} USDC/day, ${g.slippageBps} bps`, A.treasury, out);
  }

  console.log("5/5 Function Call keys");
  const fcRoles: Array<[string, string]> = [
    [A.cfo, SWARM_ACCOUNTS.cfo],
    [A.market_maker, SWARM_ACCOUNTS.marketMaker],
    [A.consumer, SWARM_ACCOUNTS.consumer],
    [A.provider, SWARM_ACCOUNTS.provider],
    [A.relayer, SWARM_ACCOUNTS.relayer],
  ];
  for (const [agentId, simId] of fcRoles) {
    const methods = FUNCTION_CALL_KEY_METHODS[simId];
    const existing = loadKey(agentId, "agent");
    const key = existing ?? loadOrCreateKey(agentId, "agent");
    d.function_call_keys[agentId] = { public_key: key.public_key, receiver_id: A.contract, method_names: methods, allowance_near: AGENT_KEY_ALLOWANCE };
    const keys = await provider().viewAccessKeyList({ accountId: agentId });
    const present = (keys as { keys: Array<{ public_key: string }> }).keys.some((k) => k.public_key === key.public_key);
    if (present) continue;
    const out = await account(agentId).addFunctionCallAccessKey({ publicKey: key.public_key, contractId: A.contract, methodNames: methods, allowance: nearToYocto(AGENT_KEY_ALLOWANCE) });
    record("function_call_keys", `${agentId} installed a Function Call key for ${methods.length} paron-core methods`, agentId, out);
  }

  writeDeployment(d);
  const after = await view<Record<string, string>>(A.contract, "protocol_stats");
  console.log(`\nDeployed. Contract ${A.contract} · token ${A.usdc_token} · TEE signer ${d.tee_signer_public_key}`);
  console.log(`protocol_stats: ${JSON.stringify(after)}`);
  console.log(`Public record: ${DEPLOYMENT_FILE}`);
}

main().catch((e) => {
  console.error(`deploy failed: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
