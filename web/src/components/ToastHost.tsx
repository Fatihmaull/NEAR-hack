"use client";

import { useEffect } from "react";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { useDesk } from "@/lib/desk";
import { Hash } from "./ui";

export function ToastHost() {
  const { toast, dismissToast, busy } = useDesk();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, toast.kind === "error" ? 9000 : 6000);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {busy ? (
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-tee/40 bg-ink-900/95 px-3 py-2 text-[12.5px] text-tee shadow-panel">
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-tee" /> {busy}
        </div>
      ) : null}
      {toast ? (
        <div
          className={`pointer-events-auto animate-fade-in rounded-lg border bg-ink-900/95 p-3 shadow-panel ${toast.kind === "ok" ? "border-near/50" : toast.kind === "error" ? "border-danger/50" : "border-tee/50"}`}
        >
          <div className="flex items-start gap-2">
            {toast.kind === "ok" ? <CircleCheck className="mt-0.5 h-4 w-4 text-near" /> : toast.kind === "error" ? <CircleX className="mt-0.5 h-4 w-4 text-danger" /> : <Info className="mt-0.5 h-4 w-4 text-tee" />}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{toast.title}</div>
              {toast.detail ? <div className="mt-0.5 break-words text-[12px] text-fg-muted">{toast.detail}</div> : null}
              {toast.txHash ? (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-fg-dim">
                  signed tx <Hash value={toast.txHash} head={10} tail={6} />
                </div>
              ) : null}
            </div>
            <button type="button" onClick={dismissToast} className="text-fg-dim hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
