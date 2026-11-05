"use client";

import { LogOut, Wallet } from "lucide-react";
import { NEAR_NETWORK, useWallet } from "@/lib/wallet";

export function WalletButton() {
  const { accountId, connecting, connect, disconnect, error } = useWallet();
  if (accountId)
    return (
      <div className="flex items-center gap-2">
        <span className="hidden rounded-lg border border-near/40 bg-near/10 px-2.5 py-1.5 font-mono text-xs text-near sm:inline">{accountId}</span>
        <button type="button" className="btn-ghost px-2 py-1.5" onClick={() => disconnect()} title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    );
  return (
    <button type="button" className="btn-ghost py-1.5" onClick={() => connect()} disabled={connecting} title={error ?? `Connect a NEAR ${NEAR_NETWORK} wallet via NEAR Connect`}>
      <Wallet className="h-4 w-4" />
      {connecting ? "Connecting…" : `Connect ${NEAR_NETWORK}`}
    </button>
  );
}
