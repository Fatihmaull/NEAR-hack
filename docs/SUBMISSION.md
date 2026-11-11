# Submission kit — Paron v2

Copy-paste material for the hackathon form and the demo video. Fields marked **TODO(owner)** need the team
(the hosted demo URL and the video link do not exist until you deploy or record them).

## Form fields

**Project name:** Paron v2

**Tagline (≤ 80 chars):** Compute forwards that let AI agents lock in their GPU bill on NEAR.

**Tracks:** 07 Agent Economy (primary) · 01 Unstoppable DeFi · 05 AI Swarms · 03 Privacy & Private AI

**Links**
* Repository: https://github.com/Fatihmaull/NEAR-hack
* Live contract (NEAR testnet): https://testnet.nearblocks.io/address/market.paron-mwbjvxck.testnet
* Hosted terminal + 60-second tour: **TODO(owner)**, the Vercel URL (see *Deploying the web app* below)
* Demo video: **TODO(owner)**

**Short description (≈ 50 words)**

AI agents run on fixed USDC budgets while GPU prices can double overnight. Paron is a forward market for
compute on NEAR. Agents buy NEP-245 compute forwards inside on-chain guardrails, with Function Call keys that can trade but
never withdraw. Forwards settle against an OutLayer TEE-attested GPU price index, or are redeemed as TEE-measured compute
with automatic SLA slashing.

**Long description**

*Problem.* An autonomous business that pays for inference has a runway problem. When the H100 hour moves from $2.80 to
$4.10, its burn rises 46% and nothing hedges it. Existing compute presale markets break in three ways:

* They demand 1.5× cash bonds from providers.
* They rely on humans to confirm "delivery".
* They split liquidity into city × chip × month micro-markets.

*Solution.* Paron v2 is the hedging and procurement desk above GPU clouds like NEAR AI Cloud.

* **One canonical unit.** 1 CU = 1 hour of H100 SXM. Every chip is normalised by weight, and only three liquid NEP-245
  maturities exist.
* **Margin instead of bonds.** Providers pre-sell capacity with 25% initial and 15% maintenance margin, 4× more
  capital-efficient than a 1.5× bond. Underwater vaults are liquidated permissionlessly and re-hedged at the attested
  mark, with an insurance pool behind them.
* **Mode A: cash settlement.** At maturity, longs receive Q × P_index against an OutLayer TEE-attested CRI-H100 TWAP.
  The enclave rejects manipulated feeds at ±2σ, and the contract checks the Ed25519 signature, freshness, replay and a
  100% circuit breaker.
* **Mode B: compute redemption.** Agents redeem CU for real jobs. The enclave measures TTFT and throughput and signs the
  verdict. An SLA breach or a missed deadline refunds 100% plus a 15% penalty, automatically.
* **Agents first.** Each agent holds only a Function Call key and is bounded by an on-chain AgentGuardrailPolicy:
  daily spend cap, slippage band around the attested TWAP, series allowlist, pause switch. Agents fund themselves from
  Base or Solana through NEAR Intents 1Click (`customRecipientMsg` → `ft_on_transfer`) and Chain Signatures.

*What is built.*

* A Rust contract with 39 tests.
* A Rust OutLayer worker (wasm32-wasip2) with 10 tests and golden vectors shared with TypeScript.
* Three TypeScript agents, a provider node and a 5-act swarm (19 tests).
* A Next.js 15 terminal with a 60-second coded judge tour.

`npm run verify:all` checks all of it in about 30 seconds with zero configuration. The contract is **deployed on NEAR
testnet** and the agent swarm ran against it: attestations, a 25%-margin pre-sale, a guardrail-checked hedge, an index
spike with a keeper liquidation, and Mode B delivery and slashing. Every step links to a nearblocks transaction.

*Why NEAR.* Function Call keys make "can trade, cannot withdraw" a protocol property. OutLayer turns the
physical-delivery oracle into a cryptographic one. Intents and Chain Signatures let agents on other chains fund NEAR
margin in one hop. NEP-245 gives one contract many fungible maturities.

**How to test (for judges)**
1. `npm run verify:all`: expect `ALL 4 VERIFICATION GATES PASSED`.
2. `npm run dev` → http://localhost:3000/tour → *Run*.
3. Open the *Live on NEAR testnet* panel on `/`, or the nearblocks links in the README.

## Demo video script (≈ 2:30)

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00 | Title card, then the terminal | "AI agents pay for inference with fixed budgets, but GPU prices can double overnight. Paron is a forward market where agents lock in compute cost on NEAR." |
| 0:15 | `/tour` → *Run*, act 1 | "Agents fund themselves from Base and Solana through NEAR Intents and Chain Signatures. The treasury gives each agent a Function Call key and an on-chain guardrail." |
| 0:35 | Act 2, the TEE attestation card | "The OutLayer enclave computes the GPU price index. It rejects a spoofed feed at 500 sigma and signs the result, and the contract verifies that signature. A Batam data center pre-sells capacity with just 25% margin." |
| 0:55 | Act 3 | "The CFO agent's VaR model says hedge. It proposes too high a price and the chain rejects it. It re-plans inside the band and fills. A prompt-injected withdrawal is blocked by the Function Call key itself." |
| 1:15 | Act 4 | "The index spikes from $2.80 to $4.10. A short vault falls under 15% maintenance, the LP agent liquidates and re-hedges it, and at maturity the CFO receives $2,050 for a cost of $1,404." |
| 1:35 | Act 5 | "Mode B: agents redeem forwards for real jobs. The enclave measures every job. A throttled job and a ghosted job are slashed automatically: 100% refund plus 15%." |
| 1:55 | `/` → *Live on NEAR testnet* panel, click 2–3 nearblocks links | "This isn't only a simulation. The same agents ran against the contract deployed on NEAR testnet, and every line here is a real transaction: attestations, the guardrail rejection, the liquidation and the SLA slash." |
| 2:15 | Terminal running `npm run verify:all` | "One command verifies everything: contract, enclave worker, agent swarm and web build. Paron: runway hedging for the agent economy, only on NEAR." |

Recording tips: use 1440×900 or larger, dark theme, browser zoom 90%, and start `npm run dev` before recording.

## Deploying the web app (Vercel)

1. Import `Fatihmaull/NEAR-hack` at https://vercel.com/new and set **Root Directory** to `web`. Vercel detects
   Next.js and installs the npm workspace from the repository root.
2. No environment variables are required. The terminal defaults to the testnet deployment in `deployments/testnet.json`.
   Optional variables:
   * `ONE_CLICK_JWT`: live 1Click quotes in `/api/intents/quote`.
   * `NEAR_RPC_URL`: a different testnet RPC for `/api/testnet`.
3. Deploy, then paste the URL into the form and into the README.
