"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, Cpu, Satellite, ShieldX } from "lucide-react";
import { parseEd25519PublicKey, verifyAttestation } from "@paron/agents";
import { useDesk } from "@/lib/desk";
import { price, toMicros, utc } from "@/lib/format";
import { Badge, Hash, Panel, Segmented } from "./ui";

const SERIES = ["CU-2026-11", "CU-2026-12", "CU-2027-01"] as const;

export function TeeAttestationCard() {
  const { sim, snapshot, run, busy, version } = useDesk();
  const [series, setSeries] = useState<(typeof SERIES)[number]>("CU-2026-11");
  const [target, setTarget] = useState("3.05");
  const [spoofOn, setSpoofOn] = useState(true);
  const [spoof, setSpoof] = useState("9.80");
  const att = useMemo(() => sim?.latestAttestation(series), [sim, series, version]);
  const teeKey = snapshot?.protocol?.tee_signer_pubkey_hex as string | undefined;
  const verified = useMemo(() => (att && teeKey ? verifyAttestation(att, parseEd25519PublicKey(teeKey)) : false), [att, teeKey]);
  const s = (snapshot?.series ?? []).find((x: { series_id: string }) => x.series_id === series);
  const index = s ? BigInt(s.index_twap_usdc_micros) : 0n;

  const attest = (t: string) =>
    run(
      "OutLayer attestation",
      (sim) => sim.attestCustom(series, Number(toMicros(t)), spoofOn ? Number(toMicros(spoof)) : null),
      (r) =>
        r.ok
          ? { kind: "ok", title: `OutLayer TWAP ${price(toMicros(t))} verified on-chain`, detail: `purged ${r.purged.length} stale quotes · flagged ${r.flagged.length} vaults · LP agent re-centered` }
          : { kind: "error", title: "Attestation rejected", detail: r.error },
    );

  return (
    <Panel title="OutLayer TEE Attestation" icon={<Cpu className="h-4 w-4 text-tee" />} right={<Segmented value={series} options={SERIES.map((x) => ({ value: x, label: x.slice(3) }))} onChange={setSeries} />}>
      {att ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-fg-dim">CRI-H100 TWAP · {att.series_id}</div>
              <div className="num text-2xl font-semibold text-tee">{price(att.twap_micros)}</div>
              <div className="text-[11px] text-fg-dim">window ends {utc(att.observed_at_ms)} · {att.buckets.length} TWAP buckets · on-chain index {price(index)}</div>
            </div>
            {verified ? (
              <Badge tone="near">
                <BadgeCheck className="h-3.5 w-3.5" /> quote hash + Ed25519 verified in-browser
              </Badge>
            ) : (
              <Badge tone="danger">
                <ShieldX className="h-3.5 w-3.5" /> verification failed
              </Badge>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-ink-600/70">
            <table className="w-full text-[11.5px]">
              <thead className="bg-ink-850 text-[10px] uppercase tracking-wider text-fg-dim">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">feed</th>
                  <th className="px-2 py-1.5 text-left font-medium">tier</th>
                  <th className="px-2 py-1.5 text-right font-medium">raw $/GPU-h</th>
                  <th className="px-2 py-1.5 text-right font-medium">H100-eq</th>
                  <th className="px-2 py-1.5 text-right font-medium">|Δ|/σ</th>
                  <th className="px-2 py-1.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="font-mono">
                {att.observations
                  .filter((o) => o.bucket === att.buckets[att.buckets.length - 1]?.bucket)
                  .map((o) => (
                    <tr key={`${o.source}-${o.observed_at_ms}`} className={`border-t border-ink-700 ${o.accepted ? "" : "bg-danger/[0.07]"}`}>
                      <td className={`max-w-[150px] truncate px-2 py-1 ${o.accepted ? "text-fg-muted" : "text-danger line-through"}`}>{o.source}</td>
                      <td className="px-2 py-1 text-fg-dim">{o.gpu_tier}</td>
                      <td className="px-2 py-1 text-right text-fg-muted">{price(o.raw_price_micros)}</td>
                      <td className="px-2 py-1 text-right">{price(o.h100_equivalent_micros)}</td>
                      <td className={`px-2 py-1 text-right ${o.deviation_sigma_milli > 2000 ? "text-danger" : "text-fg-muted"}`}>{(o.deviation_sigma_milli / 1000).toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{o.accepted ? <span className="text-near">✓</span> : <Badge tone="danger">±2σ reject</Badge>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-1.5 rounded-lg border border-ink-600/70 bg-ink-850 p-2.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-dim">tdx_quote_hash</span>
              <Hash value={att.tdx_quote_hash} head={16} tail={8} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-dim">enclave measurement</span>
              <Hash value={att.enclave_measurement_hex} head={16} tail={8} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-dim">Ed25519 signature</span>
              <Hash value={att.signature_hex} head={16} tail={8} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-dim">enclave signer</span>
              <Hash value={att.signer_public_key} head={16} tail={8} />
            </div>
            <div className="mt-1 break-all rounded bg-ink-900 px-2 py-1 font-mono text-[10.5px] text-fg-muted">signed: &quot;{att.signed_message}&quot;</div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-ink-500 p-4 text-sm text-fg-muted">No OutLayer attestation for {series} yet — submit one below.</div>
      )}

      <div className="mt-3 rounded-lg border border-tee/30 bg-tee/[0.05] p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-tee">
          <Satellite className="h-3.5 w-3.5" /> Run the enclave worker on new spot feeds
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label>
            <span className="label">Honest feeds converge on ($/CU)</span>
            <input className="input" value={target} inputMode="decimal" onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <label>
            <span className="label">Manipulated feed</span>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={spoofOn} onChange={(e) => setSpoofOn(e.target.checked)} className="h-4 w-4 accent-[#ff5d73]" />
              <input className="input w-24" value={spoof} disabled={!spoofOn} onChange={(e) => setSpoof(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1.09, 1.2, 1.32].map((m) => {
            const t = ((Number(index) / 1e6) * m).toFixed(2);
            return (
              <button key={m} type="button" className="btn-ghost py-1.5 font-mono text-xs" disabled={busy !== null || !sim} onClick={() => attest(t)}>
                +{Math.round((m - 1) * 100)}% → ${t}
              </button>
            );
          })}
          <button type="button" className="btn-primary flex-1 py-1.5" disabled={busy !== null || !sim || !target} onClick={() => attest(target)}>
            Attest &amp; submit (+24h window)
          </button>
        </div>
        <p className="mt-2 text-[11px] text-fg-dim">
          The TS mirror of the Rust enclave worker produces byte-identical quote hashes and signatures (golden vectors). The contract verifies the Ed25519 signature,
          rejects replays/stale windows/&gt;100% jumps, purges quotes outside the ±5% band and flags vaults below 15% — then the LP agent tops up, liquidates and re-quotes.
        </p>
      </div>
    </Panel>
  );
}
