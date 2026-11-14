# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two sides of one market, weighted equally:

* **Buyers: operators of autonomous AI agents.** Teams and solo builders whose agents pay for inference or training out of a
  fixed USDC budget. Their job is to keep the runway predictable when GPU prices jump, without handing an agent the keys to
  the treasury.
* **Sellers: GPU providers and data centers** (for example an ASEAN Tier-3 H100 operator). Their job is to pre-sell capacity
  at a known price without locking up 150% of it in a cash bond, and to be paid for jobs they actually deliver.

Secondary audiences:

* **Market makers / LP agents** who quote both sides and act as liquidation keepers.
* **Hackathon judges and technical evaluators**, including AI screeners (Claude Code, Codex). They must be able to try
  every flow without a wallet and verify claims against on-chain evidence.

## Product Purpose

Paron is a forward market for GPU compute on NEAR. Agents lock in tomorrow's compute cost today with NEP-245 compute
forwards. A forward either settles in cash against a TEE-attested GPU price index (Mode A) or is redeemed for real compute,
measured inside a TEE, with automatic SLA slashing (Mode B). Success means an agent's compute bill stays inside budget
through a price spike, and a provider earns on capacity it pre-sold with 25% margin instead of a 1.5× bond.

## Positioning

The hedging and procurement desk above GPU clouds such as NEAR AI Cloud, not another GPU marketplace. The mechanism no
neighbour can copy truthfully:

* agents trade through NEAR Function Call keys that cannot withdraw, inside on-chain guardrails;
* prices and SLA verdicts come from OutLayer TEE attestations verified by the contract;
* one canonical unit (1 CU = 1 h H100 SXM) gives three liquid maturities instead of fragmented markets;
* cross-chain margin arrives in one hop through NEAR Intents and Chain Signatures.

## Operating Context

* **Status: testnet beta.** `paron-core` is deployed at `market.paron-mwbjvxck.testnet` with a no-value test USDC. There
  are no real customers or mainnet volume yet; the site says so plainly.
* **Two runtimes.** A deterministic, signed local engine (zero wallet, used by the demo and the desk), plus the live
  testnet contract read over RPC. Wallet users connect through NEAR Connect.
* **Evaluation.** Judges use the hosted demo (https://paron-near.vercel.app), the 60-second guided demo,
  `npm run verify:all`, and nearblocks links.

## Capabilities and Constraints

Confirmed capabilities, all implemented:

* **Markets.** Three NEP-245 series (`CU-2026-11`, `CU-2026-12`, `CU-2027-01`). Hardware → CU conversion (A100 0.45×,
  H100 1×, H200 1.4×, B200 2.5×, GB200 3.5×). Price-time order book.
* **Margin.** Short supply with 25% initial / 15% maintenance margin. Permissionless liquidation and an insurance pool.
* **Agent controls.** Guardrails: daily spend cap, slippage band, series allowlist, pause. Function Call key delegation.
* **Oracle.** The OutLayer CRI-H100 index rejects manipulated feeds at ±2σ.
* **Settlement.** Mode A cash settlement at maturity. Mode B redemption with acknowledge, deliver and slash.
* **Funding.** NEAR Intents 1Click funding and Chain Signatures addresses.
* **Audit.** A deterministic, verifiable receipt for the swarm run. Live testnet state and run log.

Constraints:

* 1Click is mainnet-only.
* The OutLayer signer is operator-held on testnet until the worker runs in an enclave.
* Mode A on testnet can only settle after 2026-11-30.

## Brand Commitments

* Name: **Paron**; "v2" is an internal version label, not part of the brand on marketing surfaces.
* The user explicitly asked for a minimal, serious, exchange-grade look in the spirit of Coinbase (see the reference
  `DESIGN.md` from getdesign). That means a calm, institutional, white-canvas feel with a single accent. It must not copy
  Coinbase's name, logo, licensed fonts or brand assets.
* Journey modelled on large exchanges: marketing landing → app dashboard with a persistent sidebar (Vercel-style account
  navigation) → one page per feature. The demo lives on its own page and is reached from a modal.

## Evidence on Hand

* `deployments/testnet.json`, `deployments/testnet-run.json`: 58 real testnet transactions, account ids, code hashes.
* `deployments/1click-live-dry-quote.json`: a live 1Click quote.
* The audit receipt (`receipt_sha256` `b0b1ce8f…`), served by `GET /api/receipt`.
* `docs/media/paron-demo.mp4`: the demo video. `docs/FEATURES.md`: features and flows.
* Absent and never to be fabricated: customers, testimonials, TVL/volume, partners, investors, team bios, audits by firms,
  pricing.

## Product Principles

1. **Show, then claim.** Every number on a marketing surface is either live on-chain data or clearly labelled as simulated.
2. **Two-sided by default.** Every key screen answers both "I buy compute" and "I sell compute".
3. **Safety is the feature.** Guardrails, keys that cannot withdraw and attestations are presented as the product, not
   as fine print.
4. **Zero-friction evaluation.** Anything can be tried without a wallet; a wallet only adds live testnet signing.

## Accessibility & Inclusion

Target WCAG 2.2 AA: contrast, keyboard navigation with visible focus, reduced-motion support, and status that never
relies on colour alone (up/down, ok/rejected also carry text).
