"use client";

import type { ReactNode } from "react";
import { Copy } from "lucide-react";

export function Panel({ title, icon, right, children, className = "", bodyClassName = "" }: { title: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`}>
      <header className="panel-header">
        <h2 className="panel-title">
          {icon}
          {title}
        </h2>
        {right}
      </header>
      <div className={`min-w-0 flex-1 p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type Tone = "near" | "tee" | "intents" | "warn" | "danger" | "muted";
const TONES: Record<Tone, string> = {
  near: "border-near/40 bg-near/10 text-near",
  tee: "border-tee/40 bg-tee/10 text-tee",
  intents: "border-intents/40 bg-intents/10 text-intents",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
  muted: "border-ink-500 bg-ink-800 text-fg-muted",
};

export function Badge({ tone = "muted", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const color = tone ? TONES[tone].split(" ").find((c) => c.startsWith("text-")) : "text-fg";
  return (
    <div className="min-w-0 rounded-lg border border-ink-600/70 bg-ink-850 px-3 py-2">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`num truncate text-[15px] font-semibold ${color}`}>{value}</div>
      {sub ? <div className="truncate text-[11px] text-fg-muted">{sub}</div> : null}
    </div>
  );
}

export function Hash({ value, head = 10, tail = 6, className = "" }: { value?: string; head?: number; tail?: number; className?: string }) {
  if (!value) return <span className="text-fg-dim">—</span>;
  const shown = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return (
    <button
      type="button"
      title={`${value} (click to copy)`}
      onClick={() => navigator.clipboard?.writeText(value).catch(() => undefined)}
      className={`group inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-fg-muted hover:text-fg ${className}`}
    >
      <span className="truncate">{shown}</span>
      <Copy className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-70" />
    </button>
  );
}

export function Progress({ value, max, tone = "near" }: { value: number; max: number; tone?: "near" | "warn" | "danger" | "tee" }) {
  const pctValue = max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  const color = { near: "bg-near", warn: "bg-warn", danger: "bg-danger", tee: "bg-tee" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pctValue}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-ink-500 bg-ink-850 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 font-mono text-[11.5px] transition ${value === o.value ? "bg-ink-600 text-fg" : "text-fg-dim hover:text-fg-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
