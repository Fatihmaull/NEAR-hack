# Paron v2 — Autonomous Compute Forward & Runway Hedging Desk for AI Agents on NEAR

> AI agents pay for inference in a market where GPU prices can spike 2–5× overnight. Paron v2 lets an
> autonomous agent **lock in its compute cost in advance** — trustlessly, on NEAR — with NEP-245 compute
> forwards that settle against an **OutLayer TEE-attested price index** or are redeemed as **attested
> compute**, funded cross-chain through **NEAR Intents** and **Chain Signatures**, and traded only inside
> on-chain **guardrails** enforced by **NEAR Function Call keys**.

## ⚡ One-command verification (Stage-1 AI judges start here)

```bash
npm run verify:all
```

Zero configuration — no wallet, no API keys, no `.env`. Requirements: Rust stable (tested 1.97) and Node.js ≥ 20.
The first run installs packages and compiles `near-sdk` (~2–3 min); afterwards the full pipeline takes **~30 s**.

| Gate | Command (run by `scripts/verify-all.sh`) | What it proves |
| --- | --- | --- |
| 1 | `cargo test` for `contracts/paron-core` and `contracts/test-usdc` | **39** contract unit/scenario tests (+3 for the testnet token) in near-sdk's mocked VM: NEP-245, hardware weights, 25%/15% margin, liquidation + insurance, CLOB + stale-quote protection, guardrails, OutLayer Ed25519 verification (forgery, tamper, replay, staleness, circuit breaker), Mode A spike/drop, Mode B delivery / auto-slash / timeout slash, and an end-to-end test where the contract verifies attestations produced by the real worker crate |
| 2 | `cargo test --manifest-path tee-worker/outlayer-cri-oracle/Cargo.toml` | **10** worker tests: multi-tier normalisation, ±2σ MAD outlier rejection, VWAP→TWAP, quorum rule, quote-hash binding, Ed25519 attestations, SLA verdicts, committed golden vectors |
| 3 | `npm --prefix agents run typecheck && npm --prefix agents test && npm --prefix agents run demo:swarm && npm --prefix agents run verify:receipt` | strict TS typecheck, **19** agent tests (engine parity with the Rust numbers, access-key rules, chainsig.js-compatible MPC derivation, 1Click client, swarm determinism + tamper detection), the 5-act swarm with self-checks, and independent receipt verification |
| 4 | `npm --prefix web run build` | Next.js 15 production build with type-checking |

Expected tail of the output:

```text
✔ Swarm simulation complete — all protocol outcomes and cryptographic checks verified.
...
ALL 4 VERIFICATION GATES PASSED  (31s total)
```

### See it in 60 seconds

🌐 **Hosted demo:** https://paron-near.vercel.app (no wallet needed). The tour is at https://paron-near.vercel.app/tour.
🎬 **Demo video (101 s):** [`docs/media/paron-demo.mp4`](docs/media/paron-demo.mp4)

```bash
npm run demo:swarm   # CLI: 5 acts, 58 Ed25519-signed txs, 8 OutLayer attestations, audit receipt
npm run dev          # http://localhost:3000/tour — the 60-second coded judge tour (no wallet needed)
```

The tour runs the **same engine in your browser** and produces a receipt whose `receipt_sha256`
(`b0b1ce8f…22fa785`) is byte-identical to the CLI and to `GET /api/receipt`. `npm run verify:receipt`
re-verifies every transaction signature, every TDX quote hash and every enclave signature in it.

### Try it: do X → see Y

Open https://paron-near.vercel.app, or run `npm run dev` and open http://localhost:3000.

| Do | See |
| --- | --- |
| Open `/tour` and press **Run** | 5 acts play in about 60 s. The final panel shows a receipt hash `b0b1ce8f…22fa785` and offers **Download receipt** |
| `npm run verify:receipt` | every signature and TDX quote hash in the receipt re-verifies (`✔`) |
| On `/`, **Order Book Desk**: set a buy limit above the shown *Guardrail ceiling*, then sign | a red toast reads "Rejected on-chain", with the contract's `slippage guard` message |
| Same panel: set a limit inside the ceiling and sign | a green toast "Bought … CU @ …" with the fill count, and the signed tx under *Latest signed order transactions* |
| **OutLayer TEE Attestation** card: keep the manipulated feed on, press **+32%** | the toast reads "OutLayer TWAP … verified on-chain · purged N stale quotes · flagged M vaults". The feed table marks the spoofed feed as rejected, and the badge reads "quote hash + Ed25519 verified in-browser" |
| **Settlement & Redemption**: press the happy, throttled and ghosted job buttons | the provider is paid; then "slashed — agent refunded 100% + 15%" twice |
| **Live on NEAR testnet** panel (or the links below) | the same flows as real testnet transactions on nearblocks |

> **Big picture:** every feature and flow, with diagrams, is in [`docs/FEATURES.md`](docs/FEATURES.md). Submission material is in [`docs/SUBMISSION.md`](docs/SUBMISSION.md).

### 🛰 Live on NEAR testnet

Paron v2 is deployed on NEAR testnet, and the agent swarm has run against it. Every link below opens a real transaction on
[nearblocks](https://testnet.nearblocks.io). The full public record (accounts, code hashes and every transaction) is in
[`deployments/testnet.json`](deployments/testnet.json) and [`deployments/testnet-run.json`](deployments/testnet-run.json).
The web terminal shows the same state live, read straight from RPC (`GET /api/testnet`, panel *Live on NEAR testnet*).

| Role | Account | Notes |
| --- | --- | --- |
| `paron-core` | [`market.paron-mwbjvxck.testnet`](https://testnet.nearblocks.io/address/market.paron-mwbjvxck.testnet) | code hash `7YVNadNp…qEdRvQDCebrr1oonMFj6mk` = base58(sha256(`cargo near build` wasm)) |
| test USDC (NEP-141, 6 dp, **no value**) | [`usdc.paron-mwbjvxck.testnet`](https://testnet.nearblocks.io/address/usdc.paron-mwbjvxck.testnet) | `contracts/test-usdc`; public `faucet(amount)` up to 100,000 tUSDC |
| Protocol owner | `paron-mwbjvxck.testnet` | repaid the genesis credit and seeded the insurance pool |
| OutLayer relayer | `relayer.paron-mwbjvxck.testnet` | Function Call key restricted to `submit_outlayer_index_attestation`, `finalize_series_settlement` |
| Swarm treasury | `swarm-mwbjvxck.testnet` | parent account of the agents, owner of their guardrails |
| CFO / LP / consumer agents | `cfo.` / `mm.` / `consumer.swarm-mwbjvxck.testnet` | each signs with its own Function Call key that cannot attach a deposit |
| Compute provider | `batam-mwbjvxck.testnet` | pre-sells capacity with 25% margin, acknowledges Mode B jobs |

What happened on-chain (selected; 30 deploy and 28 swarm transactions in total):

| Step | Transaction |
| --- | --- |
| `paron_core.new(...)`: registers the OutLayer signer and seeds 3 NEP-245 series with genesis depth | [`GyhPkNRQ…`](https://testnet.nearblocks.io/txns/GyhPkNRQ9tnfWwTKESNYE8TzVjJLScrNRLuC8kND7L4S) |
| Genesis liquidity credit (14,112 USDC) repaid through `ft_transfer_call`, which unlocks withdrawals | [`7hXqe6mG…`](https://testnet.nearblocks.io/txns/7hXqe6mG6MBBsHZ1AwvUygG7qkHM76jFkmjZVmfJtzhv) |
| Treasury registers the CFO agent's guardrail: 2,500 USDC/day, 150 bps | [`6nCwJK6z…`](https://testnet.nearblocks.io/txns/6nCwJK6ziyM2AYFUNG6ADAsX83Pa7VKPPvvo8AZTs7ck) |
| CFO agent installs a Function Call key for 7 `paron-core` methods | [`FGFRkXp6…`](https://testnet.nearblocks.io/txns/FGFRkXp6GtJuvkyLN4GrBsanYYUw5D8D1nmmZgKX6pNb) |
| Attested CRI-H100 baseline $2.80: spoofed $9.80 feed rejected at 500σ, Ed25519 signature verified on-chain | [`5yU9dDLZ…`](https://testnet.nearblocks.io/txns/5yU9dDLZvj4nGgrvHm2Cj5yX1HaSNHhgCJ7oYywLfitX) |
| Provider pre-sells 300 CU @ $2.81 with $210.75 margin (25%) | [`5ZRNJEwD…`](https://testnet.nearblocks.io/txns/5ZRNJEwD9SMS7QsBsfSWK9ENVp5YfYQvox9BYqEzyH7B) |
| CFO agent hedges 500 CU @ VWAP $2.8082, after the chain rejected its $2.898 proposal (slippage guard) | [`9CiV23Tf…`](https://testnet.nearblocks.io/txns/9CiV23TfF7QQkV25LThSfwz9RbovhQQGgL1VhZHB7cfg) |
| Attested spike to $3.70 flags vault #4 below 15% maintenance | [`3oQQ8NQA…`](https://testnet.nearblocks.io/txns/3oQQ8NQA81wUoWLNVyrfGxVsdmssiB7GMiVfBsr14YoL) |
| LP agent liquidates vault #4 (keeper role) and re-hedges 200 CU at the $3.70 mark | [`6H21mHgM…`](https://testnet.nearblocks.io/txns/6H21mHgMrzdzvQyXPt5U5yoxbS2gU8KM162L9ir1z5vQ) |
| LP agent's own daily spend cap rejects its next quote (5,000 USDC/day guardrail) | [`Gu7JG5pB…`](https://testnet.nearblocks.io/txns/Gu7JG5pB9UVQ8c74hvwE5Gs7zoxoBL2hquVYS53yuZUR) |
| Mode B job #1 delivered: TDX receipt, 180 ms TTFT, provider paid | [`3gbRxXLm…`](https://testnet.nearblocks.io/txns/3gbRxXLm2usJ7XrF7rTg9D23gS9BDFRbmK6Xzg7ivZe1) |
| Mode B job #2 throttled: receipt says `sla_met=false`, so the provider is slashed automatically (100% refund + 15%) | [`8aNjZJ9w…`](https://testnet.nearblocks.io/txns/8aNjZJ9w76cN6jkQKsEKKJT3dgZbMDy74AVaYiK82zcH) |
| Mode B job #3 ghosted: after the 15-minute ack window anyone can slash it (`claim_sla_breach_slash`) | [`HxU7xYjq…`](https://testnet.nearblocks.io/txns/HxU7xYjqbhocJT6NWaw3kXedLfgkDBJZWB2nRX73UYcN) |
| Guardrail drill: the CFO bids +4% over the TWAP, which is rejected by the slippage band | [`Cfa53HC7…`](https://testnet.nearblocks.io/txns/Cfa53HC73c8cQkaECBnSCioj3YnBFY2pWComcYXyTnEQ) |
| Guardrail drill: the consumer tries a series outside its allowlist and is rejected | [`vCJM3k6E…`](https://testnet.nearblocks.io/txns/vCJM3k6EuedW8pgDvsKExPx3tgAvXJWAj4ApsaFPcfK) |
| Guardrail drill: the CFO tries to exceed its 2,500 USDC daily cap and is rejected | [`3QeCFf9Y…`](https://testnet.nearblocks.io/txns/3QeCFf9YiPLPj1sCDGeQSQ1WBLsWa9Pm1RQBHJTs86Mn) |

Reproduce on your own accounts:

```bash
npm run build:contract                              # cargo near build → target/near/{paron_core,test_usdc}
npm --prefix agents run testnet:deploy              # faucet accounts, deploy, fund, guardrails, Function Call keys
npm --prefix agents run testnet:scenario -- supply  # then: hedge, spike, modeb, ghost, drill, status
```

Keys are generated locally and stored only in the near-cli keystore (`~/.near-credentials/testnet/`). The repository
contains public keys and transaction hashes, never secrets. **Honest scope of the testnet run:**

* **OutLayer signer.** Attestations and SLA receipts are signed by the TypeScript mirror of the worker, which has
  byte-for-byte golden-vector parity with the Rust crate. Its key is a random secret seed held by the operator. Moving to
  the enclave means deploying `tee-worker/outlayer-cri-oracle` (`npm run build:oracle-wasm`) to OutLayer and rotating the
  key with `set_tee_signer_pubkey` (owner, 1 yocto). The job logs it measures are synthetic workloads.
* **Mode A cash settlement.** It is only possible after `CU-2026-11` matures (2026-11-30T23:59:59Z), against a
  post-maturity attestation: `npm --prefix agents run testnet:scenario -- settle`.
* **NEAR Intents 1Click.** It settles on mainnet only. The live API accepted Paron's exact quote request,
  including `customRecipientMsg` routing to `ft_on_transfer` ([`deployments/1click-live-dry-quote.json`](deployments/1click-live-dry-quote.json)).
  On testnet the agents are funded natively with test USDC instead.

---

## Why this design (what was wrong with v1, and what v2 does instead)

| Problem in compute presale markets | Paron v2 |
| --- | --- |
| **1.5× cash-bond paradox** — locking $150k to pre-sell $100k of compute kills a data center's working capital | Isolated `ShortMarginVault`s: **25% initial / 15% maintenance** margin → **4.0× capital efficiency vs 0.67×**; permissionless liquidation re-hedges at the attested mark; an insurance pool backstops bad debt |
| **Physical-delivery oracle** — a human "verifier" clicking *Delivered* / *Defaulted* | **Mode A**: cash settlement against the OutLayer-attested `CRI-H100` TWAP. **Mode B**: compute measured *inside* an Intel TDX enclave, which signs `request:quote:latency:sla_met`; breaches slash automatically |
| **Liquidity fragmentation** — city × chip × month × provider micro-markets | One unit: **1 CU = 1 h NVIDIA H100 SXM 80GB**, hardware normalised by weight (A100 0.45×, H100 1.00×, H200 1.40×, B200 2.50×, GB200 3.50×) into **three NEP-245 maturities**: `CU-2026-11`, `CU-2026-12`, `CU-2027-01` |
| **Competing with NEAR AI Cloud** | Paron is the *financial layer above it*: agents hedge their NEAR AI Cloud inference bill; Mode A pays out exactly the spiked price |
| **Humans clicking MetaMask on one chain** | Autonomous agents with **Function Call keys**, funded from Base/Solana via **NEAR Intents 1Click** + **Chain Signatures**, bounded by on-chain **AgentGuardrailPolicy** |

---

## Architecture

```text
┌──────────────────────── Autonomous agent swarm (agents/) ─────────────────────────┐
│ CFO-Hedging-Agent      runway VaR → guardrailed agent_buy_forward → Mode A settle │
│ Yield-LP-Market-Maker  post-only quotes · 40% margin buffer · keeper liquidations │
│ Compute-Consumer-Agent Mode B drawdowns · TDX receipts · claim_sla_breach_slash   │
└───────────┬─────────────────────────────────────────────────────────┬─────────────┘
            │ NEAR Function Call access keys (method allowlist,       │ NEAR Intents 1Click (Base USDC, SOL → USDC)
            │ no deposits, gas allowance)                             │ Chain Signatures (v1.signer-prod.testnet)
            ▼                                                         ▼
┌──────────────────────── paron-core (contracts/, near-sdk 5.30) ───────────────────┐
│ nep245.rs      NEP-245 ledger for CU series, mt_transfer[_call], NEP-297 events   │
│ orderbook.rs   price-time CLOB, genesis depth, stale-quote band, agent buys       │
│ margin.rs      25% / 15% vaults, health, liquidation price, re-hedge liquidation  │
│ guardrails.rs  daily spend cap, TWAP slippage band, series allowlist, pause       │
│ settlement.rs  OutLayer attestations, Mode A cash settlement, Mode B + slashing   │
│ lib.rs         USDC (NEP-141) ledger, genesis credit, insurance, invariant audit  │
└───────────────────────────────────────▲───────────────────────────────────────────┘
                                        │ Ed25519 over "{series}:{twap}:{observed_at}:{tdx_quote_hash}"
                                        │ and "{request_id}:{tdx_quote_hash}:{latency}:{sla_met}"
┌──────────────────── outlayer-cri-oracle (tee-worker/, wasm32-wasip2) ─────────────┐
│ multi-source GPU spot feeds → H100-eq normalisation → per-bucket MAD ±2σ filter   │
│ → VWAP per bucket → TWAP (CRI-H100) · inference SLA evaluator · signing_keys::sign │
└───────────────────────────────────────────────────────────────────────────────────┘
```

```text
contracts/paron-core/        Rust smart contract (near-sdk 5.30): lib, nep245, orderbook, margin, guardrails, settlement, events, types, tests
tee-worker/outlayer-cri-oracle/  Rust OutLayer worker: lib (oracle + SLA verifier), main (CLI / WASI stdin→stdout), outlayer.manifest, tests
agents/src/                  TypeScript swarm: cfo-hedging-agent, market-maker-agent, compute-redeemer-agent, intents-bridge, chain-signatures,
                             run-swarm-demo, engine/ (contract mirror + signed local runtime), oracle/ (worker mirror), near-live, outlayer-client
web/src/                     Next.js 15 terminal: app/page (terminal), app/tour (60 s tour), app/api/*, components/* (5 panels + tour banner)
shared/golden-vectors.json   Rust-generated attestation vectors the TypeScript mirror must reproduce byte-for-byte
scripts/verify-all.sh        the 4-gate pipeline
```

---

## Economic & cryptographic design

### Units

`1.00 CU = 10_000` scaled units; USDC amounts are integer micros (6 decimals, the NEP-141 base unit); prices are
micros per CU; ratios are basis points. All math is integer with floor division (`u128` on-chain, `bigint` in TS).
`convert_hardware_to_cu(GPU tier, hours)` = `hours × weight_bps / 10_000` — e.g. 40 h of H200 = **56 CU**.

### Forwards, escrow and Mode A

Longs are **fully paid**: buying `Q` CU at `P_strike` moves `Q × P_strike` into the backing vault's escrow and mints
`Q` NEP-245 tokens. At maturity, an attestation **observed at/after maturity** finalises the series: every vault pays
`Q × P_final` from escrow + collateral into the settlement pool (insurance covers any shortfall) and refunds the rest;
each CU then redeems for `P_final`. Hence the hedge PnL is exactly

```text
ΔV = Q × (P_index − P_strike)
```

Early exit is via the order book (`sell_forward`), never at the index — longs hold no free option on the oracle.
A conservation invariant is exposed on-chain and asserted in every test and in the swarm:
`circulating CU == Σ open vault obligations` before settlement and `== settlement_pool_cu` after
(`audit_series_invariants`).

### Margin vaults (solving the 1.5× bond paradox)

```text
obligation(P) = Q·P      unrealized_loss = max(0, Q·P − escrow)      equity = collateral − unrealized_loss
initial:     equity ≥ 25% × (Q·P + resting ask notional)
maintenance: equity ≥ 15% × Q·P            liquidation price = (collateral + escrow) / (1.15·Q)
```

`liquidate_underwater_vault` is permissionless: the loss moves from the old collateral into the obligation's escrow
(insurance covers bad debt), the liquidator absorbs the obligation **at the attested mark** with fresh 25% margin and
earns a 2.5% bonus, and the provider gets the remaining equity back. Longs stay fully backed throughout.

### Order book safety

* **Genesis depth** is pre-seeded in `new()` for all three series. It is backed by a *genesis liquidity credit*:
  **all withdrawals stay disabled until the credit is funded** (`ft_transfer_call(msg={"action":"fund_genesis"})`), so
  the pre-seeded liquidity can never be extracted as phantom value.
* **Stale-quote band**: every OutLayer attestation purges asks below `index × 0.95` and bids above `index × 1.05`.
* **Maintenance-aware fills**: an ask whose fill would push its vault below 15% is cancelled instead of filled.
* Self-trade prevention, bounded book depth (64/side) and vault count (48/series), minimum size 1 CU.

### Agent guardrails & NEAR Function Call keys

`configure_agent_guardrail` (callable by the agent's parent account, the agent itself, or a delegated owner) sets a
daily spend cap, a TWAP slippage band, a series allowlist and a pause switch; it applies to **every** value-committing
method (buys, bids, short margin, top-ups, liquidations). Every agent-callable method is **non-payable**, so it works
with a NEAR Function Call access key — while `withdraw_usdc`, `mt_transfer*` and `configure_agent_guardrail` require
**1 yoctoNEAR**, i.e. a full-access key the agent never holds. In the swarm, a prompt-injected withdrawal is rejected
by NEAR itself (`MethodNameMismatch`) and an over-eager price by the contract (`slippage guard: … exceeds TWAP band`).

### OutLayer TEE oracle & SLA verifier

The worker normalises each quote to H100-equivalent (`price / weight`), rejects observations outside **±2σ** where
`σ = max(1.4826 × MAD, 0.5% × median)` per 30-min bucket (sparse buckets are judged against the window consensus),
computes the volume-weighted price per bucket and the time-weighted average across buckets, and signs with an
**Ed25519 key that never leaves the enclave** (`outlayer::signing_keys::sign`, declared in `outlayer.manifest`).
`tdx_quote_hash = SHA-256(enclave_measurement ‖ canonical payload)`; job receipts carry the full measured log so the
hash is recomputable from the receipt alone.

On-chain checks in `submit_outlayer_index_attestation`: Ed25519 signature (`env::ed25519_verify`), single-use quote
hash (replay set), freshness (≤ 1 h old, ≤ 5 min clock skew), **monotonic observation time**, and a 100% per-update
circuit breaker. Signing `observed_at_ms` is a deliberate hardening over a 4-argument signature: without it a relayer
could withhold a valid low/high attestation and replay it right after maturity to choose the final price.

### Mode B — attested compute drawdown

`request_compute_redemption` escrows the agent's CU (into the contract account), carves the obligation out of the
provider's vault and moves the strike payment plus a 25% margin slice into the request; deadlines: acknowledge within
15 min, deliver within 4 h. `finalize_redemption_with_tee_receipt` pays the provider (strike + margin) when
`sla_met && latency ≤ 500 ms`, otherwise — or after a deadline, via the permissionless `claim_sla_breach_slash` — the
agent receives **100% of the strike payment + a 15% penalty** from the provider's margin, and the provider's on-chain
reliability score drops.

### Cross-chain funding

`chain-signatures.ts` derives agent addresses exactly like `chainsig.js` (cross-checked in tests):
`epsilon = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:{account},{path}")`, secp256k1 (domain 0) for
EVM/Base and ed25519 (domain 1) for Solana, from the published `v1.signer-prod.testnet` root keys. It builds the real
signing payloads (EIP-1559 ERC-20 transfer, Solana `SystemProgram::Transfer` message) and the MPC `sign` request.
`intents-bridge.ts` requests a 1Click quote whose `recipient` is the Paron contract and whose `customRecipientMsg` is
`{"action":"deposit","beneficiary":"<agent>"}` — the swap lands directly as the agent's margin.

---

## The swarm path (`npm run demo:swarm`, simulated clock 2026-11-05 → 2026-12-02)

| Act | What happens | Result |
| --- | --- | --- |
| 1 · Funding | Treasury installs Function Call keys + guardrails; genesis credit $14,112 repaid; CFO bridges 2,600 Base USDC and the consumer 2.5 SOL via 1Click into Paron margin | CFO $2,597.92, consumer $412.17 |
| 2 · Supply | OutLayer attests CRI-H100 $2.80 (spoofed $9.80 feed rejected at 500σ); provider pre-sells 300 CU Nov @ $2.81 and 200 CU Dec @ $2.95 with 25% margin; LP quotes both series post-only | $210.75 margin instead of a $1,264.50 bond |
| 3 · Hedge | VaR95 = 2.91% of budget ≥ 2% trigger → hedge 500 CU; $2.898 proposal rejected by the slippage guard; re-planned at $2.842 → filled @ VWAP **$2.8082**; withdrawal attempt blocked by the FC key | 500 CU-2026-11 |
| 4 · Spike | Attested $3.05 → $3.35 → $3.70: LP tops up margin; the provider's vault hits 4.42% health and is liquidated by the LP keeper (+$18.50 bonus); final TWAP **$4.10** after maturity | CFO payout **$2,050.00**, ΔV **+$645.90** (unhedged bill $2,050 → locked $1,404.10) |
| 5 · Mode B | 24 CU job delivered (TTFT 180 ms); 16 CU throttled job (TTFT 1,450 ms, 12 tok/s) auto-slashed; 10 CU job ghosted → timeout slash | provider paid $88.50; consumer +$11.50 penalties on top of refunds |

---

## Dual-mode execution

| Integration | Zero-config local mode (verified here) | Live mode (set in `.env`, see `.env.example`) |
| --- | --- | --- |
| NEAR | `LocalNearRuntime`: Ed25519-signed txs, nearcore Function Call key rules, atomic rollback, NEP-141 `ft_transfer_call`; `ParonLocalContract` mirrors the Rust contract (parity-tested) | **Deployed and exercised on testnet** (see above): `testnet:deploy` / `testnet:scenario`, or one agent with `NEAR_ACCOUNT_ID` + `NEAR_PRIVATE_KEY` + `PARON_CONTRACT_ID` → `npm --prefix agents run agent:live -- cfo [--execute]` (near-api-js v7) |
| NEAR Intents | deterministic 1Click-shaped quotes (`simulated: true`) | `ONE_CLICK_LIVE=1` or `ONE_CLICK_JWT` → `POST /v0/quote`, `/v0/deposit/submit`, `GET /v0/status`; live dry quote verified (mainnet only) |
| OutLayer | TS mirror of the Rust worker with the public local-dev enclave key (golden-vector parity) | `OUTLAYER_API_URL` + `OUTLAYER_API_KEY` → the deployed `wasm32-wasip2` worker |
| Chain Signatures | derivation + payloads computed locally from the published MPC root keys | the `sign` request is submitted to `v1.signer-prod.testnet` by a full-access key |
| Wallet (web) | zero-wallet judge mode | defaults to the testnet deployment (override with `NEXT_PUBLIC_PARON_CONTRACT_ID`, `""` disables) → test-USDC faucet, deposits, `place_bid`, `open_short_supply` and `AddKey` delegation with **@hot-labs/near-connect** |

### Build & deploy (optional)

```bash
npm run build:contract      # cargo near build (falls back to a plain wasm32 compile/size check)
npm run build:oracle-wasm   # tee-worker → wasm32-wasip2 component using the OutLayer SDK signing keys
npm run oracle:demo         # native worker: prints every attestation used by the swarm (JSON)
cargo run -q --manifest-path tee-worker/outlayer-cri-oracle/Cargo.toml -- --mode pubkey   # enclave signer key
```

`npm --prefix agents run testnet:deploy` automates the whole sequence on testnet (see *Live on NEAR testnet*): it calls
`new(owner_id, tee_signer_pubkey, usdc_token_id)`, funds the genesis credit with
`usdc.ft_transfer_call(paron, amount, '{"action":"fund_genesis"}')`, registers agent guardrails and installs the agents'
Function Call keys. For mainnet, point `usdc_token_id` at native USDC and use the enclave-derived OutLayer key.

## Contract API (selected)

* **Ledger**: `ft_on_transfer` (deposit / insurance / fund_genesis), `withdraw_usdc` (1 yocto), `usdc_balance_of`
* **NEP-245**: `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`, `mt_resolve_transfer`, `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`, `mt_token`, `convert_hardware_to_cu`
* **Guardrails**: `configure_agent_guardrail`, `delegate_guardrail_owner`, `set_agent_paused`, `get_agent_guardrail`, `agent_remaining_allowance`
* **Trading**: `agent_buy_forward`, `place_bid`, `sell_forward`, `cancel_order`, `open_short_supply`, `get_order_book`, `get_open_orders`
* **Margin**: `top_up_margin`, `withdraw_excess_margin`, `check_vault_health`, `liquidate_underwater_vault`, `list_vault_health`, `quote_initial_margin`
* **Settlement**: `submit_outlayer_index_attestation`, `finalize_series_settlement`, `settle_cash_hedge`, `request_compute_redemption`, `acknowledge_redemption`, `finalize_redemption_with_tee_receipt`, `claim_sla_breach_slash`
* **Audit**: `audit_series_invariants`, `protocol_stats`, `get_cash_settlement_receipts`, `get_liquidation_receipts`, `get_redemptions`

## Security notes & known limitations

* Local mode encodes transactions as canonical JSON (not Borsh) and models the parts of the NEAR runtime agents rely on; it is a deterministic harness, not nearcore.
* The NEAR path is exercised live on testnet. The 1Click client was verified with a live dry quote, but 1Click settles on mainnet only, so testnet funding uses test USDC. The OutLayer HTTP path (`OutlayerHttpOracle`) has not been run against a deployed OutLayer project yet; on testnet the operator-held signer stands in for the enclave key.
* MPC signatures cannot be produced offline: the swarm records the exact `sign` request and payload instead.
* The plain `cargo build` wasm is a compile/size check; deploy with `cargo-near` (`npm run build:contract` uses it when installed).
* `test-usdc` auto-registers storage for minted accounts at its own expense; it is a testnet faucet token, not a production asset.
* Storage staking (NEP-145) is not implemented; growth is bounded by order/vault caps and minimum sizes.
* As with any oracle-settled market, a signed attestation can be front-run between signing and inclusion; frequent attestations, the ±5% band and the 100% circuit breaker bound the impact.

## Hackathon notes (NEAR HACKATHON, 1–14 Nov 2026)

* **Built in the window.** The repository was created for this hackathon. The first commit is dated
  2026-11-05, and all code in it was written during the development window.
* **Prior work (Q-002 / Q-004).** An earlier, separate EVM prototype of the Paron idea, "Paron v1", targeted the Robinhood
  Chain testnet. v2 is a ground-up NEAR rewrite. No code, contracts, configuration or history from v1 is reused; the
  section *Why this design* explains what changed.
* **Third-party libraries (Q-005).**
  * Rust: `near-sdk` / `near-contract-standards` 5.30, OutLayer SDK `outlayer` 0.2.1, `ed25519-dalek`, `sha2`, `hex`,
    `bs58`, `serde`.
  * TypeScript: `near-api-js` 7.4, `@noble/curves`, `@noble/hashes`, `@scure/base`.
  * Web: Next.js 15, React 19, Tailwind CSS 3, `lucide-react`, `@hot-labs/near-connect` 0.12.
  * Tools: `cargo-near`, `tsx`, TypeScript 5.9.
  * No templates or boilerplate repositories were used.
* **AI assistance (Q-005).** The code and documentation were written with an AI coding agent under the author's direction and review.
* **Network scope (Q-007 / Q-010).** Everything runs on NEAR testnet except NEAR Intents 1Click, which has no testnet.
  For 1Click the repository verifies the live API with a `dry: true` quote
  ([`deployments/1click-live-dry-quote.json`](deployments/1click-live-dry-quote.json)).
* **Suggested tracks.** `agents` (primary), `defi`, `security`, `swarms`, `privacy`. See [`HACKATHON.md`](HACKATHON.md) for how each track maps to the code.

## License

[MIT](LICENSE) © 2026 Fatih Maulana
