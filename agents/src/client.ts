/**
 * One interface, two execution modes. Agents only ever talk to a `ParonClient`:
 * - `LocalParonClient` → signed transactions against the deterministic `LocalNearRuntime`;
 * - `NearLiveClient` (near-live.ts) → the deployed contract on NEAR testnet via near-api-js.
 * Arguments and results are the contract's JSON shapes in both modes (U128 as strings).
 */
import type { KeyHandle, LocalNearRuntime, TxRecord } from "./engine/runtime";

export interface ClientCallOptions {
  depositYocto?: bigint;
  gasTgas?: number;
}

export interface ClientCallResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  txHash?: string;
  tx?: TxRecord;
}

export interface ParonClient {
  readonly mode: "local" | "live";
  readonly accountId: string;
  readonly keyKind: "FullAccess" | "FunctionCall";
  call<T = unknown>(method: string, args?: Record<string, unknown>, opts?: ClientCallOptions): Promise<ClientCallResult<T>>;
  view<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;
}

export class LocalParonClient implements ParonClient {
  readonly mode = "local" as const;

  constructor(
    readonly runtime: LocalNearRuntime,
    readonly key: KeyHandle,
  ) {}

  get accountId(): string {
    return this.key.accountId;
  }

  get keyKind(): "FullAccess" | "FunctionCall" {
    return this.runtime.accessKey(this.key).permission.kind;
  }

  async call<T = unknown>(method: string, args: Record<string, unknown> = {}, opts: ClientCallOptions = {}): Promise<ClientCallResult<T>> {
    const out = this.runtime.call<T>(this.key, method, args, opts);
    return { ok: out.ok, result: out.result, error: out.error, txHash: out.tx.tx_hash, tx: out.tx };
  }

  async view<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.runtime.view<T>(method, args);
  }
}

/** JSON (string) U128 → bigint. */
export const u128 = (v: unknown): bigint => BigInt(v as string);
