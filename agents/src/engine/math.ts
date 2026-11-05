/**
 * Protocol constants and fixed-point math — a 1:1 mirror of `types.rs` and the pure functions of
 * `margin.rs` in `contracts/paron-core`. All amounts use bigint with floor division (Rust u128 semantics).
 */
import type { GpuTier, ShortMarginVault, VaultHealth } from "./types";

export const CU_SCALE = 10_000n;
export const BPS = 10_000n;
export const USDC = 1_000_000n;

export const INITIAL_MARGIN_BPS = 2_500n;
export const MAINTENANCE_MARGIN_BPS = 1_500n;
export const SLA_BREACH_PENALTY_BPS = 1_500n;
export const LIQUIDATION_BONUS_BPS = 250n;
export const MAX_INDEX_MOVE_BPS = 10_000n;
export const STALE_QUOTE_BAND_BPS = 500n;
export const MAX_SLIPPAGE_BPS = 2_000;
export const MAX_ATTESTATION_AGE_MS = 60 * 60 * 1_000;
export const MAX_ATTESTATION_CLOCK_SKEW_MS = 5 * 60 * 1_000;
export const MS_PER_DAY = 86_400_000;
export const DEFAULT_ACK_WINDOW_MS = 15 * 60 * 1_000;
export const DEFAULT_DELIVERY_WINDOW_MS = 4 * 60 * 60 * 1_000;
export const DEFAULT_MAX_SLA_LATENCY_MS = 500;
export const MIN_ORDER_CU_SCALED = CU_SCALE;
export const MAX_PRICE_MICROS = 1_000n * USDC;
export const MAX_ORDERS_PER_SIDE = 64;
export const MAX_VAULTS_PER_SERIES = 48;

export const SERIES_2026_11 = "CU-2026-11";
export const SERIES_2026_12 = "CU-2026-12";
export const SERIES_2027_01 = "CU-2027-01";

export const CANONICAL_SERIES: ReadonlyArray<{ id: string; label: string; maturityMs: number; strike: bigint }> = [
  { id: SERIES_2026_11, label: "Front-month forward (Nov 2026)", maturityMs: 1_796_083_199_000, strike: 2_800_000n },
  { id: SERIES_2026_12, label: "Next-month forward (Dec 2026)", maturityMs: 1_798_761_599_000, strike: 2_950_000n },
  { id: SERIES_2027_01, label: "Quarter-out forward (Jan 2027)", maturityMs: 1_801_439_999_000, strike: 3_100_000n },
];

export const GENESIS_ASK_LEVELS: ReadonlyArray<[bigint, bigint]> = [
  [20_000n, 150n * CU_SCALE],
  [60_000n, 250n * CU_SCALE],
  [120_000n, 400n * CU_SCALE],
];
export const GENESIS_BID_LEVELS: ReadonlyArray<[bigint, bigint]> = [
  [40_000n, 150n * CU_SCALE],
  [80_000n, 250n * CU_SCALE],
  [140_000n, 400n * CU_SCALE],
];

export const GPU_TIERS: ReadonlyArray<GpuTier> = ["A100", "H100", "H200", "B200", "GB200"];

export const GPU_WEIGHT_BPS: Readonly<Record<GpuTier, bigint>> = {
  A100: 4_500n,
  H100: 10_000n,
  H200: 14_000n,
  B200: 25_000n,
  GB200: 35_000n,
};

export const GPU_LABELS: Readonly<Record<GpuTier, string>> = {
  A100: "NVIDIA A100 80GB",
  H100: "NVIDIA H100 SXM 80GB (base)",
  H200: "NVIDIA H200 141GB",
  B200: "NVIDIA B200 192GB",
  GB200: "NVIDIA GB200 NVL72",
};

export const hardwareToCuScaled = (tier: GpuTier, hoursScaled: bigint): bigint => (hoursScaled * GPU_WEIGHT_BPS[tier]) / BPS;
export const notional = (cuScaled: bigint, priceMicros: bigint): bigint => (cuScaled * priceMicros) / CU_SCALE;
export const applyBps = (amount: bigint, bps: bigint): bigint => (amount * bps) / BPS;
export const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
export const absDiff = (a: bigint, b: bigint): bigint => (a > b ? a - b : b - a);
export const saturatingSub = (a: bigint, b: bigint): bigint => (a > b ? a - b : 0n);
export const signedString = (gain: bigint, loss: bigint): string => (gain >= loss ? (gain - loss).toString() : `-${loss - gain}`);

// ---- vault math (margin.rs) ------------------------------------------------------------------

export const obligationAt = (v: ShortMarginVault, mark: bigint): bigint => notional(v.shorted_cu_scaled, mark);
export const unrealizedLoss = (v: ShortMarginVault, mark: bigint): bigint => saturatingSub(obligationAt(v, mark), v.escrowed_proceeds_micros);

export function vaultEquity(v: ShortMarginVault, mark: bigint): [bigint, bigint] {
  const loss = unrealizedLoss(v, mark);
  const c = v.locked_collateral_micros;
  return c >= loss ? [c - loss, 0n] : [0n, loss - c];
}

export function healthBps(v: ShortMarginVault, mark: bigint): bigint | null {
  const obligation = obligationAt(v, mark);
  if (v.shorted_cu_scaled === 0n || obligation === 0n) return null;
  return (vaultEquity(v, mark)[0] * BPS) / obligation;
}

export const requiredInitialMargin = (v: ShortMarginVault, mark: bigint): bigint =>
  applyBps(obligationAt(v, mark) + v.listed_notional_micros, INITIAL_MARGIN_BPS);
export const requiredMaintenanceMargin = (v: ShortMarginVault, mark: bigint): bigint =>
  applyBps(obligationAt(v, mark), MAINTENANCE_MARGIN_BPS);
export const meetsInitialMargin = (v: ShortMarginVault, mark: bigint): boolean => vaultEquity(v, mark)[0] >= requiredInitialMargin(v, mark);
export const meetsMaintenanceMargin = (v: ShortMarginVault, mark: bigint): boolean =>
  v.shorted_cu_scaled === 0n || vaultEquity(v, mark)[0] >= requiredMaintenanceMargin(v, mark);
export const isLiquidatable = (v: ShortMarginVault, mark: bigint): boolean =>
  v.status === "Active" && v.shorted_cu_scaled > 0n && !meetsMaintenanceMargin(v, mark);

export function liquidationPrice(v: ShortMarginVault): bigint | null {
  const q = v.shorted_cu_scaled;
  if (q === 0n) return null;
  const backing = v.locked_collateral_micros + v.escrowed_proceeds_micros;
  return (backing * CU_SCALE * BPS) / (q * (BPS + MAINTENANCE_MARGIN_BPS));
}

export function refreshEntryPrice(v: ShortMarginVault): void {
  v.entry_price_micros = v.shorted_cu_scaled === 0n ? 0n : (v.escrowed_proceeds_micros * CU_SCALE) / v.shorted_cu_scaled;
}

export function applyAskFill(v: ShortMarginVault, fill: bigint, price: bigint, askRemainingBefore: bigint, cost: bigint): void {
  v.shorted_cu_scaled += fill;
  v.escrowed_proceeds_micros += cost;
  v.listed_cu_scaled -= fill;
  v.listed_notional_micros -= notional(askRemainingBefore, price) - notional(askRemainingBefore - fill, price);
  refreshEntryPrice(v);
}

export function releaseListing(v: ShortMarginVault, remaining: bigint, price: bigint): void {
  v.listed_cu_scaled -= remaining;
  v.listed_notional_micros -= notional(remaining, price);
}

export function vaultHealth(v: ShortMarginVault, mark: bigint): VaultHealth {
  const [equity, deficit] = vaultEquity(v, mark);
  const requiredInitial = requiredInitialMargin(v, mark);
  const health = healthBps(v, mark);
  return {
    vault_id: v.vault_id,
    series_id: v.series_id,
    provider: v.provider,
    mark_price_micros: mark,
    open_notional_micros: obligationAt(v, mark),
    unrealized_loss_micros: unrealizedLoss(v, mark),
    equity_micros: equity,
    deficit_micros: deficit,
    health_bps: health === null ? null : Number(minBig(health, 4_294_967_295n)),
    required_initial_margin_micros: requiredInitial,
    required_maintenance_margin_micros: requiredMaintenanceMargin(v, mark),
    excess_collateral_micros: saturatingSub(equity, requiredInitial),
    liquidation_price_micros: liquidationPrice(v),
    is_liquidatable: isLiquidatable(v, mark),
  };
}

// ---- display helpers -------------------------------------------------------------------------

export function formatUsdc(micros: bigint, decimals = 2): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / USDC;
  const frac = abs % USDC;
  const fracStr = frac.toString().padStart(6, "0").slice(0, decimals);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${wholeStr}${decimals > 0 ? `.${fracStr}` : ""}`;
}

export function formatPrice(micros: bigint): string {
  return formatUsdc(micros, 4);
}

export function formatCu(scaled: bigint, decimals = 2): string {
  const whole = scaled / CU_SCALE;
  const frac = (scaled % CU_SCALE).toString().padStart(4, "0").slice(0, decimals);
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${decimals > 0 ? `.${frac}` : ""} CU`;
}

export const usdc = (units: number | bigint): bigint => BigInt(units) * USDC;
export const cu = (units: number | bigint): bigint => BigInt(units) * CU_SCALE;
/** Parse a decimal USD string like "2.8075" into micros. */
export function priceMicros(decimal: string): bigint {
  const [w, f = ""] = decimal.split(".");
  return BigInt(w) * USDC + BigInt((f + "000000").slice(0, 6));
}
