/**
 * Cryptographic primitives shared by the swarm, the local NEAR runtime and the OutLayer oracle mirror.
 * Ed25519 is RFC 8032 (identical to ed25519-dalek and NEAR's `env::ed25519_verify`), so signatures
 * produced here are byte-identical to the Rust worker's.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";

export { bytesToHex, hexToBytes, utf8ToBytes, base58 };

export type Bytes = Uint8Array;

const toBytes = (data: Bytes | string): Bytes => (typeof data === "string" ? utf8ToBytes(data) : data);

export function sha256(data: Bytes | string): Bytes {
  return nobleSha256(toBytes(data));
}

export function sha256Hex(data: Bytes | string): string {
  return bytesToHex(sha256(data));
}

export interface Ed25519KeyPair {
  /** Public label the key was derived from (local deterministic mode only). */
  label: string;
  secretKey: Bytes;
  publicKey: Bytes;
  publicKeyHex: string;
  /** `ed25519:<base58>` (NEAR format). */
  nearPublicKey: string;
}

/**
 * Deterministic Ed25519 key from a *public* label (seed = SHA-256(label)). Used only in zero-config
 * local mode so every run is reproducible — the same idea as Hardhat's well-known dev accounts.
 */
export function deterministicKeyPair(label: string): Ed25519KeyPair {
  return keyPairFromSeed(sha256(label), label);
}

export function keyPairFromSeed(seed: Bytes, label = "seed"): Ed25519KeyPair {
  if (seed.length !== 32) throw new Error("ed25519 seed must be 32 bytes");
  const publicKey = ed25519.getPublicKey(seed);
  return { label, secretKey: seed, publicKey, publicKeyHex: bytesToHex(publicKey), nearPublicKey: nearPublicKey(publicKey) };
}

export function signEd25519(secretKey: Bytes, message: Bytes | string): Bytes {
  return ed25519.sign(toBytes(message), secretKey);
}

export function verifyEd25519(signature: Bytes, message: Bytes | string, publicKey: Bytes): boolean {
  try {
    return ed25519.verify(signature, toBytes(message), publicKey);
  } catch {
    return false;
  }
}

export function nearPublicKey(publicKey: Bytes): string {
  return `ed25519:${base58.encode(publicKey)}`;
}

/** Accepts `ed25519:<base58>` or 64 hex chars. */
export function parseEd25519PublicKey(value: string): Bytes {
  if (value.startsWith("ed25519:")) {
    const raw = base58.decode(value.slice("ed25519:".length));
    if (raw.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
    return raw;
  }
  const raw = hexToBytes(value);
  if (raw.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return raw;
}

/** Deterministic JSON with sorted keys; bigint is rendered as a decimal string (NEAR U128 semantics). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** JSON-safe deep copy converting bigint to strings (the shape returned by the NEAR contract). */
export function toJsonValue<T = unknown>(value: unknown): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}
