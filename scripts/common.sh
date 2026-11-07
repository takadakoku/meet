#!/usr/bin/env bash
# 共通処理: 環境名の検証と docker compose 呼び出し
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/VERSION.env"
UPSTREAM_DIR="${ROOT_DIR}/upstream/docker-jitsi-meet-${JITSI_IMAGE_VERSION}"

require_env() {
    ENV_NAME="${1:-}"
    case "${ENV_NAME}" in
        local|production) ;;
        *) echo "usage: $0 <local|production>" >&2; exit 2 ;;
    esac
    ENV_FILE="${ROOT_DIR}/${ENV_NAME}/.env"
    [[ -f "${ENV_FILE}" ]] || { echo "ERROR: ${ENV_FILE} がありません。scripts/init-env.sh ${ENV_NAME} を実行してください。" >&2; exit 1; }
    [[ -f "${UPSTREAM_DIR}/docker-compose.yml" ]] || { echo "ERROR: 公式構成がありません。scripts/fetch-upstream.sh を実行してください。" >&2; exit 1; }
    if grep -qE '^[[:space:]]*JITSI_IMAGE_VERSION=' "${ENV_FILE}"; then
        echo "ERROR: ${ENV_FILE} に JITSI_IMAGE_VERSION を書かないでください（VERSION.env で一元管理）。" >&2; exit 1
    fi
}

compose() {
    # VERSION.env を最後に読み込み、バージョンを両環境で統一する
    # 公式 compose に会議URL発行画面（issuer/）を重ねる
    MEET_ROOT="${ROOT_DIR}" docker compose \
        -p "jitsi-${ENV_NAME}" \
        --project-directory "${UPSTREAM_DIR}" \
        -f "${UPSTREAM_DIR}/docker-compose.yml" \
        -f "${ROOT_DIR}/issuer/docker-compose.issuer.yml" \
        --env-file "${ENV_FILE}" \
        --env-file "${ROOT_DIR}/VERSION.env" \
        "$@"
}

config_dir() {
    # .env の CONFIG 値を取得（~ を展開）
    local c
    c="$(grep -E '^CONFIG=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
    echo "${c/#\~/$HOME}"
}
