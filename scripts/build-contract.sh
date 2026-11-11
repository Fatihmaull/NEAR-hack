#!/usr/bin/env bash
# Build paron-core and the testnet test-usdc token to WebAssembly.
# Preferred: cargo-near (NEAR-VM-compatible wasm; this is what is deployed on testnet — the on-chain code hash is
# base58(sha256(target/near/<crate>/<crate>.wasm))). Fallback: plain cargo for a compile/size check.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v cargo-near >/dev/null 2>&1; then
  for crate in paron-core test-usdc; do
    (cd "$ROOT/contracts/$crate" && cargo near build non-reproducible-wasm --no-abi)
  done
  ls -l "$ROOT"/target/near/*/*.wasm
else
  echo "cargo-near not installed (https://github.com/near/cargo-near) — building with plain cargo (compile/size check)."
  rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
  (cd "$ROOT/contracts/paron-core" && RUSTFLAGS="-C link-arg=-s" cargo build --target wasm32-unknown-unknown --release)
  ls -lh "$ROOT/target/wasm32-unknown-unknown/release/paron_core.wasm"
  echo "For deployment use cargo-near, which produces NEAR-VM-compatible wasm."
fi
