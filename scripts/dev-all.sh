#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pids=()

cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

bash "$ROOT_DIR/scripts/dev-server.sh" &
pids+=("$!")

sleep 2

bash "$ROOT_DIR/scripts/dev-game.sh" &
pids+=("$!")

bash "$ROOT_DIR/scripts/dev-portal.sh" &
pids+=("$!")

wait -n "${pids[@]}"
