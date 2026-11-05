import { ACTS, SwarmSimulation } from "@paron/agents";

export const dynamic = "force-dynamic";

/** GET /api/state?acts=3 — protocol snapshot (series, books, vaults, guardrails, keys, redemptions) after N acts. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const acts = Math.max(0, Math.min(ACTS.length, Number(url.searchParams.get("acts") ?? ACTS.length) || 0));
  const sim = await SwarmSimulation.create();
  for (let act = 1; act <= acts; act++) await sim.runAct(act);
  return Response.json({ acts_completed: acts, snapshot: sim.snapshot(), events: sim.events.map(({ data: _d, ...e }) => e) }, { headers: { "cache-control": "no-store" } });
}
