"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { verifyReceipt, type ReceiptVerification } from "@paron/agents";
import { cu, usd } from "@/lib/format";
import { STEPS } from "@/lib/steps";
import { ErrorState, Hash, Loading, Panel, Stat } from "../../ui";
import { PageHeader } from "../PageHeader";

interface ReceiptJson {
  receipt_sha256: string;
  schema: string;
  contract_id: string;
  tee_signer_public_key: string;
  simulated_clock: { start: string; end: string };
  acts: Array<{ id: number; title: string; subtitle: string; completed: boolean; events: unknown[] }>;
  transactions: unknown[];
  outlayer: { index_attestations: unknown[]; job_receipts: unknown[] };
  outcomes: {
    cfo_hedged_cu: string;
    cfo_avg_entry_price_micros: string;
    cfo_cash_settlement_payout_micros: string;
    cfo_hedge_pnl_micros: string;
    unhedged_spot_cost_micros: string;
    liquidations: number;
    redemptions: Array<{ request_id: number; final_state: string }>;
    consumer_sla_compensation_micros: string;
    failed_transactions: Array<{ index: number; method: string; error: string }>;
    invariants_hold: boolean;
  };
}

const CHECK_LABEL: Record<string, string> = {
  "receipt digest": "The receipt hash matches its contents",
  "transaction signatures": "Every transaction signature is valid",
  "OutLayer index attestations": "Every index attestation verifies against the enclave key",
  "OutLayer TDX execution receipts": "Every job receipt verifies against the enclave key",
};

export function AuditView() {
  const [receipt, setReceipt] = useState<ReceiptJson | null>(null);
  const [verification, setVerification] = useState<ReceiptVerification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setReceipt(null);
    setVerification(null);
    try {
      const res = await fetch("/api/receipt", { cache: "no-store" });
      if (!res.ok) throw new Error(`The receipt API answered ${res.status}.`);
      const json = (await res.json()) as ReceiptJson;
      setReceipt(json);
      setTimeout(() => setVerification(verifyReceipt(json)), 0);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const download = () => {
    if (!receipt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paron-receipt-${receipt.receipt_sha256.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const o = receipt?.outcomes;
  return (
    <>
      <PageHeader
        title="Audit receipt"
        description="The 5-step agent run, replayed on the server and checked again in your browser. The same receipt comes out of the demo, the CLI and this page."
        actions={
          receipt ? (
            <>
              <a href="/api/receipt" target="_blank" rel="noreferrer" className="btn-outline btn-sm">
                Raw JSON<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button type="button" className="btn-primary btn-sm" onClick={download}>
                Download receipt
              </button>
            </>
          ) : null
        }
      />
      {error ? (
        <ErrorState title="Could not build the receipt" onRetry={load}>
          {error}
        </ErrorState>
      ) : !receipt ? (
        <Loading>Replaying the 5-step run on the server…</Loading>
      ) : (
        <div className="space-y-5">
          <Panel title="Receipt" description={`${receipt.schema} · simulated ${receipt.simulated_clock.start.slice(0, 10)} to ${receipt.simulated_clock.end.slice(0, 10)}`}>
            <dl className="grid gap-x-8 gap-y-3 text-[14px] md:grid-cols-[200px_minmax(0,1fr)]">
              <dt className="text-body">SHA-256</dt>
              <dd>
                <Hash value={receipt.receipt_sha256} head={20} tail={12} />
              </dd>
              <dt className="text-body">Contract</dt>
              <dd className="font-mono text-[13px] text-ink">{receipt.contract_id}</dd>
              <dt className="text-body">Enclave signer</dt>
              <dd>
                <Hash value={receipt.tee_signer_public_key} head={16} tail={8} />
              </dd>
              <dt className="text-body">Contents</dt>
              <dd className="text-ink">
                {receipt.transactions.length} signed transactions, {receipt.outlayer.index_attestations.length} index attestations, {receipt.outlayer.job_receipts.length} job receipts
              </dd>
            </dl>
          </Panel>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            <Panel title="Verification in your browser" description="Recomputed here from the JSON above, not trusted from the server.">
              {!verification ? (
                <Loading>Verifying signatures and quote hashes…</Loading>
              ) : (
                <ul className="space-y-3">
                  {verification.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-3">
                      {c.ok ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-up" aria-hidden /> : <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-down" aria-hidden />}
                      <div className="min-w-0">
                        <p className={`text-[14.5px] font-medium ${c.ok ? "text-ink" : "text-down"}`}>
                          {CHECK_LABEL[c.name] ?? c.name}
                          <span className="sr-only">{c.ok ? ": passed" : ": failed"}</span>
                        </p>
                        <p className="break-all font-mono text-[12.5px] text-body">{c.detail}</p>
                      </div>
                    </li>
                  ))}
                  <li className="border-t border-hairline pt-3 text-[13.5px] text-body">
                    Reproduce locally with <code className="num rounded bg-soft px-1.5 py-0.5 text-ink">npm run verify:receipt</code>
                  </li>
                </ul>
              )}
            </Panel>

            <Panel title="Outcomes" description="What the run proved, from the receipt itself.">
              {o ? (
                <dl className="grid grid-cols-2 gap-5">
                  <Stat label="CFO hedge" value={`${cu(o.cfo_hedged_cu, 0)} CU`} sub="CU-2026-11" />
                  <Stat label="Cash settlement payout" value={usd(o.cfo_cash_settlement_payout_micros)} sub={`unhedged cost ${usd(o.unhedged_spot_cost_micros)}`} />
                  <Stat label="Hedge value change" value={usd(o.cfo_hedge_pnl_micros)} tone={BigInt(o.cfo_hedge_pnl_micros) >= 0n ? "up" : "down"} />
                  <Stat label="Liquidations" value={o.liquidations} />
                  <Stat label="SLA compensation to the agent" value={usd(o.consumer_sla_compensation_micros)} sub={`${o.redemptions.filter((r) => r.final_state === "SlashedForSlaBreach").length} of ${o.redemptions.length} jobs slashed`} />
                  <Stat label="Supply conservation" value={o.invariants_hold ? "Holds" : "Broken"} tone={o.invariants_hold ? "up" : "down"} sub="circulating CU = obligations" />
                </dl>
              ) : null}
            </Panel>
          </div>

          <Panel title="The five steps" bodyClassName="px-0 py-1">
            <ol>
              {receipt.acts.map((a) => (
                <li key={a.id} className="grid gap-1 border-t border-hairline px-5 py-4 first:border-t-0 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-4">
                  <span className="num text-[14px] text-muted">{a.id}</span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{STEPS[a.id]?.title ?? a.title}</p>
                    <p className="mt-0.5 text-[13.5px] text-body">{STEPS[a.id]?.summary ?? a.subtitle}</p>
                  </div>
                  <span className="text-[13px] text-body">{a.events.length} events</span>
                </li>
              ))}
            </ol>
          </Panel>

          {o && o.failed_transactions.length ? (
            <Panel title="Transactions the contract rejected on purpose" description="Guardrail and key checks the run expects to fail." bodyClassName="px-0 py-1">
              <ul>
                {o.failed_transactions.map((t) => (
                  <li key={t.index} className="border-t border-hairline px-5 py-3 first:border-t-0">
                    <p className="text-[14px] text-ink">
                      <span className="num text-muted">#{t.index}</span> {t.method.replace(/_/g, " ")}
                    </p>
                    <p className="mt-0.5 break-words text-[13px] text-down">{t.error}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      )}
    </>
  );
}
