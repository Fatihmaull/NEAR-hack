"use client";

import { useMemo, useState } from "react";
import { base58, FUNCTION_CALL_KEY_METHODS, keyPairFromSeed, SWARM_ACCOUNTS, type SwarmEvent } from "@paron/agents";
import { JUDGE_ACCOUNT, JUDGE_METHODS, useDesk } from "@/lib/desk";
import { cu, plain, usd, utc, yoctoToNear } from "@/lib/format";
import { PARON_CONTRACT_ID, useWallet } from "@/lib/wallet";
import { Badge, EmptyState, Hash, Loading, Panel, Progress } from "../../ui";
import { PageHeader } from "../PageHeader";

interface AgentSpec {
  name: string;
  account: string;
  mandate: string;
  keyRole?: "cfo" | "mm" | "consumer";
}

const AGENTS: AgentSpec[] = [
  { name: "CFO hedging agent", account: SWARM_ACCOUNTS.cfo, mandate: "Hedges the compute budget when 30-day VaR passes 2%, then settles at maturity.", keyRole: "cfo" },
  { name: "LP market maker", account: SWARM_ACCOUNTS.marketMaker, mandate: "Quotes both sides around the index, keeps a 40% margin buffer, liquidates other vaults as keeper.", keyRole: "mm" },
  { name: "Compute consumer", account: SWARM_ACCOUNTS.consumer, mandate: "Buys December inventory, redeems it for jobs and claims SLA slashes.", keyRole: "consumer" },
  { name: "Desk agent (you)", account: JUDGE_ACCOUNT, mandate: "Signs the orders you place on the Trade page." },
];

const EVENT_LABEL: Record<string, string> = {
  tx: "Transaction",
  attestation: "Attestation",
  intent: "Intents",
  "chain-signature": "Chain Signatures",
  guardrail: "Guardrail",
  security: "Security",
  liquidation: "Liquidation",
  settlement: "Settlement",
  redemption: "Redemption",
  analysis: "Analysis",
  info: "Info",
};

function AgentRow({ spec }: { spec: AgentSpec }) {
  const { snapshot, sim, judge } = useDesk();
  const policy = snapshot?.guardrails?.[spec.account];
  const balance = snapshot?.balances?.[spec.account];
  const key = spec.keyRole
    ? snapshot?.function_call_keys?.[spec.keyRole]
    : judge && sim
      ? { public_key: judge.key.publicKey, nonce: sim.runtime.accessKey(judge.key).nonce, permission: sim.runtime.accessKey(judge.key).permission }
      : null;
  const perm = key?.permission as { methodNames?: string[]; allowanceYocto?: string | bigint | null } | undefined;
  const methods = perm?.methodNames ?? (spec.keyRole ? FUNCTION_CALL_KEY_METHODS[spec.account] : JUDGE_METHODS) ?? [];
  const multichain = sim?.multichain[spec.account];
  const spent = Number(policy?.spent_today_micros ?? 0) / 1e6;
  const cap = Number(policy?.max_daily_spend_micros ?? 0) / 1e6;
  const held: string[] = balance?.cu ?? ["0", "0", "0"];
  const nearCap = cap > 0 && spent / cap > 0.8;

  return (
    <li className="border-t border-hairline py-6 first:border-t-0 first:pt-1">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold text-ink">{spec.name}</h3>
          <p className="truncate font-mono text-[12.5px] text-body" title={spec.account}>
            {spec.account}
          </p>
          <p className="mt-2 text-[14px] leading-6 text-body">{spec.mandate}</p>
        </div>
        <dl className="grid grid-cols-2 content-start gap-4">
          <div>
            <dt className="text-[13px] text-body">Free margin</dt>
            <dd className="num mt-0.5 text-[16px] text-ink">{usd(balance?.free_usdc_micros)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-body">CU held, Nov / Dec / Jan</dt>
            <dd className="num mt-0.5 text-[16px] text-ink">{held.map((c) => cu(c, 0)).join(" / ")}</dd>
          </div>
        </dl>
        <div className="min-w-0">
          {policy ? (
            <>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-body">Spent today</span>
                <span className={`num ${nearCap ? "text-warn" : "text-ink"}`}>
                  ${spent.toLocaleString("en-US", { maximumFractionDigits: 0 })} of ${cap.toLocaleString("en-US")}
                </span>
              </div>
              <div className="mt-2">
                <Progress value={spent} max={cap || 1} tone={nearCap ? "warn" : "primary"} label={`${spec.name} daily spend`} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge>±{policy.max_slippage_bps} bps band</Badge>
                <Badge>{policy.allowed_series?.length ? policy.allowed_series.join(", ") : "All series"}</Badge>
                {policy.paused ? <Badge tone="down">Paused</Badge> : <Badge tone="up">Active</Badge>}
              </div>
            </>
          ) : (
            <p className="text-[13.5px] text-body">No guardrail policy registered.</p>
          )}
        </div>
      </div>
      <details className="group mt-4 rounded-field bg-soft">
        <summary className="flex min-h-[44px] items-center justify-between gap-3 px-4 text-[14px] font-medium text-ink">
          Function Call key: {methods.length} allowed methods, withdrawals blocked
          <span className="text-[13px] font-normal text-body group-open:hidden">Show</span>
          <span className="hidden text-[13px] font-normal text-body group-open:inline">Hide</span>
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13.5px]">
            <span className="text-body">
              Public key <Hash value={key?.public_key} head={14} tail={6} />
            </span>
            <span className="text-body">
              Nonce <span className="num text-ink">{key?.nonce ?? 0}</span>
            </span>
            <span className="text-body">
              Gas allowance left <span className="num text-ink">{perm?.allowanceYocto ? `${yoctoToNear(String(perm.allowanceYocto))} NEAR` : "unknown"}</span>
            </span>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Allowed methods">
            {methods.map((m) => (
              <li key={m} className="rounded-full bg-canvas px-2.5 py-0.5 font-mono text-[12px] text-ink ring-1 ring-hairline">
                {m}
              </li>
            ))}
            <li className="rounded-full bg-down-soft px-2.5 py-0.5 font-mono text-[12px] text-down">withdraw_usdc not allowed</li>
          </ul>
          {multichain ? (
            <div className="text-[13.5px] text-body">
              <p>
                Chain Signatures addresses via <span className="font-mono">{multichain.mpcContractId}</span>
              </p>
              <p className="mt-1">
                Base <Hash value={multichain.evm.address} head={10} tail={6} />
              </p>
              <p>
                Solana <Hash value={multichain.solana.address} head={10} tail={6} />
              </p>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function ActivityLog() {
  const { events } = useDesk();
  const recent = useMemo(() => events.filter((e: SwarmEvent) => e.actor !== "Tour" && (e.title || e.detail)).slice(-20).reverse(), [events]);
  if (!recent.length) return <EmptyState title="No agent activity yet">Agent events appear here once the local engine has started.</EmptyState>;
  return (
    <ol>
      {recent.map((e) => (
        <li key={e.seq} className="border-t border-hairline px-5 py-3 first:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <Badge tone={e.ok === false ? "down" : e.kind === "attestation" ? "primary" : "neutral"}>{e.ok === false ? "Rejected" : EVENT_LABEL[e.kind] ?? e.kind}</Badge>
              <span className="truncate text-[13.5px] font-medium text-ink">{e.actor.replace(/-/g, " ")}</span>
            </span>
            <span className="num shrink-0 text-[12px] text-muted">{utc(e.t).slice(5, 16)}</span>
          </div>
          <p className="mt-1 break-words text-[13.5px] leading-5 text-body">{plain(e.title || e.detail)}</p>
          {e.txHash ? (
            <div className="mt-0.5 text-[12.5px] text-muted">
              <Hash value={e.txHash} head={8} tail={4} /> {e.keyKind === "FunctionCall" ? "signed with a Function Call key" : e.keyKind ? "signed with a full-access key" : ""}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function DelegateKey() {
  const wallet = useWallet();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const delegate = async () => {
    setError(null);
    try {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const kp = keyPairFromSeed(seed, "browser-agent");
      await wallet.send(wallet.accountId!, [
        {
          type: "AddKey",
          params: {
            publicKey: kp.nearPublicKey,
            accessKey: { permission: { receiverId: PARON_CONTRACT_ID, allowance: "250000000000000000000000", methodNames: FUNCTION_CALL_KEY_METHODS[SWARM_ACCOUNTS.cfo] } },
          },
        },
      ]);
      setSecret(`ed25519:${base58.encode(new Uint8Array([...kp.secretKey, ...kp.publicKey]))}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!wallet.accountId || !wallet.liveEnabled)
    return <p className="text-[14px] text-body">Connect a NEAR testnet wallet from the sidebar to add a Function Call key that lets the CFO agent trade on your behalf without withdrawal rights.</p>;
  return (
    <div>
      <p className="text-[14px] text-body">
        Adds a key to <span className="font-mono text-ink">{wallet.accountId}</span> that can call only the CFO agent&apos;s {FUNCTION_CALL_KEY_METHODS[SWARM_ACCOUNTS.cfo].length} methods on{" "}
        <span className="font-mono text-ink">{PARON_CONTRACT_ID}</span>, with 0.25 NEAR of gas and no deposits.
      </p>
      <button type="button" className="btn-primary btn-sm mt-3" onClick={delegate}>
        Add agent key
      </button>
      {secret ? (
        <div className="mt-3 rounded-field bg-warn-soft p-3">
          <p className="text-[13px] font-semibold text-warn">Shown once. Store it before leaving this page.</p>
          <p className="mt-1 break-all font-mono text-[12.5px] text-ink">NEAR_PRIVATE_KEY={secret}</p>
          <p className="mt-1 text-[12.5px] text-body">
            Run the agent with <span className="font-mono">npm --prefix agents run agent:live -- cfo</span>.
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-down">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AgentsView() {
  const { sim, ready } = useDesk();
  const txs = sim?.runtime.txs ?? [];
  const viaKeys = txs.filter((t) => t.access_key === "FunctionCall").length;
  return (
    <>
      <PageHeader
        title="Agents"
        description="Each agent trades with its own Function Call key, inside a policy its treasury set on-chain. Watch the spend against the cap."
        actions={ready ? <p className="text-[13.5px] text-body"><span className="num text-ink">{viaKeys}</span> of <span className="num text-ink">{txs.length}</span> transactions signed with Function Call keys</p> : null}
      />
      <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel title="Agents and guardrails" description={`Governed by ${SWARM_ACCOUNTS.treasury}`}>
          {ready ? (
            <ul>
              {AGENTS.map((a) => (
                <AgentRow key={a.account} spec={a} />
              ))}
            </ul>
          ) : (
            <Loading>Starting the local engine and the agent swarm…</Loading>
          )}
        </Panel>
        <div className="min-w-0 space-y-5">
          <Panel title="Activity" description="The last 20 agent events, newest first." bodyClassName="px-0 py-1">
            <ActivityLog />
          </Panel>
          <Panel title="Run an agent from your wallet">
            <DelegateKey />
          </Panel>
        </div>
      </div>
    </>
  );
}
