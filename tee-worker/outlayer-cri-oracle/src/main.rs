//! CLI / OutLayer entrypoint.
//!
//! ```text
//! outlayer-cri-oracle --mode demo      # deterministic attestation bundle for the Paron swarm path
//! outlayer-cri-oracle --mode pubkey    # enclave signer public key (register it in paron-core::new)
//! outlayer-cri-oracle --mode vectors   # golden vectors for cross-language parity (shared/golden-vectors.json)
//! outlayer-cri-oracle --mode stdin     # OutLayer WASI execution: request JSON on stdin -> response JSON on stdout
//! ```
//! On `wasm32-wasip2` (OutLayer) the default mode is `stdin`; natively it is `demo`.

use outlayer_cri_oracle::scenario;
use outlayer_cri_oracle::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum WorkerRequest {
    ComputeCriTwap(IndexRequest),
    VerifyInferenceJob { log: InferenceJobLog, sla: Option<SlaPolicy> },
    PublicKey,
}

fn signer() -> Result<Box<dyn EnclaveSigner>, OracleError> {
    #[cfg(feature = "outlayer-tee")]
    {
        Ok(Box::new(OutlayerEnclaveSigner { key_path: "paron-cri-oracle" }))
    }
    #[cfg(not(feature = "outlayer-tee"))]
    {
        Ok(Box::new(LocalSigner::from_env_or_dev()?))
    }
}

fn run_stdin(s: &dyn EnclaveSigner) -> Result<Value, Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let request: WorkerRequest = serde_json::from_str(&input)?;
    Ok(match request {
        WorkerRequest::ComputeCriTwap(req) => json!({ "ok": true, "attestation": compute_cri_twap(&req, s)? }),
        WorkerRequest::VerifyInferenceJob { log, sla } => {
            json!({ "ok": true, "receipt": verify_inference_job(&log, &sla.unwrap_or_default(), s)? })
        }
        WorkerRequest::PublicKey => json!({ "ok": true, "signer": scenario::signer_json(s)? }),
    })
}

fn run(mode: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let s = signer()?;
    Ok(match mode {
        "demo" => scenario::demo_bundle(s.as_ref())?,
        "pubkey" => scenario::signer_json(s.as_ref())?,
        "vectors" => scenario::golden_vectors()?,
        "stdin" => run_stdin(s.as_ref())?,
        other => return Err(format!("unknown mode {other} (expected demo | pubkey | vectors | stdin)").into()),
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let default_mode = if cfg!(target_os = "wasi") { "stdin" } else { "demo" };
    let mode = args
        .iter()
        .position(|a| a == "--mode")
        .and_then(|i| args.get(i + 1).cloned())
        .unwrap_or_else(|| default_mode.to_string());
    let mut stdout = std::io::stdout();
    match run(&mode) {
        Ok(output) => {
            let _ = writeln!(stdout, "{}", serde_json::to_string_pretty(&output).expect("json"));
        }
        Err(e) => {
            let _ = writeln!(stdout, "{}", json!({ "ok": false, "error": e.to_string() }));
            std::process::exit(1);
        }
    }
}
