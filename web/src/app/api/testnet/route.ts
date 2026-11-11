import { TESTNET_DEPLOYMENT, TESTNET_EXPLORER_TX, TESTNET_RPC_URL } from "@paron/agents/testnet";
import { TESTNET_RUN } from "@paron/agents/testnet-run";

export const dynamic = "force-dynamic";

const RPC = process.env.NEAR_RPC_URL?.trim() || TESTNET_RPC_URL;
const CONTRACT = TESTNET_DEPLOYMENT.accounts.contract;

async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "paron",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as { result?: { result?: number[] }; error?: { message?: string; data?: unknown } };
  if (!body.result?.result) throw new Error(`${method}: ${body.error?.message ?? res.status} ${JSON.stringify(body.error?.data ?? "")}`);
  return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
}

interface RunEvent {
  actor: string;
  kind: string;
  title: string;
  detail?: string;
  ok?: boolean;
  method?: string;
  keyKind?: string;
  txHash?: string;
  url?: string;
}

/**
 * GET /api/testnet — the deployed paron-core read straight from NEAR testnet (series, books, protocol stats,
 * Mode B redemptions, liquidations) plus the public log of the live agent-swarm run with explorer links.
 */
export async function GET() {
  const runEvents = Object.entries(TESTNET_RUN.phases as Record<string, { started_at: string; finished_at?: string; events: RunEvent[] }>).flatMap(([phase, p]) =>
    p.events.map((e) => ({ phase, actor: e.actor, kind: e.kind, title: e.title, detail: e.detail, ok: e.ok, method: e.method, keyKind: e.keyKind, txHash: e.txHash, url: e.url })),
  );
  const deployTxs = Object.entries(TESTNET_DEPLOYMENT.steps).flatMap(([step, txs]) => txs.map((t) => ({ step, ...t })));
  const base = {
    network: "testnet",
    rpc_url: RPC,
    explorer_tx: TESTNET_EXPLORER_TX,
    accounts: TESTNET_DEPLOYMENT.accounts,
    contracts: TESTNET_DEPLOYMENT.contracts,
    tee_signer_public_key: TESTNET_DEPLOYMENT.tee_signer_public_key,
    function_call_keys: TESTNET_DEPLOYMENT.function_call_keys,
    guardrails: TESTNET_DEPLOYMENT.guardrails,
    deploy_txs: deployTxs,
    run: { updated_at: TESTNET_RUN.updated_at, events: runEvents },
  };
  try {
    const [stats, series, redemptions, liquidations] = await Promise.all([
      view<Record<string, unknown>>("protocol_stats"),
      view<Array<Record<string, unknown>>>("list_series"),
      view<Array<Record<string, unknown>>>("get_redemptions", {}),
      view<Array<Record<string, unknown>>>("get_liquidation_receipts", {}),
    ]);
    const books = Object.fromEntries(
      await Promise.all(series.map(async (s) => [s.series_id as string, await view<Record<string, unknown>>("get_order_book", { series_id: s.series_id, depth: 5 })] as const)),
    );
    return Response.json({ ...base, live: true, fetched_at: Date.now(), stats, series, books, redemptions, liquidations }, { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" } });
  } catch (e) {
    return Response.json({ ...base, live: false, error: (e as Error).message }, { headers: { "cache-control": "no-store" } });
  }
}
