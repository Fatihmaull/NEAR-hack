/**
 * LocalNearRuntime — deterministic, cryptographically signed local execution of the Paron contract.
 *
 * Models the parts of the NEAR runtime that matter for autonomous agents:
 * - every call is a transaction signed with a real Ed25519 access key and verified before execution;
 * - **Function Call access keys** enforce receiver, method allowlist, zero deposit, gas allowance and
 *   nonce monotonicity (`ReceiverMismatch`, `MethodNameMismatch`, `DepositWithFunctionCall`,
 *   `NotEnoughAllowance`, `InvalidNonce`) — the same rules nearcore applies;
 * - contract panics roll back all state changes atomically (like a failed receipt);
 * - a NEP-141 USDC ledger with `ft_transfer_call` → `ft_on_transfer` (refund on panic).
 *
 * Transactions are encoded as canonical JSON (not Borsh) — documented local-mode encoding.
 */
import { base58, canonicalJson, deterministicKeyPair, sha256, signEd25519, toJsonValue, verifyEd25519, type Ed25519KeyPair } from "../crypto";
import { ContractPanic, PAYABLE_METHODS, ParonLocalContract, VIEW_METHODS, type CallContext } from "./paron-contract";

export const GAS_PRICE_YOCTO = 100_000_000n; // 1e8 yocto per gas (NEAR minimum gas price)
export const TGAS = 1_000_000_000_000n;
export const DEFAULT_FC_ALLOWANCE_YOCTO = 250_000_000_000_000_000_000_000n; // 0.25 NEAR

export type AccessKeyPermission =
  | { kind: "FullAccess" }
  | { kind: "FunctionCall"; receiverId: string; methodNames: string[]; allowanceYocto: bigint | null };

export interface AccessKeyRecord {
  publicKey: string;
  nonce: number;
  permission: AccessKeyPermission;
  keyPair: Ed25519KeyPair;
}

export interface KeyHandle {
  accountId: string;
  publicKey: string;
}

export interface TxRecord {
  index: number;
  tx_hash: string;
  block_time_ms: number;
  signer_id: string;
  public_key: string;
  access_key: "FullAccess" | "FunctionCall";
  receiver_id: string;
  action: "FunctionCall" | "AddKey" | "DeployContract";
  method: string;
  args: unknown;
  deposit_yocto: string;
  prepaid_gas_tgas: number;
  signature: string;
  status: "SuccessValue" | "Failure";
  result?: unknown;
  error?: string;
  error_kind?: "InvalidTxError" | "ActionError" | "FunctionCallError";
  events: unknown[];
}

export interface CallOutcome<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  tx: TxRecord;
}

export class LocalNearRuntime {
  readonly network = "local-sandbox";
  readonly contract = new ParonLocalContract();
  readonly txs: TxRecord[] = [];
  nowMs: number;
  private readonly accounts = new Map<string, Map<string, AccessKeyRecord>>();
  private readonly usdcLedger = new Map<string, bigint>();

  constructor(
    readonly contractId: string,
    readonly usdcTokenId: string,
    genesisMs: number,
  ) {
    this.nowMs = genesisMs;
  }

  // ------------------------------------------------------------------------------------------
  // accounts & keys
  // ------------------------------------------------------------------------------------------

  /** Create an account with a deterministic full-access key derived from a public local-dev label. */
  createAccount(accountId: string): KeyHandle {
    if (this.accounts.has(accountId)) throw new Error(`account ${accountId} already exists`);
    const keyPair = deterministicKeyPair(`paron/local-dev/full-access/${accountId}`);
    this.accounts.set(accountId, new Map([[keyPair.nearPublicKey, { publicKey: keyPair.nearPublicKey, nonce: 0, permission: { kind: "FullAccess" }, keyPair }]]));
    return { accountId, publicKey: keyPair.nearPublicKey };
  }

  /**
   * `AddKey` signed by the account's full-access key: grants an autonomous agent a Function Call key
   * restricted to `receiverId` + `methodNames` with a gas `allowance`.
   */
  addFunctionCallKey(owner: KeyHandle, label: string, receiverId: string, methodNames: string[], allowanceYocto: bigint = DEFAULT_FC_ALLOWANCE_YOCTO): KeyHandle {
    const ownerKey = this.key(owner);
    if (ownerKey.permission.kind !== "FullAccess") throw new Error("AddKey requires a full-access key");
    const keyPair = deterministicKeyPair(`paron/local-dev/function-call/${owner.accountId}/${label}`);
    const permission: AccessKeyPermission = { kind: "FunctionCall", receiverId, methodNames: [...methodNames], allowanceYocto };
    const payload = { signer_id: owner.accountId, public_key: owner.publicKey, nonce: ownerKey.nonce + 1, receiver_id: owner.accountId, actions: [{ AddKey: { public_key: keyPair.nearPublicKey, access_key: toJsonValue(permission) } }] };
    const { hash, signature } = this.sign(ownerKey, payload);
    ownerKey.nonce += 1;
    this.accounts.get(owner.accountId)!.set(keyPair.nearPublicKey, { publicKey: keyPair.nearPublicKey, nonce: 0, permission, keyPair });
    this.record({
      tx_hash: hash,
      signer_id: owner.accountId,
      public_key: owner.publicKey,
      access_key: "FullAccess",
      receiver_id: owner.accountId,
      action: "AddKey",
      method: "AddKey",
      args: { public_key: keyPair.nearPublicKey, permission: toJsonValue(permission) },
      deposit_yocto: "0",
      prepaid_gas_tgas: 0,
      signature,
      status: "SuccessValue",
      events: [],
    });
    return { accountId: owner.accountId, publicKey: keyPair.nearPublicKey };
  }

  accessKey(handle: KeyHandle): Readonly<AccessKeyRecord> {
    return this.key(handle);
  }

  private key(handle: KeyHandle): AccessKeyRecord {
    const k = this.accounts.get(handle.accountId)?.get(handle.publicKey);
    if (!k) throw new Error(`unknown access key ${handle.publicKey} for ${handle.accountId}`);
    return k;
  }

  // ------------------------------------------------------------------------------------------
  // clock
  // ------------------------------------------------------------------------------------------

  advanceTo(ms: number): void {
    if (ms < this.nowMs) throw new Error(`block time must be monotonic (${ms} < ${this.nowMs})`);
    this.nowMs = ms;
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.nowMs + ms);
  }

  // ------------------------------------------------------------------------------------------
  // contract lifecycle
  // ------------------------------------------------------------------------------------------

  /** Deploy + `new(owner_id, tee_signer_pubkey, usdc_token_id)` signed by the contract account. */
  deployParon(contractAccount: KeyHandle, ownerId: string, teeSignerPublicKey: string): CallOutcome {
    if (contractAccount.accountId !== this.contractId) throw new Error("deploy must be signed by the contract account");
    return this.execute(contractAccount, this.contractId, "new", { owner_id: ownerId, tee_signer_pubkey: teeSignerPublicKey, usdc_token_id: this.usdcTokenId }, 0n, 100, "DeployContract");
  }

  /** Signed contract call through the given access key. */
  call<T = unknown>(signer: KeyHandle, method: string, args: Record<string, unknown> = {}, opts: { depositYocto?: bigint; gasTgas?: number } = {}): CallOutcome<T> {
    return this.execute(signer, this.contractId, method, args, opts.depositYocto ?? 0n, opts.gasTgas ?? 30) as CallOutcome<T>;
  }

  view<T = unknown>(method: string, args: Record<string, unknown> = {}): T {
    if (!VIEW_METHODS.has(method)) throw new Error(`${method} is not a view method`);
    const ctx = this.context(this.contractId, this.contractId, 0n);
    return this.contract.withContext(ctx, () => this.contract.dispatch(method, args)) as T;
  }

  // ------------------------------------------------------------------------------------------
  // NEP-141 USDC token (usdc.fakes.testnet in local mode)
  // ------------------------------------------------------------------------------------------

  usdcWalletBalance(accountId: string): bigint {
    return this.usdcLedger.get(accountId) ?? 0n;
  }

  /** Bridge / faucet inflow into an account's USDC wallet (e.g. a 1Click solver delivering a swap). */
  creditUsdcWallet(accountId: string, amount: bigint): void {
    this.usdcLedger.set(accountId, this.usdcWalletBalance(accountId) + amount);
  }

  /**
   * `usdc.ft_transfer_call(receiver_id = paron, amount, msg)` signed by the holder's full-access key
   * (1 yoctoNEAR). The token contract calls `paron.ft_on_transfer`; a panic refunds the sender.
   */
  ftTransferCall(signer: KeyHandle, amount: bigint, msg: string): CallOutcome<string> {
    const key = this.key(signer);
    const args = { receiver_id: this.contractId, amount: amount.toString(), msg };
    const payload = { signer_id: signer.accountId, public_key: signer.publicKey, nonce: key.nonce + 1, receiver_id: this.usdcTokenId, actions: [{ FunctionCall: { method_name: "ft_transfer_call", args, gas: (100n * TGAS).toString(), deposit: "1" } }] };
    const { hash, signature } = this.sign(key, payload);
    const base = {
      tx_hash: hash,
      signer_id: signer.accountId,
      public_key: signer.publicKey,
      access_key: key.permission.kind,
      receiver_id: this.usdcTokenId,
      action: "FunctionCall" as const,
      method: "ft_transfer_call",
      args,
      deposit_yocto: "1",
      prepaid_gas_tgas: 100,
      signature,
    };
    if (key.permission.kind !== "FullAccess") {
      const tx = this.record({ ...base, status: "Failure", error: "InvalidAccessKeyError::DepositWithFunctionCall", error_kind: "InvalidTxError", events: [] });
      return { ok: false, error: tx.error, tx };
    }
    key.nonce += 1;
    const balance = this.usdcWalletBalance(signer.accountId);
    if (balance < amount) {
      const tx = this.record({ ...base, status: "Failure", error: "Smart contract panicked: The account doesn't have enough balance", error_kind: "FunctionCallError", events: [] });
      return { ok: false, error: tx.error, tx };
    }
    this.usdcLedger.set(signer.accountId, balance - amount);
    this.usdcLedger.set(this.contractId, this.usdcWalletBalance(this.contractId) + amount);
    const snapshot = structuredClone(this.contract.state);
    const ctx = this.context(this.usdcTokenId, signer.accountId, 0n);
    try {
      const unused = this.contract.withContext(ctx, () => this.contract.dispatch("ft_on_transfer", { sender_id: signer.accountId, amount: amount.toString(), msg }));
      const tx = this.record({ ...base, status: "SuccessValue", result: (amount - BigInt(unused as string)).toString(), events: parseEvents(ctx.logs) });
      return { ok: true, result: tx.result as string, tx };
    } catch (e) {
      this.contract.state = snapshot;
      this.usdcLedger.set(this.contractId, this.usdcWalletBalance(this.contractId) - amount);
      this.usdcLedger.set(signer.accountId, this.usdcWalletBalance(signer.accountId) + amount);
      const tx = this.record({ ...base, status: "SuccessValue", result: "0", error: `refunded: ${(e as Error).message}`, events: [] });
      return { ok: false, error: tx.error, tx };
    }
  }

  // ------------------------------------------------------------------------------------------
  // execution core
  // ------------------------------------------------------------------------------------------

  private context(predecessor: string, signer: string, deposit: bigint): CallContext {
    return { predecessor, signer, current_account_id: this.contractId, now_ms: this.nowMs, attached_deposit_yocto: deposit, logs: [] };
  }

  private sign(key: AccessKeyRecord, payload: unknown): { hash: string; signature: string } {
    const bytes = sha256(canonicalJson(payload));
    const sig = signEd25519(key.keyPair.secretKey, bytes);
    if (!verifyEd25519(sig, bytes, key.keyPair.publicKey)) throw new Error("InvalidSignature");
    return { hash: base58.encode(bytes), signature: `ed25519:${base58.encode(sig)}` };
  }

  private execute(signer: KeyHandle, receiverId: string, method: string, args: Record<string, unknown>, deposit: bigint, gasTgas: number, action: TxRecord["action"] = "FunctionCall"): CallOutcome {
    const key = this.key(signer);
    const nonce = key.nonce + 1;
    const payload = {
      signer_id: signer.accountId,
      public_key: signer.publicKey,
      nonce,
      receiver_id: receiverId,
      block_time_ms: this.nowMs,
      actions: [{ FunctionCall: { method_name: method, args, gas: (BigInt(gasTgas) * TGAS).toString(), deposit: deposit.toString() } }],
    };
    const { hash, signature } = this.sign(key, payload);
    const base = {
      tx_hash: hash,
      signer_id: signer.accountId,
      public_key: signer.publicKey,
      access_key: key.permission.kind,
      receiver_id: receiverId,
      action,
      method,
      args: toJsonValue(args),
      deposit_yocto: deposit.toString(),
      prepaid_gas_tgas: gasTgas,
      signature,
    };

    // ---- access-key verification (InvalidTxError: nothing executes, nonce unchanged) ----------
    const perm = key.permission;
    let invalid: string | null = null;
    const prepaidCost = BigInt(gasTgas) * TGAS * GAS_PRICE_YOCTO;
    if (perm.kind === "FunctionCall") {
      if (receiverId !== perm.receiverId) invalid = "InvalidAccessKeyError::ReceiverMismatch";
      else if (perm.methodNames.length > 0 && !perm.methodNames.includes(method)) invalid = `InvalidAccessKeyError::MethodNameMismatch { method_name: "${method}" }`;
      else if (deposit > 0n) invalid = "InvalidAccessKeyError::DepositWithFunctionCall";
      else if (perm.allowanceYocto !== null && perm.allowanceYocto < prepaidCost) invalid = "InvalidAccessKeyError::NotEnoughAllowance";
    }
    if (invalid) {
      const tx = this.record({ ...base, status: "Failure", error: invalid, error_kind: "InvalidTxError", events: [] });
      return { ok: false, error: invalid, tx };
    }
    key.nonce = nonce;
    if (perm.kind === "FunctionCall" && perm.allowanceYocto !== null) perm.allowanceYocto -= prepaidCost;

    if (VIEW_METHODS.has(method)) {
      const tx = this.record({ ...base, status: "Failure", error: "MethodResolveError::MethodNotFound (view methods are not callable in transactions)", error_kind: "FunctionCallError", events: [] });
      return { ok: false, error: tx.error, tx };
    }
    if (method !== "new" && !PAYABLE_METHODS.has(method) && deposit > 0n) {
      const tx = this.record({ ...base, status: "Failure", error: `Smart contract panicked: Method ${method} doesn't accept deposit`, error_kind: "FunctionCallError", events: [] });
      return { ok: false, error: tx.error, tx };
    }

    // ---- execution with atomic rollback ------------------------------------------------------
    const snapshot = this.contract.state ? structuredClone(this.contract.state) : undefined;
    const ctx = this.context(signer.accountId, signer.accountId, deposit);
    try {
      const result = this.contract.withContext(ctx, () => this.contract.dispatch(method, args));
      if (method === "withdraw_usdc") {
        const r = result as { account_id: string; amount: string };
        // Outgoing `ft_transfer` executed by the USDC token contract.
        this.usdcLedger.set(this.contractId, this.usdcWalletBalance(this.contractId) - BigInt(r.amount));
        this.creditUsdcWallet(r.account_id, BigInt(r.amount));
      }
      const tx = this.record({ ...base, status: "SuccessValue", result, events: parseEvents(ctx.logs) });
      return { ok: true, result, tx };
    } catch (e) {
      if (!(e instanceof ContractPanic)) throw e;
      if (snapshot) this.contract.state = snapshot;
      const error = `Smart contract panicked: ${e.message}`;
      const tx = this.record({ ...base, status: "Failure", error, error_kind: "FunctionCallError", events: [] });
      return { ok: false, error, tx };
    }
  }

  private record(partial: Omit<TxRecord, "index" | "block_time_ms">): TxRecord {
    const tx: TxRecord = { index: this.txs.length, block_time_ms: this.nowMs, ...partial };
    this.txs.push(tx);
    return tx;
  }
}

export function parseEvents(logs: string[]): unknown[] {
  return logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length)));
}
