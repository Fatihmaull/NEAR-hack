import { price } from "@/lib/format";

export interface CurvePoint {
  id: string;
  index: bigint;
  strike: bigint;
}

/**
 * The forward curve: attested index per maturity (solid, accent) against each series' strike
 * (dashed). It is the product's recurring motif, drawn from data, never as decoration.
 */
export function ForwardCurve({ points, tone = "light", height = 150, title }: { points: CurvePoint[]; tone?: "light" | "dark"; height?: number; title: string }) {
  const W = 420;
  const H = height;
  const padX = 34;
  const padTop = 26;
  const padBottom = 30;
  if (points.length === 0) return null;
  const values = points.flatMap((p) => [Number(p.index), Number(p.strike)]);
  const min = Math.min(...values) * 0.96;
  const max = Math.max(...values) * 1.04;
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => padTop + (1 - (v - min) / (max - min || 1)) * (H - padTop - padBottom);
  const path = (key: "index" | "strike") => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Number(p[key])).toFixed(1)}`).join(" ");
  const c =
    tone === "dark"
      ? { grid: "#2A2D33", strike: "#8B919C", line: "#7FA4FF", dot: "#7FA4FF", label: "#FFFFFF", axis: "#A8ACB3" }
      : { grid: "#EEF0F3", strike: "#8C929C", line: "#1652F0", dot: "#1652F0", label: "#0A0B0D", axis: "#5B616E" };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={title}>
      <title>{title}</title>
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={padX} x2={W - padX} y1={padTop + t * (H - padTop - padBottom)} y2={padTop + t * (H - padTop - padBottom)} stroke={c.grid} strokeWidth="1" />
      ))}
      <path d={path("strike")} fill="none" stroke={c.strike} strokeWidth="1.5" strokeDasharray="4 4" />
      <path d={path("index")} fill="none" stroke={c.line} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(Number(p.index))} r="4" fill={c.dot} />
          <text x={x(i)} y={y(Number(p.index)) - 10} textAnchor="middle" fill={c.label} style={{ font: "500 12px 'JetBrains Mono Variable', monospace" }}>
            {price(p.index).slice(0, 5)}
          </text>
          <text x={x(i)} y={H - 8} textAnchor="middle" fill={c.axis} style={{ font: "400 11.5px 'JetBrains Mono Variable', monospace" }}>
            {p.id.replace("CU-", "")}
          </text>
        </g>
      ))}
    </svg>
  );
}
