/**
 * OutLayer oracle access for the swarm.
 * - `LocalOutlayerOracle`: the byte-identical TypeScript mirror of the Rust enclave worker.
 * - `OutlayerHttpOracle`: invokes the deployed worker (wasm32-wasip2 build of
 *   tee-worker/outlayer-cri-oracle) through an HTTPS execution endpoint configured with
 *   OUTLAYER_API_URL / OUTLAYER_API_KEY. The request/response bodies are exactly the worker's
 *   stdin/stdout JSON contract (`{"action":"compute_cri_twap",...}` → `{"ok":true,"attestation":...}`).
 */
import { nearPublicKey } from "./crypto";
import {
  computeCriTwap,
  DEFAULT_SLA,
  localDevSigner,
  verifyInferenceJob,
  type AttestedCriIndex,
  type AttestedJobReceipt,
  type EnclaveSigner,
  type IndexRequest,
  type InferenceJobLog,
  type SlaPolicy,
} from "./oracle/cri-oracle";

export interface OutlayerOracle {
  readonly mode: "local" | "live";
  signerPublicKey(): Promise<string>;
  attestIndex(request: IndexRequest): Promise<AttestedCriIndex>;
  verifyJob(log: InferenceJobLog, sla?: SlaPolicy): Promise<AttestedJobReceipt>;
}

export class LocalOutlayerOracle implements OutlayerOracle {
  readonly mode = "local" as const;
  constructor(private readonly signer: EnclaveSigner = localDevSigner()) {}

  async signerPublicKey(): Promise<string> {
    return nearPublicKey(this.signer.keyPair.publicKey);
  }
  async attestIndex(request: IndexRequest): Promise<AttestedCriIndex> {
    return computeCriTwap(request, this.signer);
  }
  async verifyJob(log: InferenceJobLog, sla: SlaPolicy = DEFAULT_SLA): Promise<AttestedJobReceipt> {
    return verifyInferenceJob(log, sla, this.signer);
  }
}

export class OutlayerHttpOracle implements OutlayerOracle {
  readonly mode = "live" as const;
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async invoke<T>(body: Record<string, unknown>, field: string): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OutLayer execution failed: ${res.status} ${await res.text()}`);
    const out = (await res.json()) as Record<string, unknown>;
    if (out.ok !== true) throw new Error(`OutLayer worker error: ${String(out.error)}`);
    return out[field] as T;
  }

  async signerPublicKey(): Promise<string> {
    const signer = await this.invoke<{ public_key: string }>({ action: "public_key" }, "signer");
    return signer.public_key;
  }
  async attestIndex(request: IndexRequest): Promise<AttestedCriIndex> {
    return this.invoke({ action: "compute_cri_twap", ...request }, "attestation");
  }
  async verifyJob(log: InferenceJobLog, sla: SlaPolicy = DEFAULT_SLA): Promise<AttestedJobReceipt> {
    return this.invoke({ action: "verify_inference_job", log, sla }, "receipt");
  }
}

export function oracleFromEnv(env: Record<string, string | undefined>): OutlayerOracle {
  if (env.OUTLAYER_API_URL && env.OUTLAYER_API_KEY) return new OutlayerHttpOracle(env.OUTLAYER_API_URL, env.OUTLAYER_API_KEY);
  return new LocalOutlayerOracle();
}
