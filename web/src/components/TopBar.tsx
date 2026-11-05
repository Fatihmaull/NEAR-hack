"use client";

import Link from "next/link";
import { Clock, Cpu } from "lucide-react";
import { WalletButton } from "./WalletButton";
import { Badge } from "./ui";
import { PARON_CONTRACT_ID } from "@/lib/wallet";
import { utc } from "@/lib/format";

export function TopBar({ clockMs, active }: { clockMs?: number; active: "terminal" | "tour" }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-600/70 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-near/15 text-near ring-1 ring-near/40">
              <Cpu className="h-[18px] w-[18px]" />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-tight">
                PARON <span className="text-near">v2</span>
              </span>
              <span className="block text-[11px] text-fg-dim">Compute Forward &amp; Runway Hedging Desk · NEAR</span>
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            <Link href="/" className={`rounded-md px-3 py-1.5 text-sm ${active === "terminal" ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg"}`}>
              Terminal
            </Link>
            <Link href="/tour" className={`rounded-md px-3 py-1.5 text-sm ${active === "tour" ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg"}`}>
              60s Judge Tour
            </Link>
            <a href="/api/receipt" className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
              Audit receipt API
            </a>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PARON_CONTRACT_ID ? "near" : "tee"}>{PARON_CONTRACT_ID ? `testnet · ${PARON_CONTRACT_ID}` : "local signed runtime · deterministic"}</Badge>
          {clockMs ? (
            <Badge tone="muted">
              <Clock className="h-3 w-3" />
              <span className="num">{utc(clockMs)}</span>
            </Badge>
          ) : null}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
