"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, ExternalLink, RefreshCw, Satellite } from "lucide-react";
import { describeState } from "@paron/agents";
import { useDesk } from "@/lib/desk";
import { cu, price, usd } from "@/lib/format";
import { functionCall, USDC_TOKEN_ID, useWallet } from "@/lib/wallet";
import { Badge, Panel, Stat } from "./ui";

const EXPLORER = "https://testnet.nearblocks.io";

interface LiveEvent {
  phase: string;
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

interface LiveState {
  live: boolean;
  error?: string;
  fetched_at?: number;
  accounts: Record<string, string>;
  contracts: Record<string, { account: string; wasm_sha256: string; code_hash?: string; bytes: number }>;
  tee_signer_public_key?: string;
  function_call_keys: Record<string, { method_names: string[] }>;
  deploy_txs: Array<{ step: string; label: string; hash: string; url: string }>;
  run: { updated_at: string; events: LiveEvent[] };
  stats?: Record<string, any>;
  series?: Array<Record<string, any>>;
  books?: Record<string, { best_bid_micros: string | null; best_ask_micros: string | null }>;
  redemptions?: Array<Record<string, any>>;
  liquidations?: Array<Record<string, any>>;
}

const PHASES: Record<string, string> = {
  supply: "Supply",
  hedge: "Hedge",
  spike: "Index spike",
  modeb: "Mode B",
  ghost: "Ghost slash",
  drill: "Guardrail drill",
  settle: "Settlement",
};

function AccountLink({ id, label }: { id: string; label: string }) {
  return (
    <a href={`${EXPLORER}/address/${id}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1 text-[11.5px] hover:bg-ink-800">
      <span className="text-fg-dim">{label}</span>
      <span className="flex min-w-0 items-center gap-1 font-mono text-fg-muted">
        <span className="truncate">{id}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </span>
    </a>
  );
}

export function LiveTestnetPanel() {
  const wallet = useWallet();
  const { notify } = useDesk();
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/testnet", { cache: "no-store" });
      setState((await res.json()) as LiveState);
    } catch (e) {
      setState((s) => (s ? { ...s, live: false, error: (e as Error).message } : s));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const events = useMemo(() => (state?.run.events ?? []).filter((e) => phase === "all" || e.phase === phase), [state, phase]);
  const onChainTxs = (state?.run.events ?? []).filter((e) => e.txHash).length + (state?.deploy_txs.length ?? 0);

  const faucet = async () => {
    try {
      await wallet.send(USDC_TOKEN_ID, [functionCall("faucet", { amount: "1000000000" }, "0", "30000000000000")]);
      notify({ kind: "ok", title: "1,000 test USDC minted to your wallet", detail: `${USDC_TOKEN_ID}.faucet → ${wallet.accountId}. Use "Deposit USDC" in the Order Book Desk next.` });
    } catch (e) {
      notify({ kind: "error", title: "Faucet transaction failed", detail: (e as Error).message });
    }
  };

  if (!state) return <div className="h-[120px] animate-pulse rounded-lg bg-ink-900" />;
  const A = state.accounts;
  const s = state.stats;

  return (
    <Panel
      title="Live on NEAR testnet"
      icon={<Satellite className="h-4 w-4 text-near" />}
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.live ? "near" : "warn"}>{state.live ? "RPC live" : "RPC unreachable — showing recorded run"}</Badge>
          <a href={`${EXPLORER}/address/${A.contract}`} target="_blank" rel="noreferrer" className="hidden items-center gap-1 font-mono text-[11.5px] text-fg-muted hover:text-fg sm:flex">
            {A.contract} <ExternalLink className="h-3 w-3" />
          </a>
          <button type="button" className="btn-ghost px-2 py-1" onClick={load} disabled={loading} title="Refresh from RPC">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      <p className="mb-3 text-[12.5px] leading-relaxed text-fg-muted">
        The same agent classes as the offline swarm, running against the deployed <span className="font-mono text-fg">paron-core</span> with their own Function Call keys. Each line below is a
        real testnet transaction. Rejections such as the guardrail&apos;s slippage check are on-chain too. Collateral is a no-value test USDC (NEP-141). The OutLayer signer is a secret key held by the
        operator until the worker runs in a TDX enclave (see README).
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="On-chain txs" value={onChainTxs} sub="deploy + live swarm" tone="near" />
        <Stat label="CU-2026-11 index" value={state.series ? price(state.series[0]?.index_twap_usdc_micros) : "—"} sub="OutLayer-attested TWAP" tone="tee" />
        <Stat label="Open interest" value={state.series ? `${cu(state.series.reduce((a, x) => a + BigInt(x.total_open_interest_cu), 0n), 0)} CU` : "—"} sub="all series" />
        <Stat label="Liquidations" value={s ? String(s.liquidations) : "—"} sub="permissionless keeper" tone="warn" />
        <Stat label="Mode B jobs" value={state.redemptions ? state.redemptions.length : "—"} sub={`${state.redemptions?.filter((r) => "SlashedForSlaBreach" in r.state).length ?? 0} slashed`} tone="danger" />
        <Stat label="Insurance pool" value={s ? usd(s.insurance_pool_micros, 0) : "—"} sub={s?.withdrawals_enabled ? "genesis credit repaid" : ""} tone="tee" />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 rounded-lg border border-ink-600/70 bg-ink-850 p-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">Live swarm run · {state.run.events.length} events</span>
            <div className="flex flex-wrap gap-1">
              {["all", ...Object.keys(PHASES).filter((p) => state.run.events.some((e) => e.phase === p))].map((p) => (
                <button key={p} type="button" onClick={() => setPhase(p)} className={`rounded px-1.5 py-0.5 text-[11px] ${phase === p ? "bg-ink-600 text-fg" : "text-fg-dim hover:text-fg"}`}>
                  {p === "all" ? "All" : PHASES[p]}
                </button>
              ))}
            </div>
          </div>
          <ol className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
            {events.map((e, i) => (
              <li key={`${e.phase}-${i}`} className={`rounded-md border-l-2 bg-ink-800/60 px-2 py-1.5 text-[12px] ${e.ok === false ? "border-danger/70" : "border-near/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-fg-dim">{e.actor} · </span>
                    <span className={e.ok === false ? "text-danger" : "text-fg"}>{e.title}</span>
                  </span>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-near hover:underline" title={e.txHash}>
                      {e.txHash?.slice(0, 6)}… <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : e.ok === false ? (
                    <Badge tone="danger">rejected</Badge>
                  ) : null}
                </div>
                {e.detail ? <div className="mt-0.5 break-words text-[11px] text-fg-muted">{e.detail}</div> : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-w-0 space-y-3">
          {state.series ? (
            <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-2">
              <div className="mb-1 px-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">On-chain series (view calls)</div>
              <table className="w-full text-[12px]">
                <tbody className="divide-y divide-ink-700">
                  {state.series.map((x) => {
                    const b = state.books?.[x.series_id];
                    return (
                      <tr key={x.series_id}>
                        <td className="py-1 font-mono text-fg">{x.series_id}</td>
                        <td className="num py-1 text-right text-near">{price(x.index_twap_usdc_micros)}</td>
                        <td className="num py-1 text-right text-fg-muted">
                          {b?.best_bid_micros ? price(b.best_bid_micros) : "—"} / {b?.best_ask_micros ? price(b.best_ask_micros) : "—"}
                        </td>
                        <td className="num py-1 text-right">{cu(x.total_open_interest_cu, 0)} CU</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-[11.5px] text-warn">{state.error}</div>
          )}

          {state.redemptions?.length ? (
            <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-2">
              <div className="mb-1 px-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">Mode B redemptions</div>
              {state.redemptions.map((r) => (
                <div key={r.request_id} className="flex items-center justify-between gap-2 px-1 py-0.5 text-[11.5px]">
                  <span className="text-fg-muted">
                    #{r.request_id} · {cu(r.cu_amount_scaled, 0)} CU
                  </span>
                  <span className={"SlashedForSlaBreach" in r.state ? "text-danger" : "DeliveredViaTee" in r.state ? "text-near" : "text-fg-muted"}>{describeState(r.state)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="rounded-lg border border-ink-600/70 bg-ink-850 p-1">
            <AccountLink id={A.contract} label="paron-core" />
            <AccountLink id={A.usdc_token} label="test USDC (NEP-141)" />
            <AccountLink id={A.cfo} label="CFO agent" />
            <AccountLink id={A.market_maker} label="LP agent" />
            <AccountLink id={A.consumer} label="Consumer agent" />
            <AccountLink id={A.provider} label="Provider" />
            <AccountLink id={A.relayer} label="OutLayer relayer" />
          </div>

          {wallet.accountId && wallet.liveEnabled ? (
            <button type="button" className="btn-ghost w-full justify-center" onClick={faucet}>
              <Coins className="h-4 w-4" /> Get 1,000 test USDC for {wallet.accountId}
            </button>
          ) : (
            <p className="px-1 text-[11.5px] text-fg-dim">Connect a NEAR testnet wallet to mint test USDC from the public faucet and trade on the deployed contract from the Order Book Desk.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
