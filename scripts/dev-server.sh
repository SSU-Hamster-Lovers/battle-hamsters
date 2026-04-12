#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/dev-common.sh"

cd "$ROOT_DIR/server"
echo "server -> http://${API_HOST}:${API_PORT}"
cargo run
