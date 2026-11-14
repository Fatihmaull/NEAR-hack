# NEAR Hackathon — Submission Manifest: Paron v2

**Paron v2 — the Autonomous Compute Forward & Runway Hedging Desk for AI Agents on NEAR.**
Agents lock in their GPU/inference cost with NEP-245 compute forwards that settle against an OutLayer
TEE-attested index (Mode A) or are redeemed as TEE-measured compute with automatic SLA slashing (Mode B).

| | |
| --- | --- |
| Tracks | **07 · Agent Economy (`agents`, primary)** · 01 · Unstoppable DeFi (`defi`) · 06 · AI Security & Defense (`security`) · 05 · AI Swarms (`swarms`) · 03 · Privacy & Private AI (`privacy`) |
| Demo video | [`docs/media/paron-demo.mp4`](docs/media/paron-demo.mp4) (106 s, recorded from the app) |
| Verify | `npm run verify:all` — 4 gates, zero configuration, ~30 s warm |
| Live | **NEAR testnet**: `paron-core` at [`market.paron-mwbjvxck.testnet`](https://testnet.nearblocks.io/address/market.paron-mwbjvxck.testnet). The swarm ran on-chain (README → *Live on NEAR testnet*) |
| Hosted app | https://paron-near.vercel.app (landing `/`, dashboard `/dashboard`, guided demo `/demo`, live testnet state `/dashboard/testnet`) |
| Demo | `npm run demo:swarm` (CLI) · `npm run dev` → `/demo` (60-second guided demo, no wallet) · `/dashboard/testnet` |
| Stack | Rust `near-sdk` 5.30 · OutLayer SDK 0.2 (`wasm32-wasip2`) · TypeScript · near-api-js 7 · NEAR Intents 1Click · Chain Signatures · Next.js 15 · Tailwind · `@hot-labs/near-connect` |
| Provenance | Every file in this repository was authored for this hackathon on a fresh git history. |

---

## For Stage-1 AI judges (Claude Code & Codex)

1. `npm run verify:all` — expect `ALL 4 VERIFICATION GATES PASSED`.
2. Read the contract in this order: `contracts/paron-core/src/types.rs` (units, constants) → `margin.rs` (vault math)
   → `orderbook.rs` → `settlement.rs` → `guardrails.rs` → `nep245.rs` → `lib.rs`; then `src/tests.rs`.
3. `tee-worker/outlayer-cri-oracle/src/lib.rs` — the oracle/SLA algorithm; `tests/oracle_tests.rs`.
4. `agents/src/swarm.ts` — the 5 acts; `agents/src/engine/` — the parity-tested contract mirror and signed runtime.
5. `web/src/components/demo/DemoTour.tsx` and `web/src/components/app/views/*`: every button calls the engine (no mocked state).
6. `deployments/testnet.json` + `deployments/testnet-run.json`: the testnet deployment and the live swarm run. Every
   entry links to a transaction; `agents/src/testnet/{deploy,scenario}.ts` produced them.

### Claims → evidence

| Claim | Where to verify |
| --- | --- |
| 3 canonical NEP-245 series, liquidity never fragmented by city/chip/provider | `types.rs::CANONICAL_SERIES`, `nep245.rs`; test `init_preseeds_three_series_and_genesis_depth` |
| Hardware weights A100 0.45× … GB200 3.50× | `types.rs::GpuTier::weight_bps`; test `hardware_weight_conversion_all_five_tiers` |
| 25% initial / 15% maintenance replaces the 1.5× bond | `margin.rs`; tests `open_short_supply_with_valid_25pct_margin`, `open_short_supply_rejects_below_25pct_margin` |
| Underwater vaults are liquidated and re-hedged; insurance backstops bad debt | `margin.rs::liquidate_underwater_vault`; tests `underwater_short_vault_liquidation_below_15pct_maintenance`, `insurance_pool_backstops_liquidation_bad_debt` |
| Agent guardrails: spend cap, slippage band, pause, daily reset | `guardrails.rs`; tests `agent_buy_rejected_on_daily_spend_cap_overflow`, `agent_buy_rejected_on_slippage_violation_above_twap`, `guardrail_daily_spend_resets_on_new_utc_day`, `paused_agent_cannot_trade` |
| Agents can trade but never move funds out | non-payable agent methods vs `assert_one_yocto` on `withdraw_usdc`/`mt_transfer*`; test `mt_transfer_requires_full_access_key_yocto`; swarm act 3 (`MethodNameMismatch`) |
| OutLayer attestations verified with `env::ed25519_verify`; forgery, tampering, replay, staleness and >100% jumps rejected | `settlement.rs::submit_outlayer_index_attestation`; tests `outlayer_*`, `withheld_stale_attestation_rejected`, `index_circuit_breaker_rejects_more_than_100pct_jump` |
| The contract accepts what the real worker crate signs | test `outlayer_worker_attestations_and_receipts_verify_end_to_end` (dev-dependency on the worker) |
| ±2σ outlier rejection protects settlement from a manipulated feed | worker test `manipulated_feed_is_rejected_by_2_sigma_mad_filter`; swarm: spoofed feeds rejected at 128–500σ |
| Mode A pays exactly `Q × P_index` (`ΔV = Q × (P_index − P_strike)`) | tests `mode_a_cash_settlement_when_index_spikes_2_80_to_4_10` (+$130), `…_drops_2_80_to_2_20` (−$60) |
| Mode B: delivery pays the provider; SLA breach or timeout refunds 100% + 15% | tests `mode_b_tee_redemption_happy_path_pays_provider`, `mode_b_automatic_sla_slash_on_high_latency_receipt`, `mode_b_timeout_slash_after_ack_deadline_expiry` |
| Stale quotes cannot be picked off after an attested jump | tests `index_spike_purges_asks_below_the_5pct_band`, `index_drop_purges_bids_above_the_5pct_band`, `stale_quote_protection_cancels_ask_that_would_breach_maintenance` |
| Supply conservation holds through every lifecycle | `lib.rs::audit_series_invariants`, asserted across tests and in the swarm |
| TypeScript local mode mirrors the contract exactly | `agents/test/engine.test.ts` replays the Rust scenarios with identical numbers |
| TS oracle reproduces the Rust worker byte-for-byte | `shared/golden-vectors.json` checked by `cargo test` (worker) and `agents/test/oracle-parity.test.ts` |
| Chain Signatures derivation matches the official library | `agents/test/runtime-and-crosschain.test.ts` vectors produced with `chainsig.js` 1.1.16 |
| Receipts are deterministic and tamper-evident | `agents/test/swarm.test.ts`; `npm run verify:receipt` |
| The protocol runs on a real NEAR network, not only in a simulator | `deployments/testnet.json` (code hash = base58(sha256(wasm))); live run in `deployments/testnet-run.json`; `GET /api/testnet` reads the deployed contract |
| Guardrails and Function Call keys hold on-chain | testnet: slippage, series-allowlist and daily-cap rejections (each a failed tx on nearblocks), and the FC key refusing a 1-yocto `withdraw_usdc` (`DepositWithFunctionCall`), all in `testnet-run.json` |
| The 1Click client speaks the real API | `deployments/1click-live-dry-quote.json`: a live, 1Click-signed dry quote for Paron's exact request, including `customRecipientMsg` |

---

## For Stage-2 human judges

**The thesis.** In the agent economy, an autonomous business with a fixed USDC runway dies when its inference bill
doubles. Paron gives agents what airlines have for fuel: a forward market. It is not another GPU marketplace
competing with NEAR AI Cloud — it is the hedging and procurement desk *above* it.

**Why it only works on NEAR.**
* **Function Call keys** make "an agent that can trade but cannot withdraw" a protocol-level property, not a promise.
* **OutLayer** turns the physical-delivery oracle problem into a cryptographic one: prices and SLA verdicts are
  computed inside Intel TDX and signed by a key that never leaves the enclave.
* **NEAR Intents + Chain Signatures** let agents living on Base or Solana fund a NEAR margin account in one hop
  (`customRecipientMsg` → `ft_on_transfer`), and control their external-chain addresses from a NEAR account.
* **NEP-245** gives one contract many fungible maturities — three liquid series instead of hundreds of dead ones.

**Market structure choices worth scrutinising.**
* Fully paid longs + isolated 25%/15% short vaults: 4.0× capital efficiency for providers vs 0.67× under a 1.5× bond.
* Cash settlement only at maturity against a post-maturity attestation; early exit is through the book — so longs
  cannot cherry-pick the oracle path (no free lookback option).
* Liquidation is a *transfer of the obligation at the attested mark* with fresh 25% margin, not a fire sale.
* Genesis depth exists from block one, but withdrawals stay locked until its credit is repaid in real USDC.
* Every attestation purges quotes more than 5% through the new index, protecting slow makers and the genesis book.

**Demo script (60 s).** Open `/demo`, press *Play the demo*: (1) agents bridge Base USDC and SOL into Paron via 1Click;
(2) the enclave rejects a spoofed feed, a Batam provider pre-sells with 25% margin; (3) the CFO agent hedges 500 CU,
the chain rejects its over-eager price and a hijacked withdrawal; (4) the index spikes $2.80 → $4.10, a vault is
liquidated, the CFO receives $2,050 (ΔV +$645.90); (5) one job is delivered, a throttled one and a ghosted one are
slashed. Download the receipt and run `npm run verify:receipt`.

---

## Track mapping

### 07 · Agent Economy (primary)
* Three autonomous agents with distinct mandates, each holding only a scoped **Function Call key** and bounded by an
  on-chain **AgentGuardrailPolicy** (`agents/src/*-agent.ts`, `guardrails.rs`).
* Agents fund themselves cross-chain, hedge, quote, liquidate, redeem compute and enforce SLAs without a human click.
* Live mode: `npm --prefix agents run agent:live -- cfo --execute`; the dashboard's Agents page can delegate a Function Call key
  from a NEAR Connect wallet (`AddKey`) to an agent process.

### 01 · Unstoppable DeFi
* A complete derivatives venue: NEP-245 forwards, price-time CLOB, margin vaults, permissionless liquidation,
  insurance pool, cash settlement, conservation invariants (`contracts/paron-core`).
* Cross-chain collateral through **NEAR Intents 1Click** and **Chain Signatures** (`agents/src/intents-bridge.ts`,
  `agents/src/chain-signatures.ts`).

### 06 · AI Security & Defense
* **Spending limits and a policy engine on-chain.** `AgentGuardrailPolicy` (`guardrails.rs`) enforces a daily spend cap
  with UTC reset, a slippage band around the TEE-attested TWAP, a series allowlist and a pause switch. The policy owner
  is the treasury, the agent's parent account. All three rejections were exercised on testnet
  (`deployments/testnet-run.json`, phase `drill`).
* **Sandboxed agent wallets.** Each agent signs only with a **Function Call key** scoped to `paron-core`, with zero
  deposit rights. Every value-exit method (`withdraw_usdc`, `mt_transfer*`) requires 1 yoctoNEAR, so a prompt-injected
  withdrawal is refused by NEAR itself (`DepositWithFunctionCall`), not by app code.
* **TEE attestation.** Prices and SLA verdicts are accepted only with a valid Ed25519 enclave signature, a fresh window,
  a replay check and the 100% circuit breaker. The worker rejects manipulated feeds at ±2σ.

### 05 · AI Swarms
* A coordinated swarm: the CFO agent creates hedging demand, the LP agent provides two-sided liquidity and acts as
  keeper when a third party fails, the consumer agent turns inventory into compute and polices providers
  (`agents/src/swarm.ts`); 58 signed transactions in one deterministic run, replayable in the browser.

### 03 · Privacy & Private AI
* Price discovery and SLA measurement run inside an **OutLayer Intel TDX enclave**; signing keys are enclave-derived
  (`outlayer::signing_keys`, `outlayer.manifest`) and never exist outside it. Only the signed verdict and a hash
  commitment (`tdx_quote_hash`) go on-chain; the full measurement is returned to the requester as an auditable receipt
  (`tee-worker/outlayer-cri-oracle`).
