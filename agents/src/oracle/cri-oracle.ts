/**
 * TypeScript mirror of `tee-worker/outlayer-cri-oracle` (local deterministic mode).
 *
 * Produces byte-identical payloads, `tdx_quote_hash`es and Ed25519 signatures to the Rust worker —
 * enforced by `test/oracle-parity.test.ts` against `shared/golden-vectors.json`, which the Rust worker
 * generates and itself re-checks in `cargo test`. In live mode the swarm calls the real OutLayer
 * worker instead (see `OutlayerClient`).
 */
import { bytesToHex, deterministicKeyPair, keyPairFromSeed, nearPublicKey, sha256, signEd25519, utf8ToBytes, type Ed25519KeyPair } from "../crypto";
import type { GpuTier } from "../engine/types";

export const INDEX_ID = "CRI-H100";
export const WORKER_ID = "paron-outlayer-cri-oracle";
/** Must equal `version` in tee-worker/outlayer-cri-oracle/Cargo.toml (checked by the golden vectors). */
export const WORKER_VERSION = "0.2.0";
export const LOCAL_DEV_KEY_LABEL = "paron/outlayer-cri-oracle/local-dev-enclave-key/v1";
export const LOCAL_DEV_MEASUREMENT_LABEL = "paron/outlayer-cri-oracle/local-dev-measurement/v1";

const BPS = 10_000n;
const CU_SCALE = 10_000n;
const MAD_TO_SIGMA_X10K = 14_826n;
const SIGMA_BAND = 2n;
const SIGMA_FLOOR_BPS = 50n;
const MIN_BUCKET_OBSERVATIONS = 3;

const WEIGHT: Record<GpuTier, bigint> = { A100: 4_500n, H100: 10_000n, H200: 14_000n, B200: 25_000n, GB200: 35_000n };

export interface SpotObservation {
  source: string;
  gpu_tier: GpuTier;
  usd_per_gpu_hour_micros: number;
  volume_gpu_hours: number;
  observed_at_ms: number;
}

export interface IndexRequest {
  series_id: string;
  window_start_ms: number;
  window_end_ms: number;
  bucket_ms: number;
  observations: SpotObservation[];
}

export interface ObservationVerdict {
  source: string;
  gpu_tier: GpuTier;
  raw_price_micros: number;
  h100_equivalent_micros: number;
  volume_gpu_hours: number;
  observed_at_ms: number;
  bucket: number;
  accepted: boolean;
  deviation_sigma_milli: number;
}

export interface BucketStat {
  bucket: number;
  median_micros: number;
  mad_micros: number;
  sigma_micros: number;
  accepted: number;
  rejected: number;
  vwap_micros: number;
}

export interface AttestedCriIndex {
  index_id: string;
  series_id: string;
  twap_micros: number;
  window_start_ms: number;
  window_end_ms: number;
  observed_at_ms: number;
  buckets: BucketStat[];
  observations: ObservationVerdict[];
  accepted_count: number;
  rejected_count: number;
  worker: string;
  signer_mode: string;
  enclave_measurement_hex: string;
  payload_sha256_hex: string;
  tdx_quote_hash: string;
  signed_message: string;
  signature_hex: string;
  signer_pubkey_hex: string;
  signer_public_key: string;
}

export interface InferenceJobLog {
  request_id: number;
  job_id: string;
  agent_account: string;
  provider_account: string;
  model: string;
  gpu_tier: GpuTier;
  gpu_count: number;
  started_at_ms: number;
  total_duration_ms: number;
  ttft_ms: number;
  tokens_generated: number;
  vram_allocated_gb: number;
}

export interface SlaPolicy {
  max_ttft_ms: number;
  min_tokens_per_sec: number;
  min_vram_gb: number;
}

export const DEFAULT_SLA: SlaPolicy = { max_ttft_ms: 500, min_tokens_per_sec: 40, min_vram_gb: 80 };

export interface AttestedJobReceipt {
  /** The full measured log, so anyone can recompute `tdx_quote_hash` from the receipt alone. */
  log: InferenceJobLog;
  request_id: number;
  job_id: string;
  agent_account: string;
  provider_account: string;
  model: string;
  gpu_tier: GpuTier;
  gpu_count: number;
  gpu_hours_scaled: number;
  cu_consumed_scaled: number;
  ttft_ms: number;
  tokens_per_sec_milli: number;
  vram_allocated_gb: number;
  measured_latency_ms: number;
  sla: SlaPolicy;
  sla_met: boolean;
  violations: string[];
  worker: string;
  signer_mode: string;
  enclave_measurement_hex: string;
  payload_sha256_hex: string;
  tdx_quote_hash: string;
  signed_message: string;
  signature_hex: string;
  signer_pubkey_hex: string;
  signer_public_key: string;
}

export interface EnclaveSigner {
  keyPair: Ed25519KeyPair;
  measurement: Uint8Array;
  mode: string;
}

export function localDevMeasurement(): Uint8Array {
  return sha256(`${LOCAL_DEV_MEASUREMENT_LABEL}|${WORKER_ID}@${WORKER_VERSION}`);
}

/** The publicly known local-dev enclave key (zero-config reproducibility; never value-bearing). */
export function localDevSigner(): EnclaveSigner {
  return { keyPair: deterministicKeyPair(LOCAL_DEV_KEY_LABEL), measurement: localDevMeasurement(), mode: "local-dev-deterministic" };
}

/** `PARON_TEE_SIGNING_SEED_HEX`-style secret seed (mirrors `LocalSigner::from_seed_hex`). */
export function seedSigner(seedHex: string): EnclaveSigner {
  const seed = Uint8Array.from(seedHex.match(/../g)!.map((b) => parseInt(b, 16)));
  return { keyPair: keyPairFromSeed(seed, "env-secret-seed"), measurement: localDevMeasurement(), mode: "env-secret-seed" };
}

export const indexAttestationMessage = (seriesId: string, twap: number, observedAt: number, hash: string): string => `${seriesId}:${twap}:${observedAt}:${hash}`;
export const executionReceiptMessage = (requestId: number, hash: string, latency: number, slaMet: boolean): string => `${requestId}:${hash}:${latency}:${slaMet}`;

export function tdxQuoteHash(measurement: Uint8Array, payloadJson: string): string {
  const payload = utf8ToBytes(payloadJson);
  const data = new Uint8Array(measurement.length + payload.length);
  data.set(measurement, 0);
  data.set(payload, measurement.length);
  return bytesToHex(sha256(data));
}

export const normalizeToH100 = (tier: GpuTier, raw: number): number => Number((BigInt(raw) * BPS) / WEIGHT[tier]);

const cmp = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
const absDiff = (a: bigint, b: bigint): bigint => (a > b ? a - b : b - a);

function median(sorted: bigint[]): bigint {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2n;
}

export function robustStats(values: bigint[]): [bigint, bigint, bigint] {
  const sorted = [...values].sort(cmp);
  const m = median(sorted);
  const deviations = values.map((v) => absDiff(v, m)).sort(cmp);
  const mad = median(deviations);
  const sigma = (mad * MAD_TO_SIGMA_X10K) / BPS;
  const floor = (m * SIGMA_FLOOR_BPS) / BPS;
  let s = sigma > floor ? sigma : floor;
  if (s < 1n) s = 1n;
  return [m, mad, s];
}

function sign(signer: EnclaveSigner, message: string): string {
  return bytesToHex(signEd25519(signer.keyPair.secretKey, message));
}

const orderedBucket = (b: BucketStat): BucketStat => ({
  bucket: b.bucket,
  median_micros: b.median_micros,
  mad_micros: b.mad_micros,
  sigma_micros: b.sigma_micros,
  accepted: b.accepted,
  rejected: b.rejected,
  vwap_micros: b.vwap_micros,
});
const orderedVerdict = (o: ObservationVerdict): ObservationVerdict => ({
  source: o.source,
  gpu_tier: o.gpu_tier,
  raw_price_micros: o.raw_price_micros,
  h100_equivalent_micros: o.h100_equivalent_micros,
  volume_gpu_hours: o.volume_gpu_hours,
  observed_at_ms: o.observed_at_ms,
  bucket: o.bucket,
  accepted: o.accepted,
  deviation_sigma_milli: o.deviation_sigma_milli,
});
const orderedLog = (l: InferenceJobLog): InferenceJobLog => ({
  request_id: l.request_id,
  job_id: l.job_id,
  agent_account: l.agent_account,
  provider_account: l.provider_account,
  model: l.model,
  gpu_tier: l.gpu_tier,
  gpu_count: l.gpu_count,
  started_at_ms: l.started_at_ms,
  total_duration_ms: l.total_duration_ms,
  ttft_ms: l.ttft_ms,
  tokens_generated: l.tokens_generated,
  vram_allocated_gb: l.vram_allocated_gb,
});

/** Canonical index payload — field order mirrors the Rust `IndexPayload` struct (serde declaration order). */
export function indexPayloadJson(a: Pick<AttestedCriIndex, "series_id" | "twap_micros" | "window_start_ms" | "window_end_ms" | "buckets" | "observations" | "worker">): string {
  return JSON.stringify({
    index_id: INDEX_ID,
    series_id: a.series_id,
    twap_micros: a.twap_micros,
    window_start_ms: a.window_start_ms,
    window_end_ms: a.window_end_ms,
    buckets: a.buckets.map(orderedBucket),
    observations: a.observations.map(orderedVerdict),
    worker: a.worker,
  });
}

/** Canonical job payload — mirrors the Rust `JobPayload` / `InferenceJobLog` / `SlaPolicy` structs. */
export function jobPayloadJson(r: Pick<AttestedJobReceipt, "log" | "sla" | "gpu_hours_scaled" | "cu_consumed_scaled" | "tokens_per_sec_milli" | "sla_met" | "violations" | "worker">): string {
  return JSON.stringify({
    log: orderedLog(r.log),
    sla: { max_ttft_ms: r.sla.max_ttft_ms, min_tokens_per_sec: r.sla.min_tokens_per_sec, min_vram_gb: r.sla.min_vram_gb },
    gpu_hours_scaled: r.gpu_hours_scaled,
    cu_consumed_scaled: r.cu_consumed_scaled,
    tokens_per_sec_milli: r.tokens_per_sec_milli,
    sla_met: r.sla_met,
    violations: r.violations,
    worker: r.worker,
  });
}

export function computeCriTwap(request: IndexRequest, signer: EnclaveSigner): AttestedCriIndex {
  if (request.observations.length === 0) throw new Error("no spot observations supplied");
  if (request.window_end_ms <= request.window_start_ms || request.bucket_ms === 0) throw new Error("invalid observation window");
  const span = request.window_end_ms - request.window_start_ms;
  const bucketCount = Math.ceil(span / request.bucket_ms);
  const verdicts: ObservationVerdict[] = request.observations.map((o) => {
    if (o.usd_per_gpu_hour_micros === 0 || o.volume_gpu_hours === 0) throw new Error(`invalid observation: ${o.source}: zero price or volume`);
    if (o.observed_at_ms < request.window_start_ms || o.observed_at_ms > request.window_end_ms) throw new Error(`invalid observation: ${o.source}: outside window`);
    const bucket = Math.min(Math.floor((o.observed_at_ms - request.window_start_ms) / request.bucket_ms), bucketCount - 1);
    return {
      source: o.source,
      gpu_tier: o.gpu_tier,
      raw_price_micros: o.usd_per_gpu_hour_micros,
      h100_equivalent_micros: normalizeToH100(o.gpu_tier, o.usd_per_gpu_hour_micros),
      volume_gpu_hours: o.volume_gpu_hours,
      observed_at_ms: o.observed_at_ms,
      bucket,
      accepted: false,
      deviation_sigma_milli: 0,
    };
  });
  const windowStats = robustStats(verdicts.map((v) => BigInt(v.h100_equivalent_micros)));
  const buckets: BucketStat[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const idx = verdicts.map((v, i) => (v.bucket === b ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) continue;
    const [m, mad, sigma] = idx.length >= MIN_BUCKET_OBSERVATIONS ? robustStats(idx.map((i) => BigInt(verdicts[i].h100_equivalent_micros))) : windowStats;
    let accepted = 0;
    let rejected = 0;
    let pv = 0n;
    let vol = 0n;
    for (const i of idx) {
      const v = verdicts[i];
      const dev = absDiff(BigInt(v.h100_equivalent_micros), m);
      v.deviation_sigma_milli = Number((dev * 1_000n) / sigma);
      v.accepted = dev <= SIGMA_BAND * sigma;
      if (v.accepted) {
        accepted += 1;
        pv += BigInt(v.h100_equivalent_micros) * BigInt(v.volume_gpu_hours);
        vol += BigInt(v.volume_gpu_hours);
      } else rejected += 1;
    }
    if (accepted === 0) continue;
    buckets.push({ bucket: b, median_micros: Number(m), mad_micros: Number(mad), sigma_micros: Number(sigma), accepted, rejected, vwap_micros: Number(pv / vol) });
  }
  if (buckets.length === 0) throw new Error("every observation was rejected as an outlier");
  const twap = Number(buckets.reduce((a, b) => a + BigInt(b.vwap_micros), 0n) / BigInt(buckets.length));
  const acceptedCount = verdicts.filter((v) => v.accepted).length;
  const worker = `${WORKER_ID}@${WORKER_VERSION}`;
  const payload = indexPayloadJson({
    series_id: request.series_id,
    twap_micros: twap,
    window_start_ms: request.window_start_ms,
    window_end_ms: request.window_end_ms,
    buckets,
    observations: verdicts,
    worker,
  });
  const quoteHash = tdxQuoteHash(signer.measurement, payload);
  const message = indexAttestationMessage(request.series_id, twap, request.window_end_ms, quoteHash);
  return {
    index_id: INDEX_ID,
    series_id: request.series_id,
    twap_micros: twap,
    window_start_ms: request.window_start_ms,
    window_end_ms: request.window_end_ms,
    observed_at_ms: request.window_end_ms,
    buckets,
    observations: verdicts,
    accepted_count: acceptedCount,
    rejected_count: verdicts.length - acceptedCount,
    worker,
    signer_mode: signer.mode,
    enclave_measurement_hex: bytesToHex(signer.measurement),
    payload_sha256_hex: bytesToHex(sha256(payload)),
    tdx_quote_hash: quoteHash,
    signed_message: message,
    signature_hex: sign(signer, message),
    signer_pubkey_hex: signer.keyPair.publicKeyHex,
    signer_public_key: nearPublicKey(signer.keyPair.publicKey),
  };
}

export function verifyInferenceJob(log: InferenceJobLog, sla: SlaPolicy, signer: EnclaveSigner): AttestedJobReceipt {
  if (log.gpu_count === 0 || log.total_duration_ms === 0) throw new Error("invalid inference job log: gpu_count and total_duration_ms must be positive");
  if (log.ttft_ms > log.total_duration_ms) throw new Error("invalid inference job log: ttft exceeds total duration");
  const gpuHoursScaled = (BigInt(log.gpu_count) * BigInt(log.total_duration_ms) * CU_SCALE) / 3_600_000n;
  const cuConsumed = (gpuHoursScaled * WEIGHT[log.gpu_tier]) / BPS;
  const decodeMs = BigInt(Math.max(log.total_duration_ms - log.ttft_ms, 1));
  const tpsMilli = (BigInt(log.tokens_generated) * 1_000_000n) / decodeMs;
  const violations: string[] = [];
  if (log.ttft_ms > sla.max_ttft_ms) violations.push(`ttft ${log.ttft_ms}ms > ${sla.max_ttft_ms}ms`);
  if (tpsMilli < BigInt(sla.min_tokens_per_sec) * 1_000n)
    violations.push(`throughput ${tpsMilli / 1_000n}.${(tpsMilli % 1_000n).toString().padStart(3, "0")} tok/s < ${sla.min_tokens_per_sec} tok/s`);
  if (log.vram_allocated_gb < sla.min_vram_gb) violations.push(`vram ${log.vram_allocated_gb}GB < ${sla.min_vram_gb}GB`);
  const slaMet = violations.length === 0;
  const worker = `${WORKER_ID}@${WORKER_VERSION}`;
  const payload = jobPayloadJson({
    log,
    sla,
    gpu_hours_scaled: Number(gpuHoursScaled),
    cu_consumed_scaled: Number(cuConsumed),
    tokens_per_sec_milli: Number(tpsMilli),
    sla_met: slaMet,
    violations,
    worker,
  });
  const quoteHash = tdxQuoteHash(signer.measurement, payload);
  const message = executionReceiptMessage(log.request_id, quoteHash, log.ttft_ms, slaMet);
  return {
    log: orderedLog(log),
    request_id: log.request_id,
    job_id: log.job_id,
    agent_account: log.agent_account,
    provider_account: log.provider_account,
    model: log.model,
    gpu_tier: log.gpu_tier,
    gpu_count: log.gpu_count,
    gpu_hours_scaled: Number(gpuHoursScaled),
    cu_consumed_scaled: Number(cuConsumed),
    ttft_ms: log.ttft_ms,
    tokens_per_sec_milli: Number(tpsMilli),
    vram_allocated_gb: log.vram_allocated_gb,
    measured_latency_ms: log.ttft_ms,
    sla: { ...sla },
    sla_met: slaMet,
    violations,
    worker,
    signer_mode: signer.mode,
    enclave_measurement_hex: bytesToHex(signer.measurement),
    payload_sha256_hex: bytesToHex(sha256(payload)),
    tdx_quote_hash: quoteHash,
    signed_message: message,
    signature_hex: sign(signer, message),
    signer_pubkey_hex: signer.keyPair.publicKeyHex,
    signer_public_key: nearPublicKey(signer.keyPair.publicKey),
  };
}

// ---------------------------------------------------------------------------------------------
// Deterministic demo scenario (mirror of `scenario` in the Rust worker)
// ---------------------------------------------------------------------------------------------

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
/** 2026-11-05T09:00:00Z */
export const DEMO_T0_MS = 1_793_869_200_000;
/** 2026-12-01T00:00:00Z — first instant after the CU-2026-11 maturity. */
export const DEMO_FINAL_WINDOW_END_MS = 1_796_083_200_000;
/** 2026-12-02T09:00:00Z */
export const DEMO_JOBS_START_MS = DEMO_FINAL_WINDOW_END_MS + DAY + 9 * 60 * MINUTE;

export const DEMO_INDEX_PATH: ReadonlyArray<{ label: string; series: string; target: number; windowEnd: number; spoof: number }> = [
  { label: "baseline", series: "CU-2026-11", target: 2_800_000, windowEnd: DEMO_T0_MS + 5 * MINUTE, spoof: 9_800_000 },
  { label: "spike-1", series: "CU-2026-11", target: 3_050_000, windowEnd: DEMO_T0_MS + 7 * DAY, spoof: 1_100_000 },
  { label: "spike-2", series: "CU-2026-11", target: 3_350_000, windowEnd: DEMO_T0_MS + 14 * DAY, spoof: 1_150_000 },
  { label: "spike-3", series: "CU-2026-11", target: 3_700_000, windowEnd: DEMO_T0_MS + 20 * DAY, spoof: 1_200_000 },
  { label: "final-settlement", series: "CU-2026-11", target: 4_100_000, windowEnd: DEMO_FINAL_WINDOW_END_MS, spoof: 1_250_000 },
  { label: "dec-reference", series: "CU-2026-12", target: 3_400_000, windowEnd: DEMO_FINAL_WINDOW_END_MS, spoof: 9_900_000 },
];

const scale = (target: number, weightBps: bigint): number => Number((BigInt(target) * weightBps) / BPS);

/** Honest multi-tier feeds whose H100-equivalent VWAP is exactly `target`, plus one spoofed feed. */
export function demoIndexRequest(seriesId: string, target: number, windowEndMs: number, manipulatedPrice: number): IndexRequest {
  const start = windowEndMs - 60 * MINUTE;
  const observations: SpotObservation[] = [];
  const obs = (source: string, gpu_tier: GpuTier, price: number, volume: number, at: number): SpotObservation => ({
    source,
    gpu_tier,
    usd_per_gpu_hour_micros: price,
    volume_gpu_hours: volume,
    observed_at_ms: at,
  });
  for (const [bucket, at] of [
    [0, start + 10 * MINUTE],
    [1, start + 40 * MINUTE],
  ] as const) {
    const skew = bucket * 2_000;
    observations.push(obs("near-ai-cloud-spot", "H100", target - 10_000 - skew, 120, at));
    observations.push(obs("akash-h100-spot", "H100", target + 10_000 + skew, 120, at + MINUTE));
    observations.push(obs("lambda-h200-reference", "H200", scale(target, 14_000n), 80, at + 2 * MINUTE));
    observations.push(obs("asean-tier3-a100-wholesale", "A100", scale(target, 4_500n), 60, at + 3 * MINUTE));
    observations.push(obs("render-b200-reference", "B200", scale(target, 25_000n), 40, at + 4 * MINUTE));
    observations.push(obs("unverified-spoof-feed", "H100", manipulatedPrice, 400, at + 5 * MINUTE));
  }
  return { series_id: seriesId, window_start_ms: start, window_end_ms: windowEndMs, bucket_ms: 30 * MINUTE, observations };
}

export function happyJob(requestId: number, startedAtMs: number, agent = "consumer.swarm-treasury.testnet", provider = "batam-h100.testnet"): InferenceJobLog {
  return {
    request_id: requestId,
    job_id: "job-1-llama-70b-batch",
    agent_account: agent,
    provider_account: provider,
    model: "llama-3.3-70b-instruct",
    gpu_tier: "H100",
    gpu_count: 8,
    started_at_ms: startedAtMs,
    total_duration_ms: 3 * 60 * MINUTE,
    ttft_ms: 180,
    tokens_generated: 1_728_000,
    vram_allocated_gb: 80,
  };
}

export function throttledJob(requestId: number, startedAtMs: number, agent = "consumer.swarm-treasury.testnet", provider = "batam-h100.testnet"): InferenceJobLog {
  return {
    request_id: requestId,
    job_id: "job-2-deepseek-r1-reasoning",
    agent_account: agent,
    provider_account: provider,
    model: "deepseek-r1-distill-70b",
    gpu_tier: "B200",
    gpu_count: 2,
    started_at_ms: startedAtMs,
    total_duration_ms: 192 * MINUTE,
    ttft_ms: 1_450,
    tokens_generated: 138_240,
    vram_allocated_gb: 192,
  };
}

/** Same bundle as `outlayer-cri-oracle --mode demo` / `--mode vectors`. */
export function demoBundle(signer: EnclaveSigner) {
  return {
    signer: {
      signer_mode: signer.mode,
      public_key: nearPublicKey(signer.keyPair.publicKey),
      public_key_hex: signer.keyPair.publicKeyHex,
      enclave_measurement_hex: bytesToHex(signer.measurement),
      worker: `${WORKER_ID}@${WORKER_VERSION}`,
    },
    index_attestations: DEMO_INDEX_PATH.map((p) => ({ label: p.label, attestation: computeCriTwap(demoIndexRequest(p.series, p.target, p.windowEnd, p.spoof), signer) })),
    job_receipts: [happyJob(1, DEMO_JOBS_START_MS), throttledJob(2, DEMO_JOBS_START_MS + 10 * MINUTE)].map((log) => verifyInferenceJob(log, DEFAULT_SLA, signer)),
  };
}
