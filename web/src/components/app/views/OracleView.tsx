"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { parseEd25519PublicKey, verifyAttestation } from "@paron/agents";
import { useDesk } from "@/lib/desk";
import { price, readableError, toMicros, utc } from "@/lib/format";
import { Badge, EmptyState, Hash, Loading, Panel, Segmented } from "../../ui";
import { PageHeader, SimClock } from "../PageHeader";
import { SERIES, type SeriesId } from "./TradeView";

export function OracleView() {
  const { sim, snapshot, run, busy, version, ready } = useDesk();
  const [series, setSeries] = useState<SeriesId>("CU-2026-11");
  const [target, setTarget] = useState("3.05");
  const [spoofOn, setSpoofOn] = useState(true);
  const [spoof, setSpoof] = useState("9.80");
  const att = useMemo(() => sim?.latestAttestation(series), [sim, series, version]);
  const teeKey = snapshot?.protocol?.tee_signer_pubkey_hex as string | undefined;
  const verified = useMemo(() => (att && teeKey ? verifyAttestation(att, parseEd25519PublicKey(teeKey)) : false), [att, teeKey]);
  const s = (snapshot?.series ?? []).find((x: { series_id: string }) => x.series_id === series);
  const index = s ? BigInt(s.index_twap_usdc_micros) : 0n;
  const targetInvalid = !target || Number(target) <= 0;

  const attest = (t: string) =>
    run(
      "Running the enclave worker",
      (sim) => sim.attestCustom(series, Number(toMicros(t)), spoofOn ? Number(toMicros(spoof)) : null),
      (r) =>
        r.ok
          ? {
              kind: "ok",
              title: `Index ${price(toMicros(t))} verified on-chain`,
              detail: `${r.purged.length} stale quotes cancelled, ${r.flagged.length} vaults flagged below 15% maintenance. The LP agent re-quoted.`,
            }
          : { kind: "error", title: "Attestation rejected by the contract", detail: readableError(r.error) },
    );

  const lastBucket = att?.buckets[att.buckets.length - 1]?.bucket;
  const feeds = att ? att.observations.filter((o) => o.bucket === lastBucket) : [];

  return (
    <>
      <PageHeader
        title="Oracle"
        description="The CRI-H100 index is computed inside an OutLayer TEE from multi-chip spot feeds. Feeds more than 2σ from the median are dropped before the TWAP."
        actions={<SimClock ms={snapshot?.now_ms} />}
      />
      <div className="mb-5">
        <Segmented label="Maturity" value={series} onChange={setSeries} options={SERIES.map((x) => ({ value: x, label: x.replace("CU-", "") }))} />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          title={`Latest attestation, ${series}`}
          description={att ? `Window ends ${utc(att.observed_at_ms)} · ${att.buckets.length} TWAP buckets` : undefined}
          actions={
            att ? (
              verified ? (
                <Badge tone="up">
                  <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Signature verified in your browser
                </Badge>
              ) : (
                <Badge tone="down">
                  <CircleX className="h-3.5 w-3.5" aria-hidden /> Verification failed
                </Badge>
              )
            ) : null
          }
        >
          {!ready ? (
            <Loading>Starting the local engine…</Loading>
          ) : !att ? (
            <EmptyState title={`No attestation for ${series} yet`}>Submit one from the panel on the right to set this series&apos; index.</EmptyState>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
                <div>
                  <p className="text-[13px] text-body">Attested TWAP</p>
                  <p className="num text-[32px] leading-tight text-ink">{price(att.twap_micros)}</p>
                </div>
                <div>
                  <p className="text-[13px] text-body">On-chain index</p>
                  <p className="num text-[20px] text-ink">{price(index)}</p>
                </div>
                <div>
                  <p className="text-[13px] text-body">Feeds</p>
                  <p className="text-[15px] text-ink">
                    {att.accepted_count} accepted, <span className={att.rejected_count ? "text-down" : ""}>{att.rejected_count} rejected</span>
                  </p>
                </div>
              </div>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[14px]">
                  <caption className="sr-only">Spot feeds in the last TWAP bucket and the outlier verdict for each</caption>
                  <thead>
                    <tr className="text-[12.5px] text-body">
                      <th scope="col" className="pb-2 font-medium">Feed</th>
                      <th scope="col" className="pb-2 font-medium">Chip</th>
                      <th scope="col" className="pb-2 text-right font-medium">Raw $/GPU-h</th>
                      <th scope="col" className="pb-2 text-right font-medium">H100 equivalent</th>
                      <th scope="col" className="pb-2 text-right font-medium">Deviation</th>
                      <th scope="col" className="pb-2 text-right font-medium">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feeds.map((o) => (
                      <tr key={`${o.source}-${o.observed_at_ms}`} className="border-t border-hairline">
                        <td className={`max-w-[220px] truncate py-2.5 ${o.accepted ? "text-ink" : "text-down"}`}>{o.source}</td>
                        <td className="py-2.5 text-body">{o.gpu_tier}</td>
                        <td className="num py-2.5 text-right text-body">{price(o.raw_price_micros)}</td>
                        <td className="num py-2.5 text-right text-ink">{price(o.h100_equivalent_micros)}</td>
                        <td className={`num py-2.5 text-right ${o.deviation_sigma_milli > 2000 ? "text-down" : "text-body"}`}>{(o.deviation_sigma_milli / 1000).toFixed(1)}σ</td>
                        <td className="py-2.5 text-right">{o.accepted ? <Badge tone="up">Accepted</Badge> : <Badge tone="down">Rejected</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="group rounded-field bg-soft">
                <summary className="flex min-h-[44px] items-center justify-between px-4 text-[14px] font-medium text-ink">
                  Commitment and signature
                  <span className="text-[13px] font-normal text-body group-open:hidden">Show</span>
                  <span className="hidden text-[13px] font-normal text-body group-open:inline">Hide</span>
                </summary>
                <dl className="grid gap-2 px-4 pb-4 text-[13.5px] sm:grid-cols-[180px_minmax(0,1fr)]">
                  <dt className="text-body">TDX quote hash</dt>
                  <dd>
                    <Hash value={att.tdx_quote_hash} head={16} tail={8} />
                  </dd>
                  <dt className="text-body">Enclave measurement</dt>
                  <dd>
                    <Hash value={att.enclave_measurement_hex} head={16} tail={8} />
                  </dd>
                  <dt className="text-body">Ed25519 signature</dt>
                  <dd>
                    <Hash value={att.signature_hex} head={16} tail={8} />
                  </dd>
                  <dt className="text-body">Signer</dt>
                  <dd>
                    <Hash value={att.signer_public_key} head={16} tail={8} />
                  </dd>
                  <dt className="text-body">Signed message</dt>
                  <dd className="break-all font-mono text-[12.5px] text-ink">{att.signed_message}</dd>
                </dl>
              </details>
            </div>
          )}
        </Panel>

        <Panel title="Attest a new index" description="Run the worker on fresh feeds. The contract checks the signature, freshness, replay and a 100% circuit breaker.">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!targetInvalid) attest(target);
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="oracle-target" className="field-label">
                Honest feeds converge on ($/CU)
              </label>
              <input id="oracle-target" className="field num" inputMode="decimal" value={target} aria-invalid={targetInvalid} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))} />
              {targetInvalid ? <p className="mt-1 text-[12.5px] text-down">Enter a price above zero.</p> : null}
            </div>
            <div className="rounded-field bg-soft p-4">
              <label htmlFor="oracle-spoof-on" className="flex items-center gap-3 text-[14px] font-medium text-ink">
                <input id="oracle-spoof-on" type="checkbox" checked={spoofOn} onChange={(e) => setSpoofOn(e.target.checked)} className="h-5 w-5" />
                Include a manipulated feed
              </label>
              <label htmlFor="oracle-spoof" className="field-label mt-3">
                Manipulated price ($/CU)
              </label>
              <input id="oracle-spoof" className="field num" inputMode="decimal" value={spoof} disabled={!spoofOn} onChange={(e) => setSpoof(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div>
              <p className="field-label">Or move the index from {price(index)}</p>
              <div className="flex flex-wrap gap-2">
                {[1.09, 1.2, 1.32].map((m) => {
                  const t = ((Number(index) / 1e6) * m).toFixed(2);
                  return (
                    <button key={m} type="button" className="btn-outline btn-sm num" disabled={!ready || busy !== null} onClick={() => attest(t)}>
                      +{Math.round((m - 1) * 100)}% to ${t}
                    </button>
                  );
                })}
              </div>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={!ready || busy !== null || targetInvalid}>
              Attest and submit
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
