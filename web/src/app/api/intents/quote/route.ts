import { OneClickIntentsBridge, type OneClickQuoteRequest } from "@paron/agents";

export const dynamic = "force-dynamic";

/**
 * POST /api/intents/quote — NEAR Intents 1Click quote proxy. Uses the live API when the server has
 * ONE_CLICK_JWT (the JWT never reaches the browser); otherwise returns the deterministic local quote.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as OneClickQuoteRequest | null;
  if (!body?.originAsset || !body.destinationAsset || !body.amount) {
    return Response.json({ ok: false, error: "originAsset, destinationAsset and amount are required" }, { status: 400 });
  }
  const bridge = new OneClickIntentsBridge({ jwt: process.env.ONE_CLICK_JWT });
  try {
    const quote = await bridge.quote({ ...body, swapType: body.swapType ?? "EXACT_INPUT", slippageTolerance: body.slippageTolerance ?? 100, dry: body.dry ?? true });
    return Response.json({ ok: true, mode: bridge.mode, quote });
  } catch (e) {
    return Response.json({ ok: false, mode: bridge.mode, error: (e as Error).message }, { status: 502 });
  }
}
