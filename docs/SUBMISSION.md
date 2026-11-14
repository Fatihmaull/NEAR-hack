# Submission kit — Paron v2

Copy-paste material for the hackathon form and the X demo post. Fields marked **TODO(owner)** are decisions only the
team can make: personal details, the payout wallet and the post link.

## Official requirements (https://nearhackathon.com, checked 2026-11-14)

* **Deadline:** 2026-11-14 23:59 UTC. One submission per project; mistakes are fixed through
  https://nearhackathon.com/request-changes, never by submitting again.
* **Required:**
  * a public repository (✅ public, MIT `LICENSE`);
  * a public demo post on X that says it was built at NEAR HACKATHON, tags `@NEARProtocol` and `#NEARHackathon`, and
    attaches the video. A video is needed because judges cannot open a local-only demo (Q-012).
* **Judging:** Claude Code and Codex screen every project first ("does it run and do what the README says"), and human
  judges decide. The criteria are technical implementation, design, impact, originality and sustainability.
* **Hosted demo:** a plus. Keep it up until at least 2026-11-18, ideally 2026-11-25. ✅ https://paron-near.vercel.app

## Form fields (https://nearhackathon.com/#apply)

| Field | Value |
| --- | --- |
| Project name | Paron v2 |
| Team lead | **TODO(owner)** |
| Email | **TODO(owner)** |
| Team size | **TODO(owner)**: `1`, `2 - 4`, … |
| Tracks | `agents` (primary), `defi`, `security`, `swarms`, `privacy`. Add `business` if you want to. |
| NEAR wallet address | **TODO(owner)**: a *mainnet* account you control (e.g. `yourname.near`). Prizes are paid there |
| Repository link | https://github.com/Fatihmaull/NEAR-hack |
| Demo post link | **TODO(owner)**: the URL of your X post |
| Website | https://paron-near.vercel.app |
| Consent | tick the box |

**What did you build? (1903 / 2000 characters)**

Problem: AI agents run on fixed USDC budgets, but GPU prices can double overnight. Nothing lets an autonomous agent hedge its inference bill, and compute presale markets need 1.5x cash bonds, humans to confirm delivery, and fragmented city/chip/month markets.

Product: Paron is a forward market for compute on NEAR. 1 CU = 1 hour of H100, and other GPUs convert by weight, so there are only three liquid NEP-245 maturities. Providers pre-sell capacity with 25% margin (15% maintenance). Permissionless liquidation re-hedges at the attested mark, and an insurance pool backs it. Forwards settle in cash at maturity against an OutLayer TEE-attested GPU price index; spoofed feeds are rejected at 2 sigma, and the contract verifies the Ed25519 signature, freshness, replays and a 100% circuit breaker. Forwards can also be redeemed for real jobs: the enclave measures latency and throughput, and a breach or timeout refunds 100% + 15% automatically.

Agents: a CFO agent hedges its runway from a VaR model, an LP agent quotes and liquidates, and a consumer agent buys and redeems compute. Each holds only a NEAR Function Call key, which can trade but never withdraw, inside an on-chain guardrail: daily cap, slippage band and series allowlist. Agents on Base or Solana fund margin through NEAR Intents 1Click (customRecipientMsg into ft_on_transfer) and Chain Signatures.

How NEAR fits: Function Call keys make "can trade, cannot withdraw" a protocol rule. OutLayer turns the delivery oracle into cryptography. Intents and Chain Signatures give one-hop cross-chain funding, and NEP-245 gives one contract many fungible maturities.

Proof: deployed on NEAR testnet (market.paron-mwbjvxck.testnet) with 58 real transactions, among them attestations, guardrail rejections, a keeper liquidation and SLA slashes. `npm run verify:all` runs 4 gates with zero config; /demo replays the 5-step agent run in 60 seconds.

## X demo post (attach `docs/media/paron-demo.mp4`)

**Single post (278 / 280 characters, links count as 23):**

> AI agents pay for GPUs from fixed budgets. One price spike kills their runway.
>
> Built at NEAR HACKATHON: Paron lets agents lock in compute cost. Function Call keys trade but can't withdraw; OutLayer TEE slashes SLA breaches.
>
> github.com/Fatihmaull/NEAR-hack
> @NEARProtocol #NEARHackathon

**Longer version** (X Premium, or as a reply thread under the post above):

> AI agents pay for GPUs out of fixed budgets, and a single price spike can kill their runway.
>
> I built Paron at NEAR HACKATHON: a compute forward market where agents lock in their GPU cost.
>
> 🔒 Each agent gets a NEAR Function Call key. It can trade but can never withdraw, and on-chain guardrails reject bad orders.
> 🛡 OutLayer TEE attests the GPU price index and measures every job, so SLA breaches slash automatically.
> 🌉 Agents fund margin from Base/Solana via NEAR Intents.
>
> Live on testnet, 58 real txs: github.com/Fatihmaull/NEAR-hack
>
> What would you hedge first: inference, training, or storage?
>
> @NEARProtocol #NEARHackathon @NearBuilders @NearLegion

**How to test (for judges)**
1. `npm run verify:all`: expect `ALL 4 VERIFICATION GATES PASSED`.
2. https://paron-near.vercel.app/demo (or `npm run dev` → http://localhost:3000/demo) → *Play the demo*.
3. Open `/dashboard/testnet`, or the nearblocks links in the README.

## Demo video script (≈ 2:30)

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00 | Title card, then the terminal | "AI agents pay for inference with fixed budgets, but GPU prices can double overnight. Paron is a forward market where agents lock in compute cost on NEAR." |
| 0:15 | `/demo` → *Play the demo*, step 1 | "Agents fund themselves from Base and Solana through NEAR Intents and Chain Signatures. The treasury gives each agent a Function Call key and an on-chain guardrail." |
| 0:35 | Act 2, the TEE attestation card | "The OutLayer enclave computes the GPU price index. It rejects a spoofed feed at 500 sigma and signs the result, and the contract verifies that signature. A Batam data center pre-sells capacity with just 25% margin." |
| 0:55 | Act 3 | "The CFO agent's VaR model says hedge. It proposes too high a price and the chain rejects it. It re-plans inside the band and fills. A prompt-injected withdrawal is blocked by the Function Call key itself." |
| 1:15 | Act 4 | "The index spikes from $2.80 to $4.10. A short vault falls under 15% maintenance, the LP agent liquidates and re-hedges it, and at maturity the CFO receives $2,050 for a cost of $1,404." |
| 1:35 | Act 5 | "Mode B: agents redeem forwards for real jobs. The enclave measures every job. A throttled job and a ghosted job are slashed automatically: 100% refund plus 15%." |
| 1:55 | `/dashboard/testnet`, click 2–3 nearblocks links | "This isn't only a simulation. The same agents ran against the contract deployed on NEAR testnet, and every line here is a real transaction: attestations, the guardrail rejection, the liquidation and the SLA slash." |
| 2:15 | Terminal running `npm run verify:all` | "One command verifies everything: contract, enclave worker, agent swarm and web build. Paron: runway hedging for the agent economy, only on NEAR." |

Recording tips: use 1440×900 or larger, dark theme, browser zoom 90%, and start `npm run dev` before recording.

## Hosted demo and CD (live)

* **Production:** https://paron-near.vercel.app (Vercel project `paron-near`, Root Directory `web`, Node 22.x,
  public: Vercel Authentication off).
* **CD:** the Vercel GitHub integration is connected. Every push to `main` deploys to production and every PR gets a
  preview URL. GitHub Actions (`ci-cd`) runs the 4 verification gates on the same pushes.
* The optional Actions `deploy` job stays skipped because no `VERCEL_*` secrets are set. Leave it that way to avoid
  deploying twice. Use it only if you turn off the Git integration and want deployments gated on the verification run.
* Optional environment variables (Vercel → Project → Settings → Environment Variables):
  * `ONE_CLICK_JWT`: live 1Click quotes in `/api/intents/quote`.
  * `NEAR_RPC_URL`: a different testnet RPC for `/api/testnet`.
