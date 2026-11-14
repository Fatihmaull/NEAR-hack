const big = (v: string | bigint | number | null | undefined): bigint => {
  if (v === null || v === undefined || v === "") return 0n;
  return typeof v === "bigint" ? v : BigInt(v);
};

export function usd(micros: string | bigint | number | null | undefined, decimals = 2): string {
  const m = big(micros);
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const whole = (abs / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, decimals);
  return `${neg ? "-" : ""}$${whole}${decimals ? `.${frac}` : ""}`;
}

export const price = (micros: string | bigint | number | null | undefined): string => usd(micros, 4);

export function cu(scaled: string | bigint | number | null | undefined, decimals = 2): string {
  const s = big(scaled);
  const whole = (s / 10_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (s % 10_000n).toString().padStart(4, "0").slice(0, decimals);
  return `${whole}${decimals ? `.${frac}` : ""}`;
}

export const pct = (bps: number | null | undefined, digits = 1): string => (bps === null || bps === undefined ? "∞" : `${(bps / 100).toFixed(digits)}%`);

export const short = (s: string | undefined, head = 8, tail = 6): string => (!s ? "None" : s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

/**
 * Display copy for engine and testnet event strings. Those strings are part of the signed audit
 * receipt (changing them changes its hash), so dashes are normalised here, at display time only.
 */
const REASON: Record<string, string> = {
  tee_receipt_sla_violation: "SLA missed",
  latency_exceeds_sla_ceiling: "latency over the SLA",
  ack_deadline_missed: "acknowledgement deadline missed",
  delivery_deadline_missed: "delivery deadline missed",
};
export const slashReason = (r: string): string => REASON[r] ?? r.replace(/_/g, " ");

export const plain = (s?: string): string =>
  (s ?? "")
    .replace(/\s*—\s*/g, ": ")
    .replace(/: :/g, ":")
    .replace(/SlashedForSlaBreach\(([a-z_]+), payout (\$[\d,.]+)\)/g, (_m, r: string, p: string) => `slashed (${slashReason(r)}), ${p} paid to the agent`)
    .replace(/DeliveredViaTee\(latency (\d+) ms\)/g, "delivered in $1 ms")
    .replace(/sla_met=true/g, "SLA met")
    .replace(/sla_met=false/g, "SLA missed")
    .replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d{3})?Z/g, "$1 $2 UTC");

/** A Mode B redemption state, in words. */
export function redemptionLabel(state: Record<string, Record<string, unknown>>): { text: string; tone: "up" | "down" | "warn" } {
  const [name, body] = Object.entries(state)[0] ?? ["", {}];
  if (name === "DeliveredViaTee") return { text: `Delivered in ${String(body.latency_ms)} ms, provider paid`, tone: "up" };
  if (name === "SlashedForSlaBreach") return { text: `Slashed: ${slashReason(String(body.reason))}, ${usd(String(body.payout_micros))} refunded`, tone: "down" };
  if (name === "Acknowledged") return { text: "Acknowledged, job running", tone: "warn" };
  return { text: "Waiting for the provider", tone: "warn" };
}

/** The contract's panic text, restated in dollars ("max price 3500000 exceeds TWAP band ceiling 2842000"). */
export function readableError(detail?: string): string {
  if (!detail) return "The contract rejected the transaction.";
  const msg = detail.replace(/^.*Smart contract panicked:\s*/, "");
  const slip = /max price (\d+) exceeds TWAP band ceiling (\d+)/.exec(msg);
  if (slip) return `Max price ${price(slip[1])} is above the guardrail ceiling of ${price(slip[2])} (index plus 150 bps).`;
  const cap = /daily spend cap exceeded: (\d+) \+ (\d+) > (\d+)/.exec(msg);
  if (cap) return `Spent ${usd(cap[1], 0)} today. This order adds ${usd(cap[2], 0)} against a ${usd(cap[3], 0)} daily cap.`;
  if (/series not allowed/.test(msg)) return "This agent's policy does not allow that maturity.";
  return plain(msg.charAt(0).toUpperCase() + msg.slice(1));
}

export const utc = (ms: number): string => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
export const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Decimal USD string → micros. */
export function toMicros(v: string): bigint {
  const [w = "0", f = ""] = v.trim().replace(/^\$/, "").split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6) || "0");
}

/** Decimal CU string → scaled (1e4). */
export function toScaled(v: string): bigint {
  const [w = "0", f = ""] = v.trim().split(".");
  return BigInt(w || "0") * 10_000n + BigInt((f + "0000").slice(0, 4) || "0");
}

export const yoctoToNear = (y: string | bigint): string => (Number(big(y) / 10n ** 18n) / 1_000_000).toFixed(4);
