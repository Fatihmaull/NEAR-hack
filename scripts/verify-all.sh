#!/usr/bin/env bash
# Paron v2 — master verification pipeline (Stage-1 judges: run `npm run verify:all`).
# Zero configuration: no keys, no network calls beyond package registries on first install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NO_COLOR="${NO_COLOR:-}"

if [ -t 1 ] && [ -z "${NO_COLOR}" ]; then
  bold() { printf '\033[1m%s\033[0m\n' "$*"; }
  green() { printf '\033[32m%s\033[0m\n' "$*"; }
  red() { printf '\033[31m%s\033[0m\n' "$*"; }
else
  bold() { printf '%s\n' "$*"; }
  green() { printf '%s\n' "$*"; }
  red() { printf '%s\n' "$*"; }
fi

GATE_TIMES=()
run_gate() {
  local n="$1" title="$2"; shift 2
  bold ""
  bold "━━━ GATE ${n}/4 · ${title} ━━━"
  local start=$SECONDS
  if "$@"; then
    GATE_TIMES+=("Gate ${n}: ${title} — PASSED in $((SECONDS - start))s")
    green "✔ Gate ${n} passed ($((SECONDS - start))s)"
  else
    red "✘ Gate ${n} FAILED: ${title}"
    exit 1
  fi
}

command -v cargo >/dev/null || { red "cargo not found — install Rust (https://rustup.rs)"; exit 1; }
command -v npm >/dev/null || { red "npm not found — install Node.js >= 20"; exit 1; }
if [ ! -d node_modules/next ] || [ ! -d node_modules/tsx ]; then
  bold "Installing workspace dependencies (first run only)…"
  npm install --no-audit --no-fund
fi

gate_contract() {
  cargo test --manifest-path contracts/paron-core/Cargo.toml
  cargo test --manifest-path contracts/test-usdc/Cargo.toml
}

gate_oracle() {
  cargo test --manifest-path tee-worker/outlayer-cri-oracle/Cargo.toml
}

gate_agents() {
  npm --prefix agents run typecheck &&
    npm --prefix agents test &&
    npm --prefix agents run demo:swarm &&
    npm --prefix agents run verify:receipt
}

gate_web() {
  NEXT_TELEMETRY_DISABLED=1 npm --prefix web run build
}

TOTAL_START=$SECONDS
run_gate 1 "Rust smart contract suites (contracts/paron-core, contracts/test-usdc)" gate_contract
run_gate 2 "OutLayer TEE oracle worker (tee-worker/outlayer-cri-oracle)" gate_oracle
run_gate 3 "Autonomous agent swarm end-to-end (agents/)" gate_agents
run_gate 4 "Next.js 15 production typecheck & build (web/)" gate_web

bold ""
for t in "${GATE_TIMES[@]}"; do green "  ✔ ${t}"; done
green "╔══════════════════════════════════════════════════════════╗"
green "║        ALL 4 VERIFICATION GATES PASSED  ($((SECONDS - TOTAL_START))s total)         ║"
green "╚══════════════════════════════════════════════════════════╝"
