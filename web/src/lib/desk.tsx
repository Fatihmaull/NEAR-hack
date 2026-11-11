"use client";

/**
 * In-browser trading desk: boots the real Paron contract engine + agent swarm (Acts 1–3 of the coded
 * tour) and onboards the judge's own guardrailed agent. Every button in the terminal is a signed
 * transaction executed by the same engine the CLI and tests use — no mocked UI state.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SwarmSimulation, type LocalParonClient, type SwarmEvent } from "@paron/agents";

export const JUDGE_ACCOUNT = "judge.swarm-treasury.testnet";
export const JUDGE_METHODS = ["agent_buy_forward", "open_short_supply", "place_bid", "cancel_order", "sell_forward", "top_up_margin", "settle_cash_hedge"];

export interface Toast {
  kind: "ok" | "error" | "info";
  title: string;
  detail?: string;
  txHash?: string;
}

export type Snapshot = Record<string, any>;

interface DeskContextValue {
  ready: boolean;
  busy: string | null;
  version: number;
  sim: SwarmSimulation | null;
  judge: LocalParonClient | null;
  snapshot: Snapshot | null;
  events: SwarmEvent[];
  toast: Toast | null;
  dismissToast: () => void;
  notify: (toast: Toast) => void;
  run: <T>(label: string, fn: (sim: SwarmSimulation, judge: LocalParonClient) => Promise<T>, describe?: (result: T) => Toast) => Promise<T | undefined>;
}

const DeskContext = createContext<DeskContextValue | null>(null);

export function DeskProvider({ children }: { children: ReactNode }) {
  const simRef = useRef<SwarmSimulation | null>(null);
  const judgeRef = useRef<LocalParonClient | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>("Booting local NEAR runtime, OutLayer enclave mirror and agent swarm…");
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sim = await SwarmSimulation.create();
      for (const act of [1, 2, 3]) await sim.runAct(act);
      const judge = sim.onboardAgent(JUDGE_ACCOUNT, {
        fundingMicros: 5_000_000_000n,
        maxDailySpendMicros: 4_000_000_000n,
        slippageBps: 150,
        methods: JUDGE_METHODS,
      });
      if (!alive) return;
      simRef.current = sim;
      judgeRef.current = judge;
      setBusy(null);
      setVersion((v) => v + 1);
    })().catch((e) => setToast({ kind: "error", title: "Desk failed to boot", detail: String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(
    async <T,>(label: string, fn: (sim: SwarmSimulation, judge: LocalParonClient) => Promise<T>, describe?: (result: T) => Toast): Promise<T | undefined> => {
      const sim = simRef.current;
      const judge = judgeRef.current;
      if (!sim || !judge) return undefined;
      setBusy(label);
      try {
        const result = await fn(sim, judge);
        if (describe) setToast(describe(result));
        return result;
      } catch (e) {
        setToast({ kind: "error", title: `${label} failed`, detail: (e as Error).message });
        return undefined;
      } finally {
        setBusy(null);
        setVersion((v) => v + 1);
      }
    },
    [],
  );

  const snapshot = useMemo(() => (simRef.current ? (simRef.current.snapshot() as Snapshot) : null), [version]);
  const events = useMemo(() => (simRef.current ? [...simRef.current.events] : []), [version]);

  const value: DeskContextValue = {
    ready: simRef.current !== null,
    busy,
    version,
    sim: simRef.current,
    judge: judgeRef.current,
    snapshot,
    events,
    toast,
    dismissToast: () => setToast(null),
    notify: setToast,
    run,
  };
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): DeskContextValue {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk must be used inside <DeskProvider>");
  return ctx;
}
