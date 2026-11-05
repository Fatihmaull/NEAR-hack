/**
 * NEAR Chain Signatures — deterministic multi-chain address derivation and MPC sign-request payloads.
 *
 * Derivation is the MPC network's additive key derivation, byte-compatible with `chainsig.js`
 * (cross-checked: see test/chain-signatures.test.ts):
 *   epsilon        = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:{predecessor},{path}")
 *   secp256k1 (0)  = root + epsilon(BE) · G          -> EVM address = keccak256(X‖Y)[12..]
 *   ed25519   (1)  = root + (epsilon(LE) mod ℓ) · B  -> Solana address = base58(point)
 * Root keys are the published keys of `v1.signer-prod.testnet` / `v1.signer` (public data).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToNumberBE, bytesToNumberLE } from "@noble/curves/utils.js";
import { keccak_256, sha3_256 } from "@noble/hashes/sha3.js";
import { base58, bytesToHex, hexToBytes, utf8ToBytes } from "./crypto";

export type NearNetwork = "testnet" | "mainnet";

export const MPC_CONTRACT_IDS: Readonly<Record<NearNetwork, string>> = { testnet: "v1.signer-prod.testnet", mainnet: "v1.signer" };

/** Published MPC root keys (as shipped in chainsig.js v1.1.16 `constants.ROOT_PUBLIC_KEYS`). */
export const MPC_ROOT_PUBLIC_KEYS: Readonly<Record<NearNetwork, { secp256k1: string; ed25519: string }>> = {
  testnet: {
    secp256k1: "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3",
    ed25519: "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2",
  },
  mainnet: {
    secp256k1: "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya",
    ed25519: "ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF",
  },
};

export const EPSILON_DERIVATION_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";
/** Gas the MPC `sign` call reserves (300 TGas, as used by chainsig.js). */
export const MPC_SIGN_GAS = "300000000000000";

export function deriveEpsilon(predecessor: string, path: string): Uint8Array {
  return sha3_256(utf8ToBytes(`${EPSILON_DERIVATION_PREFIX}${predecessor},${path}`));
}

/** Uncompressed SEC1 (0x04‖X‖Y) child key for `predecessor` + `path` (domain 0, ECDSA). */
export function deriveSecp256k1ChildPublicKey(rootNaj: string, predecessor: string, path: string): Uint8Array {
  const raw = base58.decode(rootNaj.replace(/^secp256k1:/, ""));
  const root = secp256k1.Point.fromBytes(Uint8Array.from([0x04, ...raw]));
  const tweak = bytesToNumberBE(deriveEpsilon(predecessor, path));
  return root.add(secp256k1.Point.BASE.multiply(tweak)).toBytes(false);
}

/** Ed25519 child key for `predecessor` + `path` (domain 1, EdDSA). */
export function deriveEd25519ChildPublicKey(rootNaj: string, predecessor: string, path: string): Uint8Array {
  const root = ed25519.Point.fromBytes(base58.decode(rootNaj.replace(/^ed25519:/, "")));
  const tweak = bytesToNumberLE(deriveEpsilon(predecessor, path)) % ed25519.Point.Fn.ORDER;
  return root.add(ed25519.Point.BASE.multiply(tweak)).toBytes();
}

/** EIP-55 checksummed address from an uncompressed secp256k1 key. */
export function evmAddressFromPublicKey(uncompressed: Uint8Array): string {
  const lower = bytesToHex(keccak_256(uncompressed.slice(1))).slice(-40);
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  return `0x${[...lower].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}

export interface AgentMultichainAddresses {
  nearAccountId: string;
  network: NearNetwork;
  mpcContractId: string;
  derivationPath: string;
  evm: { domainId: 0; scheme: "secp256k1/ECDSA"; publicKeyHex: string; address: string; chains: string[] };
  solana: { domainId: 1; scheme: "ed25519/EdDSA"; publicKey: string; address: string };
  epsilonHex: string;
}

/** Deterministically derive the EVM (Ethereum/Base) and Solana addresses an agent controls via MPC. */
export function deriveAgentMultichainAddresses(nearAccountId: string, derivationPath: string, network: NearNetwork = "testnet"): AgentMultichainAddresses {
  const roots = MPC_ROOT_PUBLIC_KEYS[network];
  const evmKey = deriveSecp256k1ChildPublicKey(roots.secp256k1, nearAccountId, derivationPath);
  const solKey = deriveEd25519ChildPublicKey(roots.ed25519, nearAccountId, derivationPath);
  const sol = base58.encode(solKey);
  return {
    nearAccountId,
    network,
    mpcContractId: MPC_CONTRACT_IDS[network],
    derivationPath,
    evm: {
      domainId: 0,
      scheme: "secp256k1/ECDSA",
      publicKeyHex: bytesToHex(evmKey),
      address: evmAddressFromPublicKey(evmKey),
      chains: network === "mainnet" ? ["Ethereum", "Base", "Arbitrum"] : ["Ethereum Sepolia", "Base Sepolia"],
    },
    solana: { domainId: 1, scheme: "ed25519/EdDSA", publicKey: `ed25519:${sol}`, address: sol },
    epsilonHex: bytesToHex(deriveEpsilon(nearAccountId, derivationPath)),
  };
}

export interface MpcSignRequest {
  receiverId: string;
  methodName: "sign";
  args: { request: { payload_v2: { Ecdsa: string } | { Eddsa: string }; path: string; domain_id: 0 | 1 } };
  gas: string;
  /** `sign` requires 1 yoctoNEAR, so it is submitted by the treasury's full-access key (or a proxy contract). */
  deposit: "1";
}

export function buildMpcSignRequest(payload: Uint8Array, path: string, scheme: "Ecdsa" | "Eddsa", network: NearNetwork = "testnet"): MpcSignRequest {
  const hex = bytesToHex(payload);
  return {
    receiverId: MPC_CONTRACT_IDS[network],
    methodName: "sign",
    args: { request: { payload_v2: scheme === "Ecdsa" ? { Ecdsa: hex } : { Eddsa: hex }, path, domain_id: scheme === "Ecdsa" ? 0 : 1 } },
    gas: MPC_SIGN_GAS,
    deposit: "1",
  };
}

// ---------------------------------------------------------------------------------------------
// EVM: EIP-1559 ERC-20 transfer payload (what the MPC network signs for a Base USDC deposit)
// ---------------------------------------------------------------------------------------------

const bigToBytes = (v: bigint): Uint8Array => (v === 0n ? new Uint8Array() : hexToBytes(v.toString(16).padStart(Math.ceil(v.toString(16).length / 2) * 2, "0")));

export function rlpEncode(item: Uint8Array | Uint8Array[] | unknown[]): Uint8Array {
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const lengthPrefix = (len: number, offset: number): Uint8Array => {
    if (len <= 55) return Uint8Array.of(offset + len);
    const lenBytes = bigToBytes(BigInt(len));
    return Uint8Array.of(offset + 55 + lenBytes.length, ...lenBytes);
  };
  if (Array.isArray(item)) {
    const payload = concat(item.map((i) => rlpEncode(i as Uint8Array)));
    return concat([lengthPrefix(payload.length, 0xc0), payload]);
  }
  const bytes = item as Uint8Array;
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return concat([lengthPrefix(bytes.length, 0x80), bytes]);
}

export interface Erc20TransferTx {
  chainId: bigint;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  token: string;
  to: string;
  amount: bigint;
}

export function buildErc20TransferPayload(tx: Erc20TransferTx): { unsignedTxHex: string; signingPayload: Uint8Array; calldataHex: string } {
  const pad32 = (hex: string): string => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const calldataHex = `a9059cbb${pad32(tx.to)}${pad32(tx.amount.toString(16))}`;
  const fields = [
    bigToBytes(tx.chainId),
    bigToBytes(tx.nonce),
    bigToBytes(tx.maxPriorityFeePerGas),
    bigToBytes(tx.maxFeePerGas),
    bigToBytes(tx.gasLimit),
    hexToBytes(tx.token.replace(/^0x/, "").toLowerCase()),
    new Uint8Array(),
    hexToBytes(calldataHex),
    [],
  ];
  const body = rlpEncode(fields);
  const unsigned = Uint8Array.of(0x02, ...body);
  return { unsignedTxHex: `0x${bytesToHex(unsigned)}`, signingPayload: keccak_256(unsigned), calldataHex: `0x${calldataHex}` };
}

// ---------------------------------------------------------------------------------------------
// Solana: legacy SystemProgram::Transfer message (Ed25519 MPC signs the raw message bytes)
// ---------------------------------------------------------------------------------------------

export const SOLANA_SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function buildSolanaTransferMessage(from: string, to: string, lamports: bigint, recentBlockhash: string): Uint8Array {
  const u64le = (v: bigint): number[] => Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
  const keys = [from, to, SOLANA_SYSTEM_PROGRAM].map((k) => base58.decode(k));
  if (keys.some((k) => k.length !== 32)) throw new Error("solana keys must be 32 bytes");
  const blockhash = base58.decode(recentBlockhash);
  const data = [2, 0, 0, 0, ...u64le(lamports)]; // SystemInstruction::Transfer
  return Uint8Array.from([1, 0, 1, 3, ...keys.flatMap((k) => [...k]), ...blockhash, 1, 2, 2, 0, 1, data.length, ...data]);
}
