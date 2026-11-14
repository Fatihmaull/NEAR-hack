import type { ReactNode } from "react";

/** Page title and the one decision this page supports. One h1 per page. */
export function PageHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-[70ch]">
        <h1 className="text-[2rem] font-normal leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        <p className="mt-2 text-[15.5px] leading-6 text-body">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The engine's clock: the desk replays a simulated November, so its time is labelled as such. */
export function SimClock({ ms }: { ms?: number }) {
  if (!ms) return null;
  return (
    <p className="text-[13px] text-body">
      Desk clock <span className="num text-ink">{new Date(ms).toISOString().replace("T", " ").slice(0, 16)} UTC</span> <span className="text-muted">(simulated)</span>
    </p>
  );
}
