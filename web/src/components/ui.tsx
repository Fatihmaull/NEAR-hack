"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink as ExternalIcon, X } from "lucide-react";

/** A titled work area. Titles are sentence case; the optional description says what the area is for. */
export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "",
  id,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={`panel flex min-w-0 flex-col ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[16px] font-semibold leading-6 text-ink">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-[13.5px] leading-5 text-body">{description}</p> : null}
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={`min-w-0 flex-1 p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "primary" | "up" | "down" | "warn";
const BADGE: Record<Tone, string> = {
  neutral: "bg-strong text-ink",
  primary: "bg-primary-soft text-primary",
  up: "bg-up-soft text-up",
  down: "bg-down-soft text-down",
  warn: "bg-warn-soft text-warn",
};

/** Status label. Always carries words, never colour alone. */
export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-5 ${BADGE[tone]} ${className}`}>{children}</span>;
}

const TEXT: Record<Tone, string> = { neutral: "text-ink", primary: "text-primary", up: "text-up", down: "text-down", warn: "text-warn" };

export function Stat({ label, value, sub, tone = "neutral", className = "" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[13px] text-body">{label}</div>
      <div className={`num mt-0.5 truncate text-[20px] font-medium leading-7 ${TEXT[tone]}`}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[12.5px] text-muted">{sub}</div> : null}
    </div>
  );
}

/** A hash or id: truncated in the middle, full value on hover, copy with visible confirmation. */
export function Hash({ value, head = 8, tail = 6, href, className = "" }: { value?: string; head?: number; tail?: number; href?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">None</span>;
  const shown = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  const copy = () =>
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => undefined);
  return (
    <span className={`inline-flex max-w-full items-center gap-1 font-mono text-[12.5px] text-body ${className}`}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={value} className="truncate text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
          {shown}
        </a>
      ) : (
        <span className="truncate" title={value}>
          {shown}
        </span>
      )}
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : `Copy ${value}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-strong hover:text-ink">
        {copied ? <Check className="h-3.5 w-3.5 text-up" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  );
}

export function ExternalLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`link inline-flex items-center gap-1 ${className}`}>
      {children}
      <ExternalIcon className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function Progress({ value, max, tone = "primary", label }: { value: number; max: number; tone?: "primary" | "up" | "warn" | "down"; label: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  const color = { primary: "bg-primary", up: "bg-up", warn: "bg-warn", down: "bg-down" }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 w-full overflow-hidden rounded-full bg-strong">
      <div className={`h-full rounded-full ${color} transition-[width] duration-500 ease-out-expo`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Single-choice switcher (radio semantics) for series, side and similar small sets. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-full bg-strong p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[36px] rounded-full px-3.5 text-[13.5px] font-medium transition-colors ${active ? "bg-canvas text-ink shadow-lift" : "text-body hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Loading row with words, never a bare spinner. */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-[14px] text-body">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-hairline border-t-primary" aria-hidden />
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-hairline-strong/60 px-5 py-8 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-[46ch] text-[14px] text-body">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, children, onRetry }: { title: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-panel border border-down/30 bg-down-soft px-5 py-4">
      <p className="text-[14.5px] font-semibold text-down">{title}</p>
      {children ? <p className="mt-1 text-[13.5px] text-ink">{children}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn-outline btn-sm mt-3">
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Accessible modal dialog: labelled, Escape closes, focus moves in and returns to the trigger,
 * Tab stays inside while open, background scroll is locked.
 */
export function Dialog({ open, onClose, title, description, children, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; size?: "md" | "lg" }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => (ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>("button, a[href]"))?.focus(), 20);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onKey]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade bg-ink/50" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`relative w-full animate-sheet-in rounded-t-card bg-canvas shadow-sheet sm:rounded-card ${size === "lg" ? "sm:max-w-[760px]" : "sm:max-w-[560px]"}`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div>
            <h2 id={titleId} className="text-[22px] font-normal leading-7 tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-[14.5px] text-body">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-body hover:bg-strong hover:text-ink">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto px-6 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
