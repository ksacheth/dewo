#!/usr/bin/env bash
# Start the 3 Verifier instances (ports 7101-7103), each with its own key.
# Usage: VERIFIER_KEY_1=0x.. VERIFIER_KEY_2=0x.. VERIFIER_KEY_3=0x.. scripts/run-quorum.sh
set -euo pipefail
cd "$(dirname "$0")/.."
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
for n in 1 2 3; do
  key_var="VERIFIER_KEY_$n"
  PORT=$((7100 + n)) VERIFIER_KEY="${!key_var:?set $key_var}" VERIFIER_NAME="verifier-$n" pnpm dev &
  pids+=($!)
done
wait
