import { SwarmSimulation, verifyReceipt } from "@paron/agents";

export const dynamic = "force-dynamic";

/** GET /api/receipt — runs the full deterministic 5-act swarm server-side and returns the audit receipt. */
export async function GET() {
  const sim = await SwarmSimulation.create();
  const receipt = await sim.runAll();
  const verification = verifyReceipt(receipt);
  return Response.json(receipt, {
    headers: {
      "x-paron-receipt-sha256": receipt.receipt_sha256,
      "x-paron-receipt-verified": String(verification.ok),
      "cache-control": "no-store",
    },
  });
}
