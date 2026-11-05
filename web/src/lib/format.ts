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

export const short = (s: string | undefined, head = 8, tail = 6): string => (!s ? "—" : s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

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
