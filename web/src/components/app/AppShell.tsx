"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { DeskProvider, useDesk } from "@/lib/desk";
import { DemoChooser } from "../site/DemoChooser";
import { Wordmark } from "../site/Wordmark";
import { ToastHost } from "../ToastHost";
import { Sidebar } from "./Sidebar";

const SEEN_KEY = "paron.dashboard.chooser-seen";

function MobileNav() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    const t = trigger.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      t?.focus();
    };
  }, [open]);
  return (
    <>
      <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-hairline bg-canvas/95 px-4 backdrop-blur lg:hidden">
        <Wordmark href="/" />
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="dashboard-menu"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 text-[14.5px] font-medium text-ink hover:bg-strong"
        >
          <Menu className="h-5 w-5" aria-hidden /> Menu
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Dashboard menu">
          <div className="absolute inset-0 animate-fade bg-ink/40" onClick={() => setOpen(false)} aria-hidden />
          <div id="dashboard-menu" ref={panel} className="absolute inset-y-0 left-0 w-[min(320px,86vw)] animate-slide-in-left bg-soft shadow-sheet">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full text-body hover:bg-strong hover:text-ink">
              <X className="h-5 w-5" aria-hidden />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function FirstVisitChooser() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* storage unavailable: skip the first-visit prompt */
    }
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };
  return <DemoChooser open={open} onClose={close} from="app" />;
}

function BootBanner() {
  const { ready, busy } = useDesk();
  if (ready) return null;
  return (
    <div role="status" className="border-b border-hairline bg-primary-soft px-4 py-2.5 text-[13.5px] text-ink sm:px-8">
      {busy ?? "Starting the local engine…"} This takes a few seconds, the first time only.
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <DeskProvider>
      <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-canvas focus:px-4 focus:py-2 focus:text-ink focus:shadow-sheet">
        Skip to content
      </a>
      <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen border-r border-hairline bg-soft lg:block">
          <Sidebar />
        </aside>
        <div className="min-w-0">
          <MobileNav />
          <BootBanner />
          <main id="app-main" className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-8 sm:px-8 lg:pt-10">
            {children}
          </main>
          <footer className="mx-auto w-full max-w-[1280px] px-4 sm:px-8">
            <p className="border-t border-hairline py-6 text-[13px] text-body">Testnet beta. The desk runs a simulated engine in your browser; test USDC has no value.</p>
          </footer>
        </div>
      </div>
      <ToastHost />
      <FirstVisitChooser />
    </DeskProvider>
  );
}
