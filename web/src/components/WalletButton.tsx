"use client";

import { LogOut, Wallet } from "lucide-react";
import { NEAR_NETWORK, useWallet } from "@/lib/wallet";

/** NEAR Connect wallet entry. Optional: the desk works without it; a wallet adds live testnet signing. */
export function WalletButton() {
  const { accountId, connecting, connect, disconnect, error } = useWallet();
  if (accountId)
    return (
      <div className="flex items-center gap-2 rounded-field border border-hairline bg-canvas py-1 pl-3 pr-1">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-body">NEAR {NEAR_NETWORK} wallet</p>
          <p className="truncate font-mono text-[12.5px] text-ink" title={accountId}>
            {accountId}
          </p>
        </div>
        <button type="button" className="grid h-10 w-10 place-items-center rounded-field text-body hover:bg-strong hover:text-ink" onClick={() => disconnect()} aria-label="Disconnect wallet">
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  return (
    <div>
      <button type="button" className="btn-outline btn-sm w-full" onClick={() => connect()} disabled={connecting}>
        <Wallet className="h-4 w-4" aria-hidden />
        {connecting ? "Opening wallet…" : `Connect ${NEAR_NETWORK} wallet`}
      </button>
      {error ? <p className="mt-1.5 text-[12px] text-down">{error}</p> : null}
    </div>
  );
}
