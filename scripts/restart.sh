#!/usr/bin/env bash
# コンテナ再起動: scripts/restart.sh <local|production>
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
"${ROOT_DIR}/scripts/apply-branding.sh" "${ENV_NAME}"
compose restart
compose ps
