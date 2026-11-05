"use client";

import { useMemo, useState } from "react";
import { Bot, KeyRound, Network, ShieldCheck } from "lucide-react";
import { base58, FUNCTION_CALL_KEY_METHODS, keyPairFromSeed, SWARM_ACCOUNTS, type SwarmEvent } from "@paron/agents";
import { JUDGE_ACCOUNT, useDesk } from "@/lib/desk";
import { cu, usd, utc, yoctoToNear } from "@/lib/format";
import { PARON_CONTRACT_ID, useWallet } from "@/lib/wallet";
import { Badge, Hash, Panel, Progress } from "./ui";

interface AgentCardSpec {
  name: string;
  account: string;
  role: string;
  keyRole?: "cfo" | "mm" | "consumer";
  tone: "near" | "tee" | "intents";
}

const AGENTS: AgentCardSpec[] = [
  { name: "CFO-Hedging-Agent", account: SWARM_ACCOUNTS.cfo, role: "Runway VaR → guardrailed CU hedges → Mode A settlement", keyRole: "cfo", tone: "near" },
  { name: "Yield-LP-Market-Maker-Agent", account: SWARM_ACCOUNTS.marketMaker, role: "Post-only two-sided quotes · 40% margin buffer · keeper", keyRole: "mm", tone: "tee" },
  { name: "Compute-Consumer-Agent", account: SWARM_ACCOUNTS.consumer, role: "Mode B drawdowns · TDX receipts · SLA slash claims", keyRole: "consumer", tone: "intents" },
];

const KIND_TONE: Record<string, "near" | "tee" | "intents" | "warn" | "danger" | "muted"> = {
  tx: "near",
  attestation: "tee",
  intent: "intents",
  "chain-signature": "intents",
  guardrail: "warn",
  security: "danger",
  liquidation: "danger",
  settlement: "near",
  redemption: "tee",
  analysis: "muted",
  info: "muted",
};

function AgentCard({ spec }: { spec: AgentCardSpec }) {
  const { snapshot, sim, judge } = useDesk();
  const policy = snapshot?.guardrails?.[spec.account] ?? (spec.account === JUDGE_ACCOUNT ? sim?.runtime.view("get_agent_guardrail", { agent_id: JUDGE_ACCOUNT }) : null);
  const balance = snapshot?.balances?.[spec.account];
  const fk = spec.keyRole ? snapshot?.function_call_keys?.[spec.keyRole] : judge ? { public_key: judge.key.publicKey, nonce: sim?.runtime.accessKey(judge.key).nonce, permission: sim?.runtime.accessKey(judge.key).permission } : null;
  const perm = fk?.permission as { methodNames?: string[]; allowanceYocto?: string | bigint | null } | undefined;
  const multichain = sim?.multichain[spec.account];
  const spent = Number(policy?.spent_today_micros ?? 0) / 1e6;
  const cap = Number(policy?.max_daily_spend_micros ?? 0) / 1e6;
  const methods = perm?.methodNames ?? FUNCTION_CALL_KEY_METHODS[spec.account] ?? [];
  const cuHeld: string[] = balance?.cu ?? ["0", "0", "0"];

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-ink-600/70 bg-ink-850 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Bot className={`h-4 w-4 ${spec.tone === "near" ? "text-near" : spec.tone === "tee" ? "text-tee" : "text-intents"}`} />
            <span className="truncate">{spec.name}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-fg-dim">{spec.account}</div>
        </div>
        <span className="flex items-center gap-1 text-[10.5px] text-near">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-near" /> live
        </span>
      </div>
      <p className="text-[11.5px] text-fg-muted">{spec.role}</p>

      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
        <div className="rounded-md bg-ink-800 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-fg-dim">free margin</div>
          <div className="num text-fg">{usd(balance?.free_usdc_micros)}</div>
        </div>
        <div className="rounded-md bg-ink-800 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-fg-dim">CU held (Nov/Dec/Jan)</div>
          <div className="num truncate text-fg">{cuHeld.map((c) => cu(c, 0)).join(" / ")}</div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[10.5px] uppercase tracking-wider text-fg-dim">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> guardrail · daily spend
          </span>
          <span className="num normal-case tracking-normal text-fg-muted">
            ${spent.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${cap.toLocaleString()}
          </span>
        </div>
        <Progress value={spent} max={cap || 1} tone={spent / (cap || 1) > 0.8 ? "warn" : "near"} />
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="chip">slippage ≤ {policy?.max_slippage_bps ?? "—"} bps vs TWAP</span>
          <span className="chip">{policy?.allowed_series?.length ? policy.allowed_series.join(", ") : "all series"}</span>
          {policy?.paused ? <Badge tone="danger">paused</Badge> : null}
        </div>
      </div>

      <div className="rounded-md border border-ink-600/70 bg-ink-900 p-2">
        <div className="mb-1 flex items-center justify-between text-[10.5px] uppercase tracking-wider text-fg-dim">
          <span className="flex items-center gap-1">
            <KeyRound className="h-3 w-3 text-tee" /> NEAR Function Call key
          </span>
          <span className="num normal-case tracking-normal text-fg-muted">nonce {fk?.nonce ?? 0}</span>
        </div>
        <Hash value={fk?.public_key} head={14} tail={6} />
        <div className="mt-1 flex items-center justify-between text-[11px] text-fg-muted">
          <span>gas allowance left</span>
          <span className="num text-fg">{perm?.allowanceYocto ? `${yoctoToNear(String(perm.allowanceYocto))} Ⓝ` : "—"}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {methods.map((m) => (
            <span key={m} className="chip">
              {m}
            </span>
          ))}
          <span className="chip border-danger/40 text-danger/80">withdraw_usdc ✕</span>
        </div>
      </div>

      {multichain ? (
        <div className="rounded-md border border-intents/30 bg-intents/[0.06] p-2 text-[11px]">
          <div className="mb-1 flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-intents">
            <Network className="h-3 w-3" /> Chain Signatures · {multichain.mpcContractId}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-dim">EVM/Base</span>
            <Hash value={multichain.evm.address} head={10} tail={6} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-dim">Solana</span>
            <Hash value={multichain.solana.address} head={10} tail={6} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DelegateKey() {
  const wallet = useWallet();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!wallet.accountId || !wallet.liveEnabled) return null;
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
  return (
    <div className="mt-3 rounded-lg border border-tee/30 bg-tee/[0.05] p-3 text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-fg-muted">
          Delegate a scoped <span className="text-fg">Function Call key</span> on <span className="font-mono">{wallet.accountId}</span> to run the CFO agent live (
          <span className="font-mono">npm --prefix agents run agent:live -- cfo</span>).
        </span>
        <button type="button" className="btn-ghost py-1.5" onClick={delegate}>
          <KeyRound className="h-4 w-4" /> Add agent key
        </button>
      </div>
      {secret ? (
        <div className="mt-2 break-all rounded-md bg-ink-900 p-2 font-mono text-[11px] text-warn">
          NEAR_PRIVATE_KEY={secret}
          <div className="mt-1 text-fg-dim">Generated in this browser; shown once. It can only call Paron agent methods with no deposit.</div>
        </div>
      ) : null}
      {error ? <div className="mt-1 text-danger">{error}</div> : null}
    </div>
  );
}

function ActivityStream() {
  const { events } = useDesk();
  const recent = useMemo(() => events.filter((e: SwarmEvent) => e.actor !== "Tour").slice(-14).reverse(), [events]);
  return (
    <div className="rounded-lg border border-ink-600/70 bg-ink-850">
      <div className="border-b border-ink-600/70 px-3 py-2 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">Swarm activity stream</div>
      <ul className="max-h-[320px] divide-y divide-ink-700 overflow-y-auto">
        {recent.map((e) => (
          <li key={e.seq} className="animate-fade-in px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Badge tone={e.ok === false ? (e.kind === "guardrail" || e.kind === "security" ? "warn" : "danger") : KIND_TONE[e.kind] ?? "muted"}>{e.kind}</Badge>
                <span className="truncate text-[12px] font-medium text-fg">{e.actor}</span>
              </span>
              <span className="num shrink-0 text-[10.5px] text-fg-dim">{utc(e.t).slice(5)}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-fg-muted">{e.title}</div>
            {e.txHash ? (
              <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-fg-dim">
                tx <Hash value={e.txHash} head={8} tail={4} /> {e.keyKind ? <span>· {e.keyKind === "FunctionCall" ? "Function Call key" : "full-access key"}</span> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentSwarmPanel() {
  const { sim } = useDesk();
  const txs = sim?.runtime.txs ?? [];
  const fcTx = txs.filter((t) => t.access_key === "FunctionCall").length;
  return (
    <Panel
      title="Autonomous Agent Swarm"
      icon={<Bot className="h-4 w-4 text-near" />}
      right={
        <span className="font-mono text-[11px] text-fg-dim">
          {txs.length} signed txs · {fcTx} via Function Call keys · governed by <span className="text-fg-muted">{SWARM_ACCOUNTS.treasury}</span>
        </span>
      }
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
        {AGENTS.map((a) => (
          <AgentCard key={a.account} spec={a} />
        ))}
        <ActivityStream />
      </div>
      <DelegateKey />
    </Panel>
  );
}
