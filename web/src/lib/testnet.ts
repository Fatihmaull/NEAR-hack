"use client";

import { useCallback, useEffect, useState } from "react";

export interface LiveEvent {
  phase: string;
  actor: string;
  kind: string;
  title: string;
  detail?: string;
  ok?: boolean;
  method?: string;
  keyKind?: string;
  txHash?: string;
  url?: string;
}

export interface SeriesView {
  series_id: string;
  label: string;
  maturity_timestamp_ms: number;
  initial_strike_usdc_micros: string;
  index_twap_usdc_micros: string;
  total_open_interest_cu: string;
  is_settled: boolean;
  last_tee_attestation_hash: string;
}

export interface TestnetState {
  live: boolean;
  error?: string;
  fetched_at?: number;
  accounts: Record<string, string>;
  contracts: Record<string, { account: string; wasm_sha256: string; code_hash?: string; bytes: number }>;
  tee_signer_public_key?: string;
  function_call_keys: Record<string, { public_key: string; method_names: string[] }>;
  guardrails: Record<string, { max_daily_spend_usdc: string; max_slippage_bps: number; allowed_series: string[] }>;
  deploy_txs: Array<{ step: string; label: string; hash: string; url: string }>;
  run: { updated_at: string; events: LiveEvent[] };
  stats?: Record<string, any>;
  series?: SeriesView[];
  books?: Record<string, { best_bid_micros: string | null; best_ask_micros: string | null }>;
  redemptions?: Array<Record<string, any>>;
  liquidations?: Array<Record<string, any>>;
}

export const EXPLORER = "https://testnet.nearblocks.io";
export const explorerAccount = (id: string) => `${EXPLORER}/address/${id}`;

/** Reads the deployed paron-core (via /api/testnet). Exposes loading and error states explicitly. */
export function useTestnet(refreshMs = 30_000) {
  const [state, setState] = useState<TestnetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/testnet", { cache: "no-store" });
      if (!res.ok) throw new Error(`The testnet API answered ${res.status}`);
      setState((await res.json()) as TestnetState);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  return { state, error, loading, reload: load };
}

export const onChainTxCount = (s: TestnetState | null) => (s ? s.run.events.filter((e) => e.txHash).length + s.deploy_txs.length : 0);
