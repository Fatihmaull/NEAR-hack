"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { BookOpenText, ChartNoAxesCombined, FileCheck2, Gauge, Landmark, PlayCircle, Radio, ScrollText, ShieldCheck, Users } from "lucide-react";
import { useDesk, JUDGE_ACCOUNT } from "@/lib/desk";
import { Wordmark } from "../site/Wordmark";
import { REPO_URL } from "../site/SiteHeader";
import { WalletButton } from "../WalletButton";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface Item {
  href: string;
  label: string;
  icon: Icon;
}

/** Destinations grouped by job; every item is a real page under /dashboard. */
export const NAV_GROUPS: Array<{ label: string; items: Item[] }> = [
  {
    label: "Desk",
    items: [
      { href: "/dashboard", label: "Overview", icon: Gauge },
      { href: "/dashboard/markets", label: "Markets", icon: ChartNoAxesCombined },
      { href: "/dashboard/trade", label: "Trade", icon: Landmark },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/dashboard/agents", label: "Agents", icon: Users },
      { href: "/dashboard/oracle", label: "Oracle", icon: ShieldCheck },
      { href: "/dashboard/settlement", label: "Settlement", icon: ScrollText },
    ],
  },
  {
    label: "Verify",
    items: [
      { href: "/dashboard/testnet", label: "Live testnet", icon: Radio },
      { href: "/dashboard/audit", label: "Audit receipt", icon: FileCheck2 },
    ],
  },
];

export function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { ready, snapshot } = useDesk();
  const free = snapshot?.balances?.[JUDGE_ACCOUNT]?.free_usdc_micros as string | undefined;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <Wordmark href="/" />
        <span className="rounded-full bg-strong px-2.5 py-0.5 text-[12px] font-medium text-body">Testnet beta</span>
      </div>

      <div className="mx-3 mt-4 rounded-field border border-hairline bg-canvas px-3 py-2.5">
        <p className="text-[12px] text-body">Desk agent, simulated engine</p>
        <p className="truncate font-mono text-[12.5px] text-ink" title={JUDGE_ACCOUNT}>
          {JUDGE_ACCOUNT}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">{ready && free ? `${(Number(free) / 1e6).toLocaleString("en-US", { style: "currency", currency: "USD" })} free margin` : "Starting the local engine…"}</p>
      </div>

      <nav aria-label="Dashboard" className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="mt-4 first:mt-0">
            <p className="px-3 pb-1 text-[12px] font-medium text-muted">{g.label}</p>
            <ul>
              {g.items.map((it) => {
                const active = isActive(pathname, it.href);
                const IconC = it.icon;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`group flex min-h-[40px] items-center gap-3 rounded-field px-3 text-[14.5px] transition-colors ${active ? "bg-canvas font-semibold text-ink shadow-lift ring-1 ring-hairline" : "text-body hover:bg-strong hover:text-ink"}`}
                    >
                      <IconC className={`h-[18px] w-[18px] shrink-0 ${active ? "text-primary" : "text-muted group-hover:text-ink"}`} strokeWidth={1.75} aria-hidden />
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-hairline px-3 py-3">
        <Link href="/demo" onClick={onNavigate} className="flex min-h-[40px] items-center gap-3 rounded-field px-3 text-[14.5px] text-body hover:bg-strong hover:text-ink">
          <PlayCircle className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden />
          60-second demo
        </Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex min-h-[40px] items-center gap-3 rounded-field px-3 text-[14.5px] text-body hover:bg-strong hover:text-ink">
          <BookOpenText className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden />
          Docs and source<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <div className="mt-2 px-1">
          <WalletButton />
        </div>
      </div>
    </div>
  );
}
