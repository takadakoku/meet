#!/usr/bin/env bash
# 起動: scripts/up.sh <local|production>
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
if [[ "${ENV_NAME}" == "production" && "${ALLOW_PRODUCTION:-0}" != "1" ]]; then
    echo "ERROR: production の起動は本番VPS上でのみ行います（ALLOW_PRODUCTION=1 が必要）。" >&2; exit 1
fi
"${ROOT_DIR}/scripts/apply-branding.sh" "${ENV_NAME}"
echo "Jitsi ${JITSI_IMAGE_VERSION} を起動します (${ENV_NAME})"
compose up -d --build
compose ps
