use outlayer_cri_oracle::scenario::{self, DEMO_JOBS_START_MS, DEMO_T0_MS, MINUTE};
use outlayer_cri_oracle::*;

fn dev() -> LocalSigner {
    LocalSigner::local_dev()
}

fn pubkey() -> [u8; 32] {
    dev().public_key().unwrap()
}

fn obs(source: &str, tier: GpuTier, price: u64, volume: u64, at: u64) -> SpotObservation {
    SpotObservation { source: source.into(), gpu_tier: tier, usd_per_gpu_hour_micros: price, volume_gpu_hours: volume, observed_at_ms: at }
}

#[test]
fn normalization_uses_canonical_hardware_weights() {
    // $1.26 A100, $2.80 H100, $3.92 H200, $7.00 B200, $9.80 GB200 are all exactly $2.80 H100-equivalent.
    assert_eq!(normalize_to_h100(GpuTier::A100, 1_260_000), 2_800_000);
    assert_eq!(normalize_to_h100(GpuTier::H100, 2_800_000), 2_800_000);
    assert_eq!(normalize_to_h100(GpuTier::H200, 3_920_000), 2_800_000);
    assert_eq!(normalize_to_h100(GpuTier::B200, 7_000_000), 2_800_000);
    assert_eq!(normalize_to_h100(GpuTier::GB200, 9_800_000), 2_800_000);
}

#[test]
fn manipulated_feed_is_rejected_by_2_sigma_mad_filter() {
    let req = scenario::index_request("CU-2026-11", 2_800_000, DEMO_T0_MS + 5 * MINUTE, 9_800_000);
    let attested = compute_cri_twap(&req, &dev()).unwrap();
    // A single spoofed $9.80 feed with the *largest* volume cannot move the index.
    assert_eq!(attested.twap_micros, 2_800_000);
    assert_eq!(attested.rejected_count, 2);
    assert_eq!(attested.accepted_count, 10);
    assert!(attested
        .observations
        .iter()
        .all(|o| o.accepted != (o.source == "unverified-spoof-feed")));
    let spoof = attested.observations.iter().find(|o| !o.accepted).unwrap();
    assert!(spoof.deviation_sigma_milli > 2_000);
    // Downward manipulation is rejected too.
    let low = scenario::index_request("CU-2026-11", 4_100_000, DEMO_T0_MS + 5 * MINUTE, 1_250_000);
    assert_eq!(compute_cri_twap(&low, &dev()).unwrap().twap_micros, 4_100_000);
}

#[test]
fn twap_is_volume_weighted_within_buckets_and_time_weighted_across() {
    let start = DEMO_T0_MS;
    let req = IndexRequest {
        series_id: "CU-2026-12".into(),
        window_start_ms: start,
        window_end_ms: start + 60 * MINUTE,
        bucket_ms: 30 * MINUTE,
        observations: vec![
            // bucket 0: VWAP = (3.00*300 + 3.02*100 + 3.01*100) / 500 = 3.006
            obs("a", GpuTier::H100, 3_000_000, 300, start + MINUTE),
            obs("b", GpuTier::H100, 3_020_000, 100, start + 2 * MINUTE),
            obs("c", GpuTier::H200, 4_214_000, 100, start + 3 * MINUTE),
            // bucket 1 (price moved, quorum of 3 tiers): VWAP = 3.20
            obs("d", GpuTier::H100, 3_200_000, 50, start + 40 * MINUTE),
            obs("e", GpuTier::B200, 8_000_000, 50, start + 41 * MINUTE),
            obs("f", GpuTier::A100, 1_440_000, 50, start + 42 * MINUTE),
        ],
    };
    let attested = compute_cri_twap(&req, &dev()).unwrap();
    assert_eq!(attested.rejected_count, 0);
    assert_eq!(attested.buckets.len(), 2);
    assert_eq!(attested.buckets[0].vwap_micros, 3_006_000);
    assert_eq!(attested.buckets[1].vwap_micros, 3_200_000);
    // Equal time weight per bucket, not per observation: (3.006 + 3.200) / 2.
    assert_eq!(attested.twap_micros, 3_103_000);
}

#[test]
fn sparse_bucket_without_quorum_cannot_move_the_index() {
    let start = DEMO_T0_MS;
    let mut observations = vec![
        obs("a", GpuTier::H100, 3_000_000, 100, start + MINUTE),
        obs("b", GpuTier::H100, 3_010_000, 100, start + 2 * MINUTE),
        obs("c", GpuTier::H200, 4_200_000, 100, start + 3 * MINUTE),
    ];
    // A lone feed in the second bucket quoting +20% is judged against the window-wide consensus.
    observations.push(obs("lone", GpuTier::H100, 3_600_000, 1_000, start + 45 * MINUTE));
    let req = IndexRequest {
        series_id: "CU-2026-12".into(),
        window_start_ms: start,
        window_end_ms: start + 60 * MINUTE,
        bucket_ms: 30 * MINUTE,
        observations,
    };
    let attested = compute_cri_twap(&req, &dev()).unwrap();
    assert_eq!(attested.rejected_count, 1);
    assert_eq!(attested.buckets.len(), 1);
    assert_eq!(attested.twap_micros, 3_003_333);
}

#[test]
fn index_attestation_signature_verifies_and_tampering_fails() {
    let req = scenario::index_request("CU-2026-11", 3_050_000, DEMO_T0_MS + 7 * scenario::DAY, 1_100_000);
    let a = compute_cri_twap(&req, &dev()).unwrap();
    assert_eq!(a.signed_message, index_attestation_message("CU-2026-11", 3_050_000, a.observed_at_ms, &a.tdx_quote_hash));
    assert!(verify_signature(&pubkey(), &a.signed_message, &a.signature_hex));
    let tampered = index_attestation_message("CU-2026-11", 3_060_000, a.observed_at_ms, &a.tdx_quote_hash);
    assert!(!verify_signature(&pubkey(), &tampered, &a.signature_hex));
    let other = LocalSigner::from_seed_hex(&"11".repeat(32)).unwrap().public_key().unwrap();
    assert!(!verify_signature(&other, &a.signed_message, &a.signature_hex));
    assert_eq!(a.signer_public_key, near_public_key(&pubkey()));
}

#[test]
fn quote_hash_is_deterministic_and_bound_to_measurement_and_payload() {
    let req = scenario::index_request("CU-2026-11", 3_350_000, DEMO_T0_MS + 14 * scenario::DAY, 1_150_000);
    let a = compute_cri_twap(&req, &dev()).unwrap();
    let b = compute_cri_twap(&req, &dev()).unwrap();
    assert_eq!(a, b, "attestations must be bit-for-bit deterministic");
    assert_eq!(a.tdx_quote_hash.len(), 64);
    let mut other = req.clone();
    other.observations[0].volume_gpu_hours += 1;
    assert_ne!(compute_cri_twap(&other, &dev()).unwrap().tdx_quote_hash, a.tdx_quote_hash);
    let m = local_dev_measurement();
    assert_ne!(tdx_quote_hash(&m, "{}"), tdx_quote_hash(&sha256(b"other-build"), "{}"));
}

#[test]
fn inference_job_within_sla_produces_signed_receipt() {
    let r = verify_inference_job(&scenario::happy_job(1, DEMO_JOBS_START_MS), &SlaPolicy::default(), &dev()).unwrap();
    assert_eq!(r.gpu_hours_scaled, 240_000); // 8 GPUs * 3 h
    assert_eq!(r.cu_consumed_scaled, 240_000); // H100 = 1.00x -> 24 CU
    assert!(r.sla_met && r.violations.is_empty());
    assert_eq!(r.measured_latency_ms, 180);
    assert!(r.tokens_per_sec_milli >= 160_000);
    assert_eq!(r.signed_message, execution_receipt_message(1, &r.tdx_quote_hash, 180, true));
    assert!(verify_signature(&pubkey(), &r.signed_message, &r.signature_hex));
}

#[test]
fn throttled_job_violates_sla_and_signs_sla_met_false() {
    let r = verify_inference_job(&scenario::throttled_job(2, DEMO_JOBS_START_MS), &SlaPolicy::default(), &dev()).unwrap();
    assert_eq!(r.cu_consumed_scaled, 160_000); // 2x B200 * 3.2 h * 2.50 = 16 CU
    assert!(!r.sla_met);
    assert_eq!(r.violations.len(), 2);
    assert!(r.violations[0].starts_with("ttft 1450ms"));
    assert!(r.violations[1].starts_with("throughput 12."));
    assert!(r.signed_message.ends_with(":1450:false"));
    assert!(verify_signature(&pubkey(), &r.signed_message, &r.signature_hex));
}

#[test]
fn invalid_inputs_are_rejected() {
    let mut req = scenario::index_request("CU-2026-11", 2_800_000, DEMO_T0_MS + 5 * MINUTE, 9_800_000);
    req.observations[0].observed_at_ms = req.window_end_ms + 1;
    assert!(matches!(compute_cri_twap(&req, &dev()), Err(OracleError::InvalidObservation(_))));
    req.observations.clear();
    assert_eq!(compute_cri_twap(&req, &dev()), Err(OracleError::NoObservations));
    let mut job = scenario::happy_job(1, DEMO_JOBS_START_MS);
    job.gpu_count = 0;
    assert!(matches!(verify_inference_job(&job, &SlaPolicy::default(), &dev()), Err(OracleError::InvalidJob(_))));
}

#[test]
fn committed_golden_vectors_match_worker_output() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../shared/golden-vectors.json");
    let committed: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("shared/golden-vectors.json must exist")).unwrap();
    let fresh = scenario::golden_vectors().unwrap();
    assert_eq!(
        committed, fresh,
        "golden vectors drifted: regenerate with `npm run vectors` (cargo run -p outlayer-cri-oracle -- --mode vectors)"
    );
}
