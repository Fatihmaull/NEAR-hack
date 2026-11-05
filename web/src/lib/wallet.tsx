"use client";

/**
 * NEAR wallet via @hot-labs/near-connect (manifest-based connector recommended by the NEAR hackathon
 * guide). Loaded lazily in the browser only. Live transactions are enabled when
 * NEXT_PUBLIC_PARON_CONTRACT_ID points at a deployed paron-core; otherwise the terminal stays in
 * zero-wallet local mode.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export const NEAR_NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet") as "mainnet" | "testnet";
export const PARON_CONTRACT_ID = process.env.NEXT_PUBLIC_PARON_CONTRACT_ID ?? "";
export const USDC_TOKEN_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID ?? "usdc.fakes.testnet";

export type ConnectorAction =
  | { type: "FunctionCall"; params: { methodName: string; args: object; gas: string; deposit: string } }
  | { type: "AddKey"; params: { publicKey: string; accessKey: { permission: { receiverId: string; allowance?: string; methodNames?: string[] } } } };

interface WalletApi {
  signAndSendTransaction(params: { receiverId: string; actions: ConnectorAction[] }): Promise<unknown>;
  signOut(): Promise<void>;
}

interface ConnectorApi {
  connect(): Promise<unknown>;
  wallet(): Promise<WalletApi>;
  on(event: string, cb: (payload: { accounts?: Array<{ accountId: string }> }) => void): void;
  getConnectedWallet(): Promise<{ accounts: Array<{ accountId: string }> }>;
}

interface WalletContextValue {
  accountId: string | null;
  connecting: boolean;
  liveEnabled: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (receiverId: string, actions: ConnectorAction[]) => Promise<unknown>;
  error: string | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const connectorRef = useRef<ConnectorApi | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<ConnectorApi> => {
    if (connectorRef.current) return connectorRef.current;
    const { NearConnector } = await import("@hot-labs/near-connect");
    const connector = new NearConnector({ network: NEAR_NETWORK, footerBranding: null }) as unknown as ConnectorApi;
    connector.on("wallet:signIn", (t) => setAccountId(t.accounts?.[0]?.accountId ?? null));
    connector.on("wallet:signOut", () => setAccountId(null));
    connectorRef.current = connector;
    return connector;
  }, []);

  useEffect(() => {
    // Restore an existing session silently (no popup).
    load()
      .then((c) => c.getConnectedWallet())
      .then((w) => setAccountId(w?.accounts?.[0]?.accountId ?? null))
      .catch(() => undefined);
  }, [load]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const c = await load();
      await c.connect();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }, [load]);

  const disconnect = useCallback(async () => {
    const c = await load();
    const w = await c.wallet();
    await w.signOut();
    setAccountId(null);
  }, [load]);

  const send = useCallback(
    async (receiverId: string, actions: ConnectorAction[]) => {
      const c = await load();
      const w = await c.wallet();
      return w.signAndSendTransaction({ receiverId, actions });
    },
    [load],
  );

  return (
    <WalletContext.Provider value={{ accountId, connecting, liveEnabled: Boolean(PARON_CONTRACT_ID), connect, disconnect, send, error }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

export const functionCall = (methodName: string, args: object, deposit = "0", gas = "100000000000000"): ConnectorAction => ({
  type: "FunctionCall",
  params: { methodName, args, gas, deposit },
});
