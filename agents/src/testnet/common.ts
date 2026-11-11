/**
 * Shared plumbing for the NEAR testnet deployment (`deploy.ts`) and the live swarm run (`scenario.ts`).
 *
 * Secrets never touch the repository:
 * - account keys live in the near-cli compatible keystore `~/.near-credentials/testnet/<account>.json`
 *   (override with NEAR_CREDENTIALS_DIR), Function Call agent keys in `<account>.paron-agent.json`,
 *   the OutLayer signer seed (local stand-in for the enclave key) in `paron-tee-signer.<contract>.json`;
 * - only public data (account ids, public keys, code hashes, tx hashes) is written to `deployments/`.
 *
 * Node's fetch does not use HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 — the npm scripts set it.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

export const NETWORK_ID = "testnet";
export const RPC_URL = process.env.NEAR_RPC_URL?.trim() || "https://test.rpc.fastnear.com";
export const FAUCET_URL = "https://helper.nearprotocol.com/account";
export const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";
export const EXPLORER_ACCOUNT = "https://testnet.nearblocks.io/address/";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
export const DEPLOYMENT_FILE = join(REPO_ROOT, "deployments/testnet.json");
export const RUN_FILE = join(REPO_ROOT, "deployments/testnet-run.json");
export const CREDENTIALS_DIR = process.env.NEAR_CREDENTIALS_DIR?.trim() || join(homedir(), ".near-credentials", NETWORK_ID);

export interface StoredKey {
  account_id: string;
  public_key: string;
  private_key: string;
}

export interface TxRef {
  label: string;
  account: string;
  hash: string;
  url: string;
}

export interface Deployment {
  network: "testnet";
  rpc_url: string;
  suffix: string;
  created_at: string;
  accounts: {
    owner: string;
    contract: string;
    usdc_token: string;
    relayer: string;
    treasury: string;
    cfo: string;
    market_maker: string;
    consumer: string;
    provider: string;
  };
  contracts: Record<string, { account: string; wasm_sha256: string; code_hash?: string; bytes: number }>;
  tee_signer_public_key?: string;
  function_call_keys: Record<string, { public_key: string; receiver_id: string; method_names: string[]; allowance_near: string }>;
  guardrails: Record<string, { max_daily_spend_usdc: string; max_slippage_bps: number; allowed_series: string[] }>;
  steps: Record<string, TxRef[]>;
}

export const txUrl = (hash: string): string => `${EXPLORER_TX}${hash}`;

export function provider(): JsonRpcProvider {
  return new JsonRpcProvider({ url: RPC_URL });
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
}

function writeSecret(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function keyPath(accountId: string, kind: "full" | "agent" = "full"): string {
  return join(CREDENTIALS_DIR, kind === "full" ? `${accountId}.json` : `${accountId}.paron-agent.json`);
}

export function loadKey(accountId: string, kind: "full" | "agent" = "full"): StoredKey | null {
  const path = keyPath(accountId, kind);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as StoredKey) : null;
}

export function newKey(accountId: string, kind: "full" | "agent" = "full"): StoredKey {
  const kp = KeyPair.fromRandom("ed25519");
  const stored: StoredKey = { account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
  writeSecret(keyPath(accountId, kind), stored);
  return stored;
}

export function loadOrCreateKey(accountId: string, kind: "full" | "agent" = "full"): StoredKey {
  return loadKey(accountId, kind) ?? newKey(accountId, kind);
}

export function account(accountId: string, kind: "full" | "agent" = "full"): Account {
  const key = loadKey(accountId, kind);
  if (!key) throw new Error(`no ${kind} key for ${accountId} in ${CREDENTIALS_DIR}`);
  return new Account(accountId, provider(), key.private_key as `ed25519:${string}`);
}

export function teeSeedPath(contractId: string): string {
  return join(CREDENTIALS_DIR, `paron-tee-signer.${contractId}.json`);
}

export function loadOrCreateTeeSeed(contractId: string, randomHex: () => string): string {
  const path = teeSeedPath(contractId);
  if (existsSync(path)) return (JSON.parse(readFileSync(path, "utf8")) as { seed_hex: string }).seed_hex;
  const seed = randomHex();
  writeSecret(path, { purpose: "local stand-in for the OutLayer enclave-derived signing key (testnet only)", seed_hex: seed });
  return seed;
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await provider().viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

export async function waitForAccount(accountId: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await accountExists(accountId)) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`account ${accountId} did not appear on ${NETWORK_ID}`);
}

export function readDeployment(): Deployment | null {
  return existsSync(DEPLOYMENT_FILE) ? (JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")) as Deployment) : null;
}

export function writeDeployment(d: Deployment): void {
  ensureDir(dirname(DEPLOYMENT_FILE));
  writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(d, null, 2)}\n`);
}

/** Hash of a near-api-js transaction response (`RpcTransactionResponse`). */
export function hashOf(outcome: unknown): string {
  const o = outcome as { transaction_outcome?: { id?: string }; transaction?: { hash?: string } };
  return o.transaction_outcome?.id ?? o.transaction?.hash ?? "";
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
