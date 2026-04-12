#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

load_env_file() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    . "$file"
    set +a
  fi
}

load_env_file "$ROOT_DIR/server/.env"
load_env_file "$ROOT_DIR/server/.env.local"
load_env_file "$ROOT_DIR/.env"
load_env_file "$ROOT_DIR/.env.local"

export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-8081}"
export PORTAL_HOST="${PORTAL_HOST:-0.0.0.0}"
export PORTAL_PORT="${PORTAL_PORT:-3000}"
export GAME_HOST="${GAME_HOST:-0.0.0.0}"
export GAME_PORT="${GAME_PORT:-5173}"
export PUBLIC_SERVER_HOST="${PUBLIC_SERVER_HOST:-localhost}"
export PUBLIC_GAME_HOST="${PUBLIC_GAME_HOST:-$PUBLIC_SERVER_HOST}"
export NEXT_PUBLIC_SERVER_API_URL="${NEXT_PUBLIC_SERVER_API_URL:-http://${PUBLIC_SERVER_HOST}:${API_PORT}}"
export NEXT_PUBLIC_GAME_URL="${NEXT_PUBLIC_GAME_URL:-http://${PUBLIC_GAME_HOST}:${GAME_PORT}}"
export VITE_SERVER_WS_URL="${VITE_SERVER_WS_URL:-ws://${PUBLIC_SERVER_HOST}:${API_PORT}/ws}"
