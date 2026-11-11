/**
 * Live NEAR testnet mode (enabled when NEAR_ACCOUNT_ID + NEAR_PRIVATE_KEY + PARON_CONTRACT_ID are set).
 * Uses near-api-js v7 (`Account.callFunction` / `JsonRpcProvider.callFunction`). The private key is read
 * from the environment only — never hardcoded, never logged. For agents, use a Function Call access key
 * scoped to the Paron contract (see README "Function Call keys").
 */
import type { ClientCallOptions, ClientCallResult, ParonClient } from "./client";

export interface NearLiveConfig {
  accountId: string;
  privateKey: string;
  contractId: string;
  rpcUrl: string;
  keyKind: "FullAccess" | "FunctionCall";
}

export const DEFAULT_TESTNET_RPC = "https://test.rpc.fastnear.com";

export function liveConfigFromEnv(env: Record<string, string | undefined>): NearLiveConfig | null {
  const accountId = env.NEAR_ACCOUNT_ID?.trim();
  const privateKey = env.NEAR_PRIVATE_KEY?.trim();
  const contractId = env.PARON_CONTRACT_ID?.trim();
  if (!accountId || !privateKey || !contractId) return null;
  return {
    accountId,
    privateKey,
    contractId,
    rpcUrl: env.NEAR_RPC_URL?.trim() || DEFAULT_TESTNET_RPC,
    keyKind: env.NEAR_KEY_KIND === "FullAccess" ? "FullAccess" : "FunctionCall",
  };
}

type NearApi = typeof import("near-api-js");

export class NearLiveClient implements ParonClient {
  readonly mode = "live" as const;
  private api?: { account: InstanceType<NearApi["Account"]>; provider: InstanceType<NearApi["JsonRpcProvider"]> };

  constructor(private readonly cfg: NearLiveConfig) {}

  get accountId(): string {
    return this.cfg.accountId;
  }

  get keyKind(): "FullAccess" | "FunctionCall" {
    return this.cfg.keyKind;
  }

  private async connect() {
    if (!this.api) {
      const { Account, JsonRpcProvider } = await import("near-api-js");
      const provider = new JsonRpcProvider({ url: this.cfg.rpcUrl });
      const account = new Account(this.cfg.accountId, provider, this.cfg.privateKey as `ed25519:${string}`);
      this.api = { account, provider };
    }
    return this.api;
  }

  async call<T = unknown>(method: string, args: Record<string, unknown> = {}, opts: ClientCallOptions = {}): Promise<ClientCallResult<T>> {
    const { account } = await this.connect();
    const { getTransactionLastResult } = await import("near-api-js");
    try {
      const outcome = await account.callFunctionRaw({
        contractId: this.cfg.contractId,
        methodName: method,
        args,
        deposit: opts.depositYocto ?? 0n,
        gas: BigInt(opts.gasTgas ?? 100) * 1_000_000_000_000n,
        waitUntil: "EXECUTED_OPTIMISTIC",
      });
      const txHash = outcome.transaction_outcome?.id ?? (outcome.transaction as { hash?: string } | undefined)?.hash;
      return { ok: true, result: getTransactionLastResult(outcome) as T, txHash };
    } catch (e) {
      return { ok: false, error: describeNearError(e), txHash: findTxHash(e) };
    }
  }

  async view<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const { provider } = await this.connect();
    return (await provider.callFunction({ contractId: this.cfg.contractId, method, args })) as T;
  }
}

/** Best-effort extraction of the failing transaction hash from a near-api-js error (failed txs are still on-chain). */
function findTxHash(e: unknown): string | undefined {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | undefined => {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 5) return undefined;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of ["transactionHash", "transaction_hash", "txHash"]) if (typeof o[k] === "string") return o[k] as string;
    const outcome = o.transaction_outcome as { id?: string } | undefined;
    if (outcome?.id) return outcome.id;
    for (const k of ["transactionResult", "context", "cause", "outcome", "result", "data"]) {
      const found = walk(o[k], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(e, 0);
}

/** Surface the contract's panic message (e.g. the guardrail reason) instead of a generic RPC error. */
function describeNearError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const panic = /Smart contract panicked: ([^"\n]+)/.exec(msg) ?? /ExecutionError[":\s]+([^"\n]+)/.exec(msg);
  return panic ? panic[1] : msg;
}
