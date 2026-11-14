# Antislop Delivery Gate: web revamp (2026-11-14)

Mode: during (session choice). Design Read: an exchange-grade marketing site plus a trading console for AI-agent
operators and GPU providers, in an institutional minimal language the owner pinned (a Coinbase-style reference).
Dials: ENERGY 2 / RHYTHM 2 / MOTION 1.

Evidence base:
* An automated click-through of 56 interactions on the production build (Playwright). All pass, with no console errors.
* Contrast measured with the antislop contrast checker.
* `impeccable detect` over `web/src`: 0 findings against Paron's own DESIGN.md.
* An Impeccable finish review. Its first verdict was `fix`, with 8 material fixes. All were applied, and two verdict passes ended in `ship`.

## Block 1: Hard Gate (all must be "no")

| Rule | Result | Evidence |
| --- | --- | --- |
| R-02 em dash | PASS | No em dash in UI copy. Engine and testnet event strings are part of the signed receipt, so `plain()` in `web/src/lib/format.ts` normalises them at display time |
| R-03 mobile | PASS | 0 px horizontal overflow at 390 px on `/`, `/dashboard`, trade, agents, oracle, testnet, audit and `/demo`. Primary controls are at least 44 px everywhere. On touch devices (`pointer: coarse`) small buttons, segment options, nav and footer links, and icon buttons also grow to 44 px (`globals.css`) |
| R-17 numbers | PASS | Every number is live from the testnet contract (`/api/testnet`), computed by the engine, or labelled "simulated" (sidebar desk card, Overview market panel, desk clock, footers) |
| R-18 testimonials | PASS | None exist |
| R-23 assets | PASS | No logo was invented: the wordmark is the product name set as type. No avatars or people |
| R-24 navigation | PASS | Landing nav anchors (#markets, #settlement, #safety, #proof) and all 8 sidebar links resolve, verified by the click-through |
| R-25 contrast | PASS | On white: body 6.2:1, muted 5.0:1, primary 6.0:1, up 5.4:1, down 5.7:1, warn 5.9:1. On night: soft 8.6:1, accent 8.1:1 |
| R-26 controls | PASS | Every button and link acts. For example: trade reject, fill and pre-sell all produce signed txs; oracle attest; Mode A and B; audit download; demo play, pause, next and restart; dialogs |
| R-27 states | PASS | Loading text on every data view. Empty states name the next action ("Run a job above…"). Error states with retry on testnet and audit; engine boot failure shows a toast |
| R-28 FAQ | PASS | No FAQ |
| R-32 keyboard | PASS | Global `:focus-visible` ring. Dialogs and mobile sheets close with Escape and return focus. Skip links on landing and dashboard |
| R-33 patch scripts | PASS | No patch scripts in the repo; features are written in source |
| R-34 themes | PASS | One theme, so there is no toggle to break (see R-21) |
| R-35 verified | PASS | Built and run; click-through log: 56/56 PASS, for example "trade buy above ceiling → Rejected by the contract: Max price $3.5000 is above the guardrail ceiling of $2.8420" and "audit verification → 4/4 checks pass in browser" |
| R-36 claims | PASS | No compliance, performance or customer claims. "Testnet beta" and "test USDC has no value" are stated |
| R-37 direction | PASS | Direction pinned by the owner (Coinbase-style reference plus an exchange journey), recorded in the surface briefs |
| R-38 real content | PASS | Every tx link, account and redemption comes from `deployments/*.json` or RPC |
| R-39 semantics | PASS | `cursor: pointer` is set in the base layer. Native buttons and links; icon-only buttons have `aria-label`. Every field has a label. `lang`, a unique title per page, header/nav/main/footer, one h1 per page. Reduced motion is honoured, and the 60 s demo autoplay has Pause |
| R-40 performance | PASS | No raster images; the charts are inline SVG with viewBox. Fonts are self-hosted. No third-party scripts. Not measured: Web Vitals |

## Block 2: Purpose-Gate (reasons)

| Rule | Result | Reason written |
| --- | --- | --- |
| R-01 colour | PASS | One accent, #1652F0, on primary actions and the forward-curve line, with no gradients. The dark bands carry the live product cards (reference pattern) |
| R-04 icons | PASS | Lucide icons at 1.75 stroke, used only in the dashboard sidebar and for status (check, x). Each names its destination; the landing has none apart from Menu |
| R-06 type | PASS | Inter at weight 400 for display gives the calm institutional voice the reference documents. JetBrains Mono is used only for numbers, hashes and accounts, where tabular alignment helps |
| R-07 background | PASS | No grids or patterns |
| R-08 arrows | PASS | No decorative arrows on buttons; → appears only inside data (lifecycle steps, entry → index) |
| R-09 badges | PASS | "Testnet beta" is real status. Badges mark states such as Filled, Rejected, Accepted and Slashed |
| R-10 / R-13 glass and glow | PASS | None. The backdrop blur on the sticky mobile bar is the only blur |
| R-12 shadow | PASS | Elevation only: dialogs, toasts, the overlapping hero card, and the active nav or segment pill |
| R-14 cards | PASS | Sections use rows and lists; the two-sides block is two columns with different content |
| R-19 motion | PASS | MOTION 1: state transitions only (dialog entrance, progress width, demo event fade). No scroll reveals and no loops |
| R-22 illustrations | PASS | None; the visuals are data (forward curve, order book depth) |

## Block 3: Liveliness (all must be "yes")

| Check | Result |
| --- | --- |
| Dials declared, output consistent | YES. ENERGY 2: dark hero and bands. RHYTHM 2: light, soft and dark bands with varied compositions. MOTION 1 |
| One focal point per screen | YES. Landing: the H1 plus the live curve card. Each dashboard page: its primary work area |
| Structural whitespace | YES. 80–96 px between bands, 20 px between panels |
| One deliberate accent | YES. The blue on the primary action and the curve |
| Identity motif | YES. The forward curve (index line, three maturity nodes, dashed strike) plus mono numerals |
| Design Read declared before building | YES. It is recorded at the top of this file and in the surface briefs |

## Block 4: Craftsmanship and Quality Locks (all must be "no")

| Check | Result | Note |
| --- | --- | --- |
| C-1 to C-5 | NO | Every section answers a product need. All controls work. Resilient at 390 px and 1440 px and keyboard-only. No fabricated claims |
| R-05 template layout | NO | No bento, fake terminal, logo bar, 3-step how-it-works, pricing columns or 4-column footer |
| R-11 radius | NO | Pills for actions; 24 / 16 / 12 px for cards, panels and fields |
| R-15 CTAs | NO | "Open the desk", "Run the 60-second demo", "Buy 50 CU", "Pre-sell capacity", "Attest and submit" |
| R-16 buzzwords | NO | None |
| R-20 generic | NO | Live testnet cards and the forward-curve motif are specific to Paron |
| R-21 dark mode | NO | Light only, by decision: the owner's reference and a daytime-desk use scene. Dark appears only as marketing bands |
| R-29 palette | NO | Neutrals + 1 accent + semantic up/down/warn |
| R-30 clone | NO | The owner explicitly asked for a Coinbase-like look. No Coinbase name, logo or licensed font is used |
| R-31 reasons | NO | Reasons are written above and in DESIGN.md |

**Gate result: PASS. No item is FAIL.**
