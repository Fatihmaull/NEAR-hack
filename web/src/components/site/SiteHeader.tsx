"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Wordmark } from "./Wordmark";

const NAV = [
  { href: "#markets", label: "Markets" },
  { href: "#settlement", label: "Settlement" },
  { href: "#safety", label: "Agent safety" },
  { href: "#proof", label: "Proof" },
];

export const REPO_URL = "https://github.com/Fatihmaull/NEAR-hack";

/** Top navigation over the dark hero. Every link targets a section that exists on the page. */
export function SiteHeader({ onDemo }: { onDemo: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="dark-band relative z-30 bg-night text-white">
      <div className="container-page flex h-[72px] items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Wordmark tone="white" />
          <span className="rounded-full border border-night-line px-2.5 py-0.5 text-[12px] font-medium text-night-soft">Testnet beta</span>
        </div>
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="rounded-full px-3.5 py-2 text-[14px] font-medium text-night-soft transition-colors hover:text-white">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <button type="button" onClick={onDemo} className="btn btn-sm text-white hover:bg-white/10">
            Watch demo
          </button>
          <Link href="/dashboard" className="btn-on-dark btn-sm">
            Open the desk
          </Link>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 text-[14px] font-medium text-white hover:bg-white/10 lg:hidden"
          aria-expanded={open}
          aria-controls="site-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          Menu
        </button>
      </div>
      {open ? (
        <div id="site-menu" className="border-t border-night-line lg:hidden">
          <nav aria-label="Primary mobile" className="container-page flex flex-col py-3">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex min-h-[48px] items-center text-[16px] text-white">
                {n.label}
              </a>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2 pb-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDemo();
                }}
                className="btn-outline-dark"
              >
                Watch demo
              </button>
              <Link href="/dashboard" className="btn-on-dark">
                Open the desk
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
