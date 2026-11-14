"use client";

import Link from "next/link";
import { Dialog } from "../ui";

/**
 * The fork between the guided demo and the real desk. Opened from the landing page and on the
 * first visit to the dashboard. Both choices are links, so they work without JavaScript state.
 */
export function DemoChooser({ open, onClose, from = "site" }: { open: boolean; onClose: () => void; from?: "site" | "app" }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="How do you want to start?"
      description="Both run in your browser on the same signed contract engine. No wallet or sign-up needed."
    >
      <ul className="grid gap-3">
        <li>
          <Link href="/demo" data-autofocus onClick={onClose} className="group block rounded-panel border border-hairline p-5 transition-colors hover:border-primary hover:bg-primary-soft/40">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[17px] font-semibold text-ink">Watch the 60-second demo</span>
              <span className="num text-[13px] text-body">5 steps</span>
            </span>
            <span className="mt-1 block text-[14.5px] text-body">
              Agents fund themselves, hedge a GPU price spike, get liquidated and slashed. You get a receipt you can verify.
            </span>
          </Link>
        </li>
        <li>
          {from === "app" ? (
            <button type="button" onClick={onClose} className="group block w-full rounded-panel border border-hairline p-5 text-left transition-colors hover:border-ink/40 hover:bg-soft">
              <span className="text-[17px] font-semibold text-ink">Go to the dashboard</span>
              <span className="mt-1 block text-[14.5px] text-body">Trade, run agents, attest the index and redeem compute yourself.</span>
            </button>
          ) : (
            <Link href="/dashboard" onClick={onClose} className="group block rounded-panel border border-hairline p-5 transition-colors hover:border-ink/40 hover:bg-soft">
              <span className="text-[17px] font-semibold text-ink">Go to the dashboard</span>
              <span className="mt-1 block text-[14.5px] text-body">Trade, run agents, attest the index and redeem compute yourself.</span>
            </Link>
          )}
        </li>
      </ul>
    </Dialog>
  );
}
