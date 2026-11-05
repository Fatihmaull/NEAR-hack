//! # OutLayer CRI-H100 Oracle & SLA Verifier (Paron v2)
//!
//! Runs as a WASI P2 component inside OutLayer's Intel TDX enclave (or natively for local verification):
//!
//! 1. [`compute_cri_twap`] normalises multi-tier GPU spot quotes into H100-equivalent USD/hr with the
//!    protocol weights, rejects outliers outside ±2σ (robust σ = 1.4826 × MAD, per time bucket), computes
//!    the volume-weighted price per bucket and the time-weighted average across buckets (`CRI-H100`), and
//!    signs `"{series_id}:{twap_micros}:{observed_at_ms}:{tdx_quote_hash}"`.
//! 2. [`verify_inference_job`] measures an inference job log (TTFT, throughput, VRAM), computes the exact
//!    canonical CU consumed and signs `"{request_id}:{tdx_quote_hash}:{measured_latency_ms}:{sla_met}"`
//!    for `paron-core::finalize_redemption_with_tee_receipt`.
//!
//! `tdx_quote_hash = SHA-256(enclave_measurement || canonical_payload_json)` binds every attestation to
//! the exact inputs and to the worker build. Signatures are RFC 8032 Ed25519 over the raw message, the
//! format verified on-chain by `env::ed25519_verify` and produced by `outlayer::signing_keys::sign`.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CU_SCALE: u128 = 10_000;
pub const BPS: u128 = 10_000;
pub const INDEX_ID: &str = "CRI-H100";
pub const WORKER_ID: &str = "paron-outlayer-cri-oracle";
pub const WORKER_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Robust sigma = 1.4826 × MAD (consistent estimator of σ for normal data), in 1e-4 units.
pub const MAD_TO_SIGMA_X10K: u128 = 14_826;
/// Outlier band: ±2σ.
pub const SIGMA_BAND: u128 = 2;
/// σ floor = 0.5% of the median so identical honest quotes never reject a 1-tick deviation.
pub const SIGMA_FLOOR_BPS: u128 = 50;
/// Minimum observations in a bucket for a bucket-local robust filter (else the window-wide one is used).
pub const MIN_BUCKET_OBSERVATIONS: usize = 3;

/// Public label of the **local development** enclave key. It is deliberately public (like Hardhat's
/// well-known accounts) so zero-config runs are reproducible; production keys are derived inside the
/// TDX enclave by OutLayer (`outlayer-tee` feature) or injected as the `PARON_TEE_SIGNING_SEED_HEX` secret.
pub const LOCAL_DEV_KEY_LABEL: &str = "paron/outlayer-cri-oracle/local-dev-enclave-key/v1";
pub const LOCAL_DEV_MEASUREMENT_LABEL: &str = "paron/outlayer-cri-oracle/local-dev-measurement/v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GpuTier {
    A100,
    H100,
    H200,
    B200,
    GB200,
}

impl GpuTier {
    pub const fn weight_bps(self) -> u128 {
        match self {
            GpuTier::A100 => 4_500,
            GpuTier::H100 => 10_000,
            GpuTier::H200 => 14_000,
            GpuTier::B200 => 25_000,
            GpuTier::GB200 => 35_000,
        }
    }
}

/// Converts a raw per-GPU-hour quote on any tier into the canonical H100-equivalent price.
pub fn normalize_to_h100(gpu_tier: GpuTier, raw_price_micros: u64) -> u64 {
    (raw_price_micros as u128 * BPS / gpu_tier.weight_bps()) as u64
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpotObservation {
    pub source: String,
    pub gpu_tier: GpuTier,
    /// Raw quote in USDC micros per GPU-hour on `gpu_tier`.
    pub usd_per_gpu_hour_micros: u64,
    /// Liquidity weight (GPU-hours offered/traded at the quote).
    pub volume_gpu_hours: u64,
    pub observed_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexRequest {
    pub series_id: String,
    pub window_start_ms: u64,
    pub window_end_ms: u64,
    /// Width of each TWAP bucket; the window is split into `ceil(window / bucket_ms)` buckets.
    pub bucket_ms: u64,
    pub observations: Vec<SpotObservation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservationVerdict {
    pub source: String,
    pub gpu_tier: GpuTier,
    pub raw_price_micros: u64,
    pub h100_equivalent_micros: u64,
    pub volume_gpu_hours: u64,
    pub observed_at_ms: u64,
    pub bucket: u32,
    pub accepted: bool,
    /// |x − median| / σ in thousandths.
    pub deviation_sigma_milli: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BucketStat {
    pub bucket: u32,
    pub median_micros: u64,
    pub mad_micros: u64,
    pub sigma_micros: u64,
    pub accepted: u32,
    pub rejected: u32,
    pub vwap_micros: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttestedCriIndex {
    pub index_id: String,
    pub series_id: String,
    pub twap_micros: u64,
    pub window_start_ms: u64,
    pub window_end_ms: u64,
    /// Signed end of the observation window (`paron-core` enforces freshness & monotonicity on it).
    pub observed_at_ms: u64,
    pub buckets: Vec<BucketStat>,
    pub observations: Vec<ObservationVerdict>,
    pub accepted_count: u32,
    pub rejected_count: u32,
    pub worker: String,
    pub signer_mode: String,
    pub enclave_measurement_hex: String,
    pub payload_sha256_hex: String,
    pub tdx_quote_hash: String,
    pub signed_message: String,
    pub signature_hex: String,
    pub signer_pubkey_hex: String,
    pub signer_public_key: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceJobLog {
    /// `paron-core` redemption request id this job settles.
    pub request_id: u64,
    pub job_id: String,
    pub agent_account: String,
    pub provider_account: String,
    pub model: String,
    pub gpu_tier: GpuTier,
    pub gpu_count: u32,
    pub started_at_ms: u64,
    pub total_duration_ms: u64,
    pub ttft_ms: u32,
    pub tokens_generated: u64,
    pub vram_allocated_gb: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlaPolicy {
    pub max_ttft_ms: u32,
    pub min_tokens_per_sec: u64,
    pub min_vram_gb: u32,
}

impl Default for SlaPolicy {
    fn default() -> Self {
        Self { max_ttft_ms: 500, min_tokens_per_sec: 40, min_vram_gb: 80 }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttestedJobReceipt {
    /// The full measured log, so anyone can recompute `tdx_quote_hash` from the receipt alone.
    pub log: InferenceJobLog,
    pub request_id: u64,
    pub job_id: String,
    pub agent_account: String,
    pub provider_account: String,
    pub model: String,
    pub gpu_tier: GpuTier,
    pub gpu_count: u32,
    pub gpu_hours_scaled: u64,
    pub cu_consumed_scaled: u64,
    pub ttft_ms: u32,
    pub tokens_per_sec_milli: u64,
    pub vram_allocated_gb: u32,
    pub measured_latency_ms: u32,
    pub sla: SlaPolicy,
    pub sla_met: bool,
    pub violations: Vec<String>,
    pub worker: String,
    pub signer_mode: String,
    pub enclave_measurement_hex: String,
    pub payload_sha256_hex: String,
    pub tdx_quote_hash: String,
    pub signed_message: String,
    pub signature_hex: String,
    pub signer_pubkey_hex: String,
    pub signer_public_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OracleError {
    NoObservations,
    InvalidWindow,
    InvalidObservation(String),
    AllObservationsRejected,
    InvalidJob(String),
    Signer(String),
}

impl std::fmt::Display for OracleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OracleError::NoObservations => write!(f, "no spot observations supplied"),
            OracleError::InvalidWindow => write!(f, "invalid observation window"),
            OracleError::InvalidObservation(s) => write!(f, "invalid observation: {s}"),
            OracleError::AllObservationsRejected => write!(f, "every observation was rejected as an outlier"),
            OracleError::InvalidJob(s) => write!(f, "invalid inference job log: {s}"),
            OracleError::Signer(s) => write!(f, "enclave signer error: {s}"),
        }
    }
}

impl std::error::Error for OracleError {}

// ---------------------------------------------------------------------------------------------
// Enclave signer
// ---------------------------------------------------------------------------------------------

pub trait EnclaveSigner {
    fn public_key(&self) -> Result<[u8; 32], OracleError>;
    fn sign(&self, message: &[u8]) -> Result<[u8; 64], OracleError>;
    /// Identity of the code the key is bound to (TDX measurement / build digest).
    fn measurement(&self) -> [u8; 32];
    fn mode(&self) -> &'static str;
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Software Ed25519 signer: the deterministic public dev key (zero-config) or a seed secret.
pub struct LocalSigner {
    key: SigningKey,
    measurement: [u8; 32],
    mode: &'static str,
}

impl LocalSigner {
    /// Deterministic, publicly known development key — never use for value-bearing deployments.
    pub fn local_dev() -> Self {
        Self {
            key: SigningKey::from_bytes(&sha256(LOCAL_DEV_KEY_LABEL.as_bytes())),
            measurement: local_dev_measurement(),
            mode: "local-dev-deterministic",
        }
    }

    /// Key from a 32-byte hex seed (e.g. the `PARON_TEE_SIGNING_SEED_HEX` OutLayer secret).
    pub fn from_seed_hex(seed_hex: &str) -> Result<Self, OracleError> {
        let raw = hex::decode(seed_hex.trim()).map_err(|e| OracleError::Signer(e.to_string()))?;
        let seed: [u8; 32] = raw.try_into().map_err(|_| OracleError::Signer("seed must be 32 bytes".into()))?;
        Ok(Self { key: SigningKey::from_bytes(&seed), measurement: local_dev_measurement(), mode: "env-secret-seed" })
    }

    /// `PARON_TEE_SIGNING_SEED_HEX` when present, otherwise the deterministic dev key.
    pub fn from_env_or_dev() -> Result<Self, OracleError> {
        match std::env::var("PARON_TEE_SIGNING_SEED_HEX") {
            Ok(seed) if !seed.trim().is_empty() => Self::from_seed_hex(&seed),
            _ => Ok(Self::local_dev()),
        }
    }
}

pub fn local_dev_measurement() -> [u8; 32] {
    sha256(format!("{LOCAL_DEV_MEASUREMENT_LABEL}|{WORKER_ID}@{WORKER_VERSION}").as_bytes())
}

impl EnclaveSigner for LocalSigner {
    fn public_key(&self) -> Result<[u8; 32], OracleError> {
        Ok(self.key.verifying_key().to_bytes())
    }
    fn sign(&self, message: &[u8]) -> Result<[u8; 64], OracleError> {
        Ok(self.key.sign(message).to_bytes())
    }
    fn measurement(&self) -> [u8; 32] {
        self.measurement
    }
    fn mode(&self) -> &'static str {
        self.mode
    }
}

/// Key derived by OutLayer's keystore inside the TDX enclave for this exact project build; the
/// component never sees the private key (declared in `outlayer.manifest`).
#[cfg(feature = "outlayer-tee")]
pub struct OutlayerEnclaveSigner {
    pub key_path: &'static str,
}

#[cfg(feature = "outlayer-tee")]
impl EnclaveSigner for OutlayerEnclaveSigner {
    fn public_key(&self) -> Result<[u8; 32], OracleError> {
        let pk = outlayer::signing_keys::public_key(self.key_path, None).map_err(|e| OracleError::Signer(format!("{e:?}")))?;
        pk.try_into().map_err(|_| OracleError::Signer("unexpected public key length".into()))
    }
    fn sign(&self, message: &[u8]) -> Result<[u8; 64], OracleError> {
        let sig = outlayer::signing_keys::sign(self.key_path, None, message).map_err(|e| OracleError::Signer(format!("{e:?}")))?;
        sig.try_into().map_err(|_| OracleError::Signer("unexpected signature length".into()))
    }
    fn measurement(&self) -> [u8; 32] {
        let build = std::env::var("PARON_ENCLAVE_MEASUREMENT").unwrap_or_else(|_| format!("{WORKER_ID}@{WORKER_VERSION}|outlayer-tdx"));
        sha256(build.as_bytes())
    }
    fn mode(&self) -> &'static str {
        "outlayer-tdx-signing-key"
    }
}

pub fn near_public_key(pk: &[u8; 32]) -> String {
    format!("ed25519:{}", bs58::encode(pk).into_string())
}

pub fn verify_signature(pubkey: &[u8; 32], message: &str, signature_hex: &str) -> bool {
    let Ok(vk) = VerifyingKey::from_bytes(pubkey) else { return false };
    let Ok(raw) = hex::decode(signature_hex) else { return false };
    let Ok(bytes): Result<[u8; 64], _> = raw.try_into() else { return false };
    vk.verify(message.as_bytes(), &Signature::from_bytes(&bytes)).is_ok()
}

/// Canonical messages — byte-identical to `paron_core::settlement::*_message`.
pub fn index_attestation_message(series_id: &str, twap_micros: u64, observed_at_ms: u64, tdx_quote_hash: &str) -> String {
    format!("{series_id}:{twap_micros}:{observed_at_ms}:{tdx_quote_hash}")
}

pub fn execution_receipt_message(request_id: u64, tdx_quote_hash: &str, measured_latency_ms: u32, sla_met: bool) -> String {
    format!("{request_id}:{tdx_quote_hash}:{measured_latency_ms}:{sla_met}")
}

/// `SHA-256(measurement || payload)` as lowercase hex.
pub fn tdx_quote_hash(measurement: &[u8; 32], payload_json: &str) -> String {
    let mut data = measurement.to_vec();
    data.extend_from_slice(payload_json.as_bytes());
    hex::encode(sha256(&data))
}

// ---------------------------------------------------------------------------------------------
// CRI-H100 TWAP
// ---------------------------------------------------------------------------------------------

fn median(sorted: &[u64]) -> u64 {
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        ((sorted[n / 2 - 1] as u128 + sorted[n / 2] as u128) / 2) as u64
    }
}

/// (median, MAD, effective σ) of a non-empty set.
pub fn robust_stats(values: &[u64]) -> (u64, u64, u64) {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let m = median(&sorted);
    let mut deviations: Vec<u64> = values.iter().map(|v| v.abs_diff(m)).collect();
    deviations.sort_unstable();
    let mad = median(&deviations);
    let sigma = (mad as u128 * MAD_TO_SIGMA_X10K / BPS) as u64;
    let floor = (m as u128 * SIGMA_FLOOR_BPS / BPS) as u64;
    (m, mad, sigma.max(floor).max(1))
}

#[derive(Serialize)]
struct IndexPayload<'a> {
    index_id: &'a str,
    series_id: &'a str,
    twap_micros: u64,
    window_start_ms: u64,
    window_end_ms: u64,
    buckets: &'a [BucketStat],
    observations: &'a [ObservationVerdict],
    worker: String,
}

/// Aggregate spot feeds into the attested CRI-H100 TWAP for `request.series_id`.
pub fn compute_cri_twap(request: &IndexRequest, signer: &dyn EnclaveSigner) -> Result<AttestedCriIndex, OracleError> {
    if request.observations.is_empty() {
        return Err(OracleError::NoObservations);
    }
    if request.window_end_ms <= request.window_start_ms || request.bucket_ms == 0 {
        return Err(OracleError::InvalidWindow);
    }
    let span = request.window_end_ms - request.window_start_ms;
    let bucket_count = span.div_ceil(request.bucket_ms) as u32;

    let mut verdicts: Vec<ObservationVerdict> = Vec::with_capacity(request.observations.len());
    for o in &request.observations {
        if o.usd_per_gpu_hour_micros == 0 || o.volume_gpu_hours == 0 {
            return Err(OracleError::InvalidObservation(format!("{}: zero price or volume", o.source)));
        }
        if o.observed_at_ms < request.window_start_ms || o.observed_at_ms > request.window_end_ms {
            return Err(OracleError::InvalidObservation(format!("{}: outside window", o.source)));
        }
        let bucket = (((o.observed_at_ms - request.window_start_ms) / request.bucket_ms) as u32).min(bucket_count - 1);
        verdicts.push(ObservationVerdict {
            source: o.source.clone(),
            gpu_tier: o.gpu_tier,
            raw_price_micros: o.usd_per_gpu_hour_micros,
            h100_equivalent_micros: normalize_to_h100(o.gpu_tier, o.usd_per_gpu_hour_micros),
            volume_gpu_hours: o.volume_gpu_hours,
            observed_at_ms: o.observed_at_ms,
            bucket,
            accepted: false,
            deviation_sigma_milli: 0,
        });
    }

    let all_prices: Vec<u64> = verdicts.iter().map(|v| v.h100_equivalent_micros).collect();
    let window_stats = robust_stats(&all_prices);
    let mut buckets: Vec<BucketStat> = Vec::new();
    for b in 0..bucket_count {
        let idx: Vec<usize> = (0..verdicts.len()).filter(|&i| verdicts[i].bucket == b).collect();
        if idx.is_empty() {
            continue;
        }
        let prices: Vec<u64> = idx.iter().map(|&i| verdicts[i].h100_equivalent_micros).collect();
        let (m, mad, sigma) = if idx.len() >= MIN_BUCKET_OBSERVATIONS { robust_stats(&prices) } else { window_stats };
        let (mut accepted, mut rejected, mut pv, mut vol) = (0u32, 0u32, 0u128, 0u128);
        for &i in &idx {
            let v = &mut verdicts[i];
            let dev = v.h100_equivalent_micros.abs_diff(m);
            v.deviation_sigma_milli = (dev as u128 * 1_000 / sigma as u128) as u64;
            v.accepted = dev as u128 <= SIGMA_BAND * sigma as u128;
            if v.accepted {
                accepted += 1;
                pv += v.h100_equivalent_micros as u128 * v.volume_gpu_hours as u128;
                vol += v.volume_gpu_hours as u128;
            } else {
                rejected += 1;
            }
        }
        if accepted == 0 {
            continue;
        }
        buckets.push(BucketStat {
            bucket: b,
            median_micros: m,
            mad_micros: mad,
            sigma_micros: sigma,
            accepted,
            rejected,
            vwap_micros: (pv / vol) as u64,
        });
    }
    if buckets.is_empty() {
        return Err(OracleError::AllObservationsRejected);
    }
    let twap = (buckets.iter().map(|b| b.vwap_micros as u128).sum::<u128>() / buckets.len() as u128) as u64;
    let accepted_count = verdicts.iter().filter(|v| v.accepted).count() as u32;
    let rejected_count = verdicts.len() as u32 - accepted_count;

    let worker = format!("{WORKER_ID}@{WORKER_VERSION}");
    let payload = serde_json::to_string(&IndexPayload {
        index_id: INDEX_ID,
        series_id: &request.series_id,
        twap_micros: twap,
        window_start_ms: request.window_start_ms,
        window_end_ms: request.window_end_ms,
        buckets: &buckets,
        observations: &verdicts,
        worker: worker.clone(),
    })
    .expect("payload serialises");
    let measurement = signer.measurement();
    let quote_hash = tdx_quote_hash(&measurement, &payload);
    let message = index_attestation_message(&request.series_id, twap, request.window_end_ms, &quote_hash);
    let signature = signer.sign(message.as_bytes())?;
    let pubkey = signer.public_key()?;
    Ok(AttestedCriIndex {
        index_id: INDEX_ID.to_string(),
        series_id: request.series_id.clone(),
        twap_micros: twap,
        window_start_ms: request.window_start_ms,
        window_end_ms: request.window_end_ms,
        observed_at_ms: request.window_end_ms,
        buckets,
        observations: verdicts,
        accepted_count,
        rejected_count,
        worker,
        signer_mode: signer.mode().to_string(),
        enclave_measurement_hex: hex::encode(measurement),
        payload_sha256_hex: hex::encode(sha256(payload.as_bytes())),
        tdx_quote_hash: quote_hash,
        signed_message: message,
        signature_hex: hex::encode(signature),
        signer_pubkey_hex: hex::encode(pubkey),
        signer_public_key: near_public_key(&pubkey),
    })
}

// ---------------------------------------------------------------------------------------------
// Inference SLA verification
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
struct JobPayload<'a> {
    log: &'a InferenceJobLog,
    sla: &'a SlaPolicy,
    gpu_hours_scaled: u64,
    cu_consumed_scaled: u64,
    tokens_per_sec_milli: u64,
    sla_met: bool,
    violations: &'a [String],
    worker: String,
}

/// Evaluate an inference job log against the SLA and produce the signed TDX execution receipt.
pub fn verify_inference_job(
    log: &InferenceJobLog,
    sla: &SlaPolicy,
    signer: &dyn EnclaveSigner,
) -> Result<AttestedJobReceipt, OracleError> {
    if log.gpu_count == 0 || log.total_duration_ms == 0 {
        return Err(OracleError::InvalidJob("gpu_count and total_duration_ms must be positive".into()));
    }
    if log.ttft_ms as u64 > log.total_duration_ms {
        return Err(OracleError::InvalidJob("ttft exceeds total duration".into()));
    }
    let gpu_hours_scaled = (log.gpu_count as u128 * log.total_duration_ms as u128 * CU_SCALE / 3_600_000) as u64;
    let cu_consumed_scaled = (gpu_hours_scaled as u128 * log.gpu_tier.weight_bps() / BPS) as u64;
    let decode_ms = (log.total_duration_ms - log.ttft_ms as u64).max(1);
    let tokens_per_sec_milli = (log.tokens_generated as u128 * 1_000_000 / decode_ms as u128) as u64;

    let mut violations = Vec::new();
    if log.ttft_ms > sla.max_ttft_ms {
        violations.push(format!("ttft {}ms > {}ms", log.ttft_ms, sla.max_ttft_ms));
    }
    if tokens_per_sec_milli < sla.min_tokens_per_sec * 1_000 {
        violations.push(format!(
            "throughput {}.{:03} tok/s < {} tok/s",
            tokens_per_sec_milli / 1_000,
            tokens_per_sec_milli % 1_000,
            sla.min_tokens_per_sec
        ));
    }
    if log.vram_allocated_gb < sla.min_vram_gb {
        violations.push(format!("vram {}GB < {}GB", log.vram_allocated_gb, sla.min_vram_gb));
    }
    let sla_met = violations.is_empty();
    let worker = format!("{WORKER_ID}@{WORKER_VERSION}");
    let payload = serde_json::to_string(&JobPayload {
        log,
        sla,
        gpu_hours_scaled,
        cu_consumed_scaled,
        tokens_per_sec_milli,
        sla_met,
        violations: &violations,
        worker: worker.clone(),
    })
    .expect("payload serialises");
    let measurement = signer.measurement();
    let quote_hash = tdx_quote_hash(&measurement, &payload);
    let message = execution_receipt_message(log.request_id, &quote_hash, log.ttft_ms, sla_met);
    let signature = signer.sign(message.as_bytes())?;
    let pubkey = signer.public_key()?;
    Ok(AttestedJobReceipt {
        log: log.clone(),
        request_id: log.request_id,
        job_id: log.job_id.clone(),
        agent_account: log.agent_account.clone(),
        provider_account: log.provider_account.clone(),
        model: log.model.clone(),
        gpu_tier: log.gpu_tier,
        gpu_count: log.gpu_count,
        gpu_hours_scaled,
        cu_consumed_scaled,
        ttft_ms: log.ttft_ms,
        tokens_per_sec_milli,
        vram_allocated_gb: log.vram_allocated_gb,
        measured_latency_ms: log.ttft_ms,
        sla: sla.clone(),
        sla_met,
        violations,
        worker,
        signer_mode: signer.mode().to_string(),
        enclave_measurement_hex: hex::encode(measurement),
        payload_sha256_hex: hex::encode(sha256(payload.as_bytes())),
        tdx_quote_hash: quote_hash,
        signed_message: message,
        signature_hex: hex::encode(signature),
        signer_pubkey_hex: hex::encode(pubkey),
        signer_public_key: near_public_key(&pubkey),
    })
}

// ---------------------------------------------------------------------------------------------
// Deterministic demo scenario (shared with agents/src/oracle and the golden vectors)
// ---------------------------------------------------------------------------------------------

pub mod scenario {
    use super::*;
    use serde_json::{json, Value};

    pub const MINUTE: u64 = 60_000;
    pub const DAY: u64 = 24 * 60 * MINUTE;
    /// 2026-11-05T09:00:00Z — start of the Paron swarm simulation.
    pub const DEMO_T0_MS: u64 = 1_793_869_200_000;
    /// 2026-12-01T00:00:00Z — first instant after the CU-2026-11 maturity (23:59:59Z).
    pub const DEMO_FINAL_WINDOW_END_MS: u64 = 1_796_083_200_000;
    /// Mode B jobs start on 2026-12-02T09:00:00Z.
    pub const DEMO_JOBS_START_MS: u64 = DEMO_FINAL_WINDOW_END_MS + DAY + 9 * 60 * MINUTE;

    /// (label, series, target TWAP, window end, manipulated feed price) of every attestation in the swarm path.
    pub const DEMO_INDEX_PATH: [(&str, &str, u64, u64, u64); 6] = [
        ("baseline", "CU-2026-11", 2_800_000, DEMO_T0_MS + 5 * MINUTE, 9_800_000),
        ("spike-1", "CU-2026-11", 3_050_000, DEMO_T0_MS + 7 * DAY, 1_100_000),
        ("spike-2", "CU-2026-11", 3_350_000, DEMO_T0_MS + 14 * DAY, 1_150_000),
        ("spike-3", "CU-2026-11", 3_700_000, DEMO_T0_MS + 20 * DAY, 1_200_000),
        ("final-settlement", "CU-2026-11", 4_100_000, DEMO_FINAL_WINDOW_END_MS, 1_250_000),
        ("dec-reference", "CU-2026-12", 3_400_000, DEMO_FINAL_WINDOW_END_MS, 9_900_000),
    ];

    pub fn signer_json(s: &dyn EnclaveSigner) -> Result<Value, OracleError> {
        let pk = s.public_key()?;
        Ok(json!({
            "signer_mode": s.mode(),
            "public_key": near_public_key(&pk),
            "public_key_hex": hex::encode(pk),
            "enclave_measurement_hex": hex::encode(s.measurement()),
            "worker": format!("{WORKER_ID}@{WORKER_VERSION}"),
        }))
    }

    /// Every OutLayer attestation and execution receipt consumed by the 5-act swarm simulation.
    pub fn demo_bundle(s: &dyn EnclaveSigner) -> Result<Value, OracleError> {
        let mut attestations = Vec::new();
        for (label, series, target, end, spoof) in DEMO_INDEX_PATH {
            let attested = compute_cri_twap(&index_request(series, target, end, spoof), s)?;
            attestations.push(json!({ "label": label, "attestation": attested }));
        }
        let sla = SlaPolicy::default();
        let mut receipts = Vec::new();
        for log in [happy_job(1, DEMO_JOBS_START_MS), throttled_job(2, DEMO_JOBS_START_MS + 10 * MINUTE)] {
            receipts.push(json!(verify_inference_job(&log, &sla, s)?));
        }
        Ok(json!({
            "ok": true,
            "mode": "demo",
            "signer": signer_json(s)?,
            "index_attestations": attestations,
            "job_receipts": receipts,
        }))
    }

    /// Golden vectors always use the deterministic dev key so they reproduce everywhere.
    pub fn golden_vectors() -> Result<Value, OracleError> {
        let mut bundle = demo_bundle(&LocalSigner::local_dev())?;
        bundle["mode"] = json!("golden-vectors");
        bundle["description"] = json!(
            "Deterministic OutLayer CRI-H100 attestations and TDX execution receipts produced by the Rust worker \
             with the public local-dev enclave key. agents/ (TypeScript) must reproduce them byte-for-byte."
        );
        Ok(bundle)
    }

    /// Honest multi-tier feeds whose volume-weighted H100-equivalent average is exactly `target`, plus
    /// one manipulated feed (`manipulated_price`, H100) that the ±2σ filter must reject. Two 30-minute
    /// buckets ending at `window_end_ms`.
    pub fn index_request(series_id: &str, target: u64, window_end_ms: u64, manipulated_price: u64) -> IndexRequest {
        let start = window_end_ms - 60 * MINUTE;
        let mut observations = Vec::new();
        for (bucket, at) in [(0u64, start + 10 * MINUTE), (1, start + 40 * MINUTE)] {
            let skew = bucket * 2_000; // tiny intra-window drift that cancels out in the VWAP
            observations.push(obs("near-ai-cloud-spot", GpuTier::H100, target - 10_000 - skew, 120, at));
            observations.push(obs("akash-h100-spot", GpuTier::H100, target + 10_000 + skew, 120, at + MINUTE));
            observations.push(obs("lambda-h200-reference", GpuTier::H200, scale(target, 14_000), 80, at + 2 * MINUTE));
            observations.push(obs("asean-tier3-a100-wholesale", GpuTier::A100, scale(target, 4_500), 60, at + 3 * MINUTE));
            observations.push(obs("render-b200-reference", GpuTier::B200, scale(target, 25_000), 40, at + 4 * MINUTE));
            observations.push(obs("unverified-spoof-feed", GpuTier::H100, manipulated_price, 400, at + 5 * MINUTE));
        }
        IndexRequest { series_id: series_id.to_string(), window_start_ms: start, window_end_ms, bucket_ms: 30 * MINUTE, observations }
    }

    fn scale(target: u64, weight_bps: u128) -> u64 {
        (target as u128 * weight_bps / BPS) as u64
    }

    fn obs(source: &str, gpu_tier: GpuTier, price: u64, volume: u64, at: u64) -> SpotObservation {
        SpotObservation {
            source: source.to_string(),
            gpu_tier,
            usd_per_gpu_hour_micros: price,
            volume_gpu_hours: volume,
            observed_at_ms: at,
        }
    }

    /// Job #1: 8× H100 for 3 h (24 CU), TTFT 180 ms, ~160 tok/s.
    pub fn happy_job(request_id: u64, started_at_ms: u64) -> InferenceJobLog {
        InferenceJobLog {
            request_id,
            job_id: "job-1-llama-70b-batch".into(),
            agent_account: "consumer.swarm-treasury.testnet".into(),
            provider_account: "batam-h100.testnet".into(),
            model: "llama-3.3-70b-instruct".into(),
            gpu_tier: GpuTier::H100,
            gpu_count: 8,
            started_at_ms,
            total_duration_ms: 3 * 60 * MINUTE,
            ttft_ms: 180,
            tokens_generated: 1_728_000,
            vram_allocated_gb: 80,
        }
    }

    /// Job #2: 2× B200 for 3.2 h (16 CU), throttled — TTFT 1,450 ms and ~12 tok/s.
    pub fn throttled_job(request_id: u64, started_at_ms: u64) -> InferenceJobLog {
        InferenceJobLog {
            request_id,
            job_id: "job-2-deepseek-r1-reasoning".into(),
            agent_account: "consumer.swarm-treasury.testnet".into(),
            provider_account: "batam-h100.testnet".into(),
            model: "deepseek-r1-distill-70b".into(),
            gpu_tier: GpuTier::B200,
            gpu_count: 2,
            started_at_ms,
            total_duration_ms: 192 * MINUTE,
            ttft_ms: 1_450,
            tokens_generated: 138_240,
            vram_allocated_gb: 192,
        }
    }
}
