/**
 * Independent verification of a swarm audit receipt (used by `npm run verify:receipt` and the web tour):
 * 1. `receipt_sha256` = SHA-256(canonical JSON of every other field);
 * 2. every transaction's Ed25519 signature verifies against its access key (signature over the tx hash);
 * 3. every OutLayer attestation and execution receipt: `tdx_quote_hash` recomputes from
 *    measurement ‖ payload and the enclave signature verifies against `tee_signer_public_key`.
 */
import { base58, canonicalJson, hexToBytes, parseEd25519PublicKey, sha256Hex, verifyEd25519 } from "./crypto";
import { executionReceiptMessage, indexAttestationMessage, indexPayloadJson, jobPayloadJson, tdxQuoteHash, type AttestedCriIndex, type AttestedJobReceipt } from "./oracle/cri-oracle";

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReceiptVerification {
  ok: boolean;
  checks: VerificationCheck[];
}

interface ReceiptShape {
  receipt_sha256: string;
  tee_signer_public_key: string;
  transactions: Array<{ tx_hash: string; public_key: string; signature: string; method: string }>;
  outlayer: { index_attestations: Array<{ attestation: AttestedCriIndex }>; job_receipts: AttestedJobReceipt[] };
}

export function verifyAttestation(a: AttestedCriIndex, teeKey: Uint8Array): boolean {
  const hash = tdxQuoteHash(hexToBytes(a.enclave_measurement_hex), indexPayloadJson(a));
  const message = indexAttestationMessage(a.series_id, a.twap_micros, a.observed_at_ms, hash);
  return hash === a.tdx_quote_hash && message === a.signed_message && verifyEd25519(hexToBytes(a.signature_hex), message, teeKey);
}

export function verifyJobReceipt(r: AttestedJobReceipt, teeKey: Uint8Array): boolean {
  const hash = tdxQuoteHash(hexToBytes(r.enclave_measurement_hex), jobPayloadJson(r));
  const message = executionReceiptMessage(r.request_id, hash, r.measured_latency_ms, r.sla_met);
  return hash === r.tdx_quote_hash && message === r.signed_message && verifyEd25519(hexToBytes(r.signature_hex), message, teeKey);
}

export function verifyReceipt(input: unknown): ReceiptVerification {
  const receipt = input as ReceiptShape;
  const checks: VerificationCheck[] = [];
  const { receipt_sha256, ...body } = receipt as ReceiptShape & Record<string, unknown>;
  const digest = sha256Hex(canonicalJson(body));
  checks.push({ name: "receipt digest", ok: digest === receipt_sha256, detail: `sha256 ${digest}` });

  let validTx = 0;
  const badTx: string[] = [];
  for (const tx of receipt.transactions) {
    const ok = verifyEd25519(base58.decode(tx.signature.replace(/^ed25519:/, "")), base58.decode(tx.tx_hash), parseEd25519PublicKey(tx.public_key));
    if (ok) validTx += 1;
    else badTx.push(`${tx.method}:${tx.tx_hash}`);
  }
  checks.push({
    name: "transaction signatures",
    ok: badTx.length === 0 && validTx > 0,
    detail: badTx.length === 0 ? `${validTx}/${receipt.transactions.length} Ed25519 tx signatures valid` : `invalid: ${badTx.join(", ")}`,
  });

  const teeKey = parseEd25519PublicKey(receipt.tee_signer_public_key);
  const atts = receipt.outlayer.index_attestations.map((x) => x.attestation);
  const attOk = atts.filter((a) => verifyAttestation(a, teeKey)).length;
  checks.push({ name: "OutLayer index attestations", ok: attOk === atts.length && atts.length > 0, detail: `${attOk}/${atts.length} quote hashes + enclave signatures valid` });
  const jobs = receipt.outlayer.job_receipts;
  const jobOk = jobs.filter((r) => verifyJobReceipt(r, teeKey)).length;
  checks.push({ name: "OutLayer TDX execution receipts", ok: jobOk === jobs.length && jobs.length > 0, detail: `${jobOk}/${jobs.length} quote hashes + enclave signatures valid` });
  return { ok: checks.every((c) => c.ok), checks };
}
