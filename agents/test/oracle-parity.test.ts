import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyEd25519, hexToBytes } from "../src/crypto";
import { demoBundle, localDevSigner, computeCriTwap, demoIndexRequest, DEMO_T0_MS, MINUTE } from "../src/oracle/cri-oracle";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "../../shared/golden-vectors.json"), "utf8"));

test("TS oracle reproduces the Rust OutLayer worker golden vectors byte-for-byte", () => {
  const ts = demoBundle(localDevSigner());
  assert.deepEqual(ts.signer, golden.signer);
  assert.equal(ts.index_attestations.length, golden.index_attestations.length);
  ts.index_attestations.forEach((a, i) => {
    const g = golden.index_attestations[i];
    assert.equal(a.label, g.label);
    // Same payload -> same SHA-256 quote hash -> same deterministic RFC 8032 signature.
    assert.equal(a.attestation.payload_sha256_hex, g.attestation.payload_sha256_hex, `${a.label} payload`);
    assert.equal(a.attestation.tdx_quote_hash, g.attestation.tdx_quote_hash, `${a.label} quote hash`);
    assert.equal(a.attestation.signature_hex, g.attestation.signature_hex, `${a.label} signature`);
    assert.deepEqual(a.attestation, g.attestation);
  });
  ts.job_receipts.forEach((r, i) => assert.deepEqual(r, golden.job_receipts[i]));
});

test("spoofed feed is rejected and signatures verify against the enclave key", () => {
  const signer = localDevSigner();
  const a = computeCriTwap(demoIndexRequest("CU-2026-11", 2_800_000, DEMO_T0_MS + 5 * MINUTE, 9_800_000), signer);
  assert.equal(a.twap_micros, 2_800_000);
  assert.equal(a.rejected_count, 2);
  assert.ok(a.observations.filter((o) => !o.accepted).every((o) => o.source === "unverified-spoof-feed"));
  assert.ok(verifyEd25519(hexToBytes(a.signature_hex), a.signed_message, signer.keyPair.publicKey));
  assert.ok(!verifyEd25519(hexToBytes(a.signature_hex), a.signed_message.replace("2800000", "2900000"), signer.keyPair.publicKey));
});
