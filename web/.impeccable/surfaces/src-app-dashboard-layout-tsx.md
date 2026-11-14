---
version: 1
slug: "src-app-dashboard-layout-tsx"
primary_target: "src/app/dashboard/layout.tsx"
related_targets: ["src/app/dashboard"]
---

# Surface brief: app dashboard (/dashboard/*)

Mode: Operate. Audience: an agent operator or provider working the desk; judges trying flows without a wallet.
Tasks: read markets, trade inside guardrails, manage agents and keys, attest the index, settle and redeem, check live testnet state, verify the audit receipt.

## Direction contract

THESIS: A working exchange console: persistent left sidebar grouped by job (Overview, Markets, Trade, then Agents, Oracle, Settlement, then Testnet, Audit), one page per feature, the account and network at the sidebar foot. It refuses the four-stat-cards-plus-chart default: each page leads with the decision made there.
OWN-WORLD: Same tokens as the landing in their quiet register: white canvas, #F7F7F7 sidebar ground, hairline dividers, 16px panels, 12px inputs, pill primary actions in the accent blue, mono tabular numbers, up/down as text colour plus a word.
STORY: The operator sees the desk state, acts, and gets a signed result (toast with tx) every time; rejections are explained by the contract's own message.
FIRST VIEWPORT: Sidebar 248px (wordmark, grouped nav with an active marker that is weight plus a tinted pill, demo entry, network and wallet at the foot). Main: page title and one-line purpose, then the page's primary work area at full width. On first visit, a dialog offers the 60-second demo or the dashboard.
FORM: Pinned with the landing (same brief). seed: none (pinned) "/dashboard, dengan page page perfitur didalamnya ... akses via sidebar seperti UI vercel".
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
