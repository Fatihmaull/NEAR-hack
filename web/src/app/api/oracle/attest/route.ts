import { computeCriTwap, customIndexRequest, localDevSigner, nearPublicKey, type IndexRequest } from "@paron/agents";

export const dynamic = "force-dynamic";

/**
 * OutLayer local fallback route (same worker logic as tee-worker/outlayer-cri-oracle, public dev key).
 * POST an `IndexRequest` (the worker's stdin JSON) or `{ series_id, target_micros, window_end_ms?, spoof_micros? }`.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as (Partial<IndexRequest> & { target_micros?: number; spoof_micros?: number | null }) | null;
  if (!body?.series_id) return Response.json({ ok: false, error: "series_id is required" }, { status: 400 });
  const signer = localDevSigner();
  try {
    const req: IndexRequest = body.observations
      ? (body as IndexRequest)
      : customIndexRequest(body.series_id, Number(body.target_micros ?? 2_800_000), Number(body.window_end_ms ?? Date.now()), body.spoof_micros ?? 9_800_000);
    const attestation = computeCriTwap(req, signer);
    return Response.json({ ok: true, mode: "local-dev-enclave-mirror", signer: nearPublicKey(signer.keyPair.publicKey), attestation });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 422 });
  }
}

export async function GET() {
  const signer = localDevSigner();
  return Response.json({ ok: true, signer: nearPublicKey(signer.keyPair.publicKey), usage: "POST { series_id, target_micros, window_end_ms?, spoof_micros? } or a full IndexRequest" });
}
