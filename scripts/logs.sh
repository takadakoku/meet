#!/usr/bin/env bash
# ログ表示: scripts/logs.sh <local|production> [service] [docker compose logs のオプション]
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
shift
compose logs "$@"
