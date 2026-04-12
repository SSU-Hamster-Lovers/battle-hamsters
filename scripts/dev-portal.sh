#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/dev-common.sh"

cd "$ROOT_DIR/apps/portal"
if [ -d ".next" ]; then
  echo "portal -> clearing stale .next cache"
  rm -rf .next
fi
echo "portal -> http://${PORTAL_HOST}:${PORTAL_PORT}"
echo "portal uses API -> ${NEXT_PUBLIC_SERVER_API_URL}"
echo "portal links GAME -> ${NEXT_PUBLIC_GAME_URL}"
corepack pnpm dev
