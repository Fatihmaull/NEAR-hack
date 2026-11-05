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

export const DEFAULT_TESTNET_RPC = "https://rpc.testnet.near.org";

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
    try {
      const result = await account.callFunction<T & object>({
        contractId: this.cfg.contractId,
        methodName: method,
        args,
        deposit: opts.depositYocto ?? 0n,
        gas: BigInt(opts.gasTgas ?? 100) * 1_000_000_000_000n,
      });
      return { ok: true, result: result as T };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async view<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const { provider } = await this.connect();
    return (await provider.callFunction({ contractId: this.cfg.contractId, method, args })) as T;
  }
}
