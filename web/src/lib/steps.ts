/** Plain-language copy for the five demo steps; the engine's act titles stay as they are in the receipt. */
export const STEPS: Record<number, { title: string; summary: string }> = {
  1: { title: "Agents fund themselves", summary: "The CFO agent brings USDC from Base and the consumer brings SOL, both through NEAR Intents. The treasury gives each agent a Function Call key and an on-chain spending policy." },
  2: { title: "A provider pre-sells GPU hours", summary: "The enclave attests the H100 index and throws out a spoofed feed. A Batam data center pre-sells capacity with 25% margin, and the LP agent quotes both sides." },
  3: { title: "The CFO agent hedges its runway", summary: "Its risk model says hedge. Its first price is too high and the contract refuses it. It re-plans inside the band and fills. A hijacked withdrawal is blocked by the key itself." },
  4: { title: "GPU prices spike from $2.80 to $4.10", summary: "Attestations push a short vault below 15% maintenance. The LP agent liquidates it. At maturity the CFO agent is paid 500 CU at $4.10 against a $2.81 entry." },
  5: { title: "Forwards are redeemed as compute", summary: "Three jobs run. One meets its SLA and the provider is paid. One is throttled and one is ignored, so both are slashed automatically: 100% back plus 15%." },
};
