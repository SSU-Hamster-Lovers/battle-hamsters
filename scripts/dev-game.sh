#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/dev-common.sh"

cd "$ROOT_DIR/apps/game"
echo "game -> http://${GAME_HOST}:${GAME_PORT}"
echo "game uses WS -> ${VITE_SERVER_WS_URL}"
corepack pnpm dev
