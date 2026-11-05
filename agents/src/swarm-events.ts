/** Structured telemetry emitted by every agent action (consumed by the CLI tables and the web tour). */
export type SwarmEventKind =
  | "analysis"
  | "tx"
  | "guardrail"
  | "intent"
  | "chain-signature"
  | "attestation"
  | "liquidation"
  | "settlement"
  | "redemption"
  | "security"
  | "info";

export interface SwarmEvent {
  seq: number;
  act: number;
  t: number;
  actor: string;
  kind: SwarmEventKind;
  title: string;
  detail?: string;
  ok?: boolean;
  txHash?: string;
  method?: string;
  keyKind?: string;
  data?: unknown;
}

export type EmitFn = (event: Omit<SwarmEvent, "seq" | "act" | "t">) => void;
