#!/usr/bin/env bash
# Build the paron-core contract to WebAssembly.
# Preferred: cargo-near (ABI + NEAR-compatible wasm). Fallback: plain cargo for a compile/size check.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contracts/paron-core"
if command -v cargo-near >/dev/null 2>&1; then
  cargo near build non-reproducible-wasm
  echo "wasm: $ROOT/target/near/paron_core/paron_core.wasm"
else
  echo "cargo-near not installed (https://github.com/near/cargo-near) — building with plain cargo (compile/size check)."
  rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
  RUSTFLAGS="-C link-arg=-s" cargo build --target wasm32-unknown-unknown --release
  ls -lh "$ROOT/target/wasm32-unknown-unknown/release/paron_core.wasm"
  echo "For deployment use cargo-near, which produces NEAR-VM-compatible, ABI-embedded wasm."
fi
