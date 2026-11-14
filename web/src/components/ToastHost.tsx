"use client";

import { useEffect } from "react";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { useDesk } from "@/lib/desk";
import { Hash } from "./ui";

/** Result of every signed action: what happened, the contract's own message, and the tx. */
export function ToastHost() {
  const { toast, dismissToast, busy } = useDesk();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, toast.kind === "error" ? 10000 : 7000);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {busy ? (
        <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-panel border border-hairline bg-canvas px-4 py-3 text-[14px] text-ink shadow-sheet">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-hairline border-t-primary" aria-hidden />
          {busy}
        </div>
      ) : null}
      {toast ? (
        <div className="pointer-events-auto animate-sheet-in rounded-panel border border-hairline bg-canvas p-4 shadow-sheet" role={toast.kind === "error" ? "alert" : "status"}>
          <div className="flex items-start gap-3">
            {toast.kind === "ok" ? (
              <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-up" aria-hidden />
            ) : toast.kind === "error" ? (
              <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-down" aria-hidden />
            ) : (
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-[14.5px] font-semibold ${toast.kind === "error" ? "text-down" : "text-ink"}`}>{toast.title}</p>
              {toast.detail ? <p className="mt-0.5 break-words text-[13.5px] text-body">{toast.detail}</p> : null}
              {toast.txHash ? (
                <div className="mt-1.5 flex items-center gap-1 text-[12.5px] text-body">
                  Signed tx <Hash value={toast.txHash} head={10} tail={6} />
                </div>
              ) : null}
            </div>
            <button type="button" onClick={dismissToast} aria-label="Dismiss notification" className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-body hover:bg-strong hover:text-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
