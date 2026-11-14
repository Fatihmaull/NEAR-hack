"use client";

import { useMemo, useState } from "react";
import { useDesk } from "@/lib/desk";
import { cu, plain, price, redemptionLabel, usd } from "@/lib/format";
import { explorerAccount, onChainTxCount, useTestnet } from "@/lib/testnet";
import { functionCall, USDC_TOKEN_ID, useWallet } from "@/lib/wallet";
import { Badge, ErrorState, Loading, Panel, Segmented, Stat } from "../../ui";
import { PageHeader } from "../PageHeader";

const PHASES: Record<string, string> = { all: "All", supply: "Supply", hedge: "Hedge", spike: "Index spike", modeb: "Mode B", ghost: "Ghost slash", drill: "Guardrail drill" };

export function TestnetView() {
  const { state, error, loading, reload } = useTestnet(30_000);
  const { notify } = useDesk();
  const wallet = useWallet();
  const [phase, setPhase] = useState("all");
  const events = useMemo(() => (state?.run.events ?? []).filter((e) => phase === "all" || e.phase === phase), [state, phase]);
  const phases = useMemo(() => ["all", ...Object.keys(PHASES).filter((p) => p !== "all" && state?.run.events.some((e) => e.phase === p))], [state]);

  const faucet = async () => {
    try {
      await wallet.send(USDC_TOKEN_ID, [functionCall("faucet", { amount: "1000000000" }, "0", "30000000000000")]);
      notify({ kind: "ok", title: "1,000 test USDC sent to your wallet", detail: "Deposit it from the Trade page to sign orders on testnet." });
    } catch (e) {
      notify({ kind: "error", title: "Faucet transaction failed", detail: (e as Error).message });
    }
  };

  const A = state?.accounts;
  const s = state?.stats;
  return (
    <>
      <PageHeader
        title="Live testnet"
        description="The same agents, run against paron-core deployed on NEAR testnet. Each line below is a real transaction, rejections included."
        actions={
          <>
            {state ? <Badge tone={state.live ? "up" : "warn"}>{state.live ? "RPC connected" : "RPC unreachable, showing the recorded run"}</Badge> : null}
            <button type="button" className="btn-outline btn-sm" onClick={reload} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </>
        }
      />
      {error && !state ? (
        <ErrorState title="Could not reach the testnet API" onRetry={reload}>
          {error}
        </ErrorState>
      ) : !state || !A ? (
        <Loading>Reading paron-core on NEAR testnet…</Loading>
      ) : (
        <div className="space-y-5">
          <Panel title="Contract state" description={<a href={explorerAccount(A.contract)} target="_blank" rel="noreferrer" className="link font-mono text-[13px]">{A.contract}<span className="sr-only"> (opens in a new tab)</span></a>}>
            <dl className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Transactions" value={onChainTxCount(state)} sub="deployment and agent run" />
              <Stat label="Front-month index" value={state.series ? price(state.series[0]?.index_twap_usdc_micros) : "unknown"} sub="OutLayer-attested" />
              <Stat label="Open interest" value={state.series ? `${cu(state.series.reduce((a, x) => a + BigInt(x.total_open_interest_cu), 0n), 0)} CU` : "unknown"} />
              <Stat label="Liquidations" value={s ? String(s.liquidations) : "unknown"} />
              <Stat label="Mode B jobs" value={state.redemptions?.length ?? 0} sub={`${state.redemptions?.filter((r) => "SlashedForSlaBreach" in r.state).length ?? 0} slashed`} />
              <Stat label="Insurance pool" value={s ? usd(s.insurance_pool_micros, 0) : "unknown"} sub={s?.withdrawals_enabled ? "genesis credit repaid" : undefined} />
            </dl>
          </Panel>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel
              title="Agent run on testnet"
              description={`${state.run.events.length} events · recorded ${state.run.updated_at.slice(0, 10)}`}
              actions={<Segmented label="Phase" value={phase} onChange={setPhase} options={phases.map((p) => ({ value: p, label: PHASES[p] ?? p }))} />}
              bodyClassName="px-0 py-1"
            >
              <ol className="relative max-h-[640px] overflow-y-auto">
                {events.map((e, i) => (
                  <li key={`${e.phase}-${i}`} className="border-t border-hairline px-5 py-3.5 first:border-t-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-[14px] leading-5">
                        <span className="text-body">{e.actor.replace(/-/g, " ")}: </span>
                        <span className={e.ok === false ? "text-down" : "text-ink"}>{plain(e.title)}</span>
                      </p>
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noreferrer" className="link num shrink-0 text-[12.5px]" title={e.txHash}>
                          {e.txHash?.slice(0, 6)}…<span className="sr-only"> view on nearblocks (opens in a new tab)</span>
                        </a>
                      ) : e.ok === false ? (
                        <Badge tone="down">Refused before broadcast</Badge>
                      ) : null}
                    </div>
                    {e.detail ? <p className="mt-1 break-words text-[13px] text-body">{plain(e.detail)}</p> : null}
                  </li>
                ))}
              </ol>
            </Panel>

            <div className="min-w-0 space-y-5">
              {state.redemptions?.length ? (
                <Panel title="Mode B redemptions" bodyClassName="px-0 py-1">
                  <ul>
                    {state.redemptions.map((r) => {
                      const label = redemptionLabel(r.state);
                      return (
                        <li key={r.request_id} className="border-t border-hairline px-5 py-3 first:border-t-0">
                          <p className="text-[14px] text-ink">
                            Job #{r.request_id} <span className="num whitespace-nowrap text-body">· {cu(r.cu_amount_scaled, 0)} CU</span>
                          </p>
                          <p className={`text-[13px] ${label.tone === "up" ? "text-up" : label.tone === "down" ? "text-down" : "text-warn"}`}>{label.text}</p>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              ) : null}
              <Panel title="Accounts" bodyClassName="px-0 py-1">
                <ul>
                  {[
                    ["paron-core", A.contract],
                    ["Test USDC (NEP-141)", A.usdc_token],
                    ["CFO agent", A.cfo],
                    ["LP agent", A.market_maker],
                    ["Consumer agent", A.consumer],
                    ["Provider", A.provider],
                    ["OutLayer relayer", A.relayer],
                  ].map(([label, id]) => (
                    <li key={id} className="border-t border-hairline first:border-t-0">
                      <a href={explorerAccount(id)} target="_blank" rel="noreferrer" className="flex min-h-[48px] items-center justify-between gap-3 px-5 text-[13.5px] hover:bg-soft">
                        <span className="text-body">{label}</span>
                        <span className="truncate font-mono text-[12.5px] text-primary">
                          {id}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Try it with your wallet">
                {wallet.accountId && wallet.liveEnabled ? (
                  <>
                    <p className="text-[14px] text-body">Mint test USDC from the public faucet, then deposit and trade from the Trade page.</p>
                    <button type="button" className="btn-primary btn-sm mt-3" onClick={faucet}>
                      Get 1,000 test USDC
                    </button>
                  </>
                ) : (
                  <p className="text-[14px] text-body">Connect a NEAR testnet wallet from the sidebar to mint test USDC and sign orders against this contract.</p>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
