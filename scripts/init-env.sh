#!/usr/bin/env bash
# <env>/.env を .env.example から生成し、パスワード生成と CONFIG ディレクトリ作成を行う。
# 既存の .env は上書きしない。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${1:-}"
case "${ENV_NAME}" in local|production) ;; *) echo "usage: $0 <local|production>" >&2; exit 2;; esac
ENV_FILE="${ROOT_DIR}/${ENV_NAME}/.env"

if [[ "${ENV_NAME}" == "production" && "${ALLOW_PRODUCTION:-0}" != "1" ]]; then
    echo "ERROR: production の初期化は本番VPS上でのみ行います（ALLOW_PRODUCTION=1 が必要）。" >&2; exit 1
fi

umask 077
if [[ -f "${ENV_FILE}" ]]; then
    echo "${ENV_FILE} は既に存在するため上書きしません。"
else
    cp "${ROOT_DIR}/${ENV_NAME}/.env.example" "${ENV_FILE}"
    # 公式 gen-passwords.sh と同じ方式（openssl rand -hex 16）。値は表示しない。
    for key in JICOFO_AUTH_PASSWORD JVB_AUTH_PASSWORD JIGASI_XMPP_PASSWORD \
               JIGASI_TRANSCRIBER_PASSWORD JIBRI_RECORDER_PASSWORD JIBRI_XMPP_PASSWORD; do
        sed -i "s#^${key}=.*#${key}=$(openssl rand -hex 16)#" "${ENV_FILE}"
    done
    # JWT 署名鍵（HS256 用に 256bit）。値は表示しない。
    sed -i "s#^JWT_APP_SECRET=.*#JWT_APP_SECRET=$(openssl rand -hex 32)#" "${ENV_FILE}"
    # 会議URL発行画面のセッション署名鍵
    sed -i "s#^ISSUER_SESSION_SECRET=.*#ISSUER_SESSION_SECRET=$(openssl rand -hex 32)#" "${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
    echo "生成しました: ${ENV_FILE}（パーミッション 600）"
fi

CONFIG="$(grep -E '^CONFIG=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
CONFIG="${CONFIG/#\~/$HOME}"
[[ -n "${CONFIG}" ]] || { echo "ERROR: CONFIG が未設定です" >&2; exit 1; }

# Handbook (stable-11146 以降) のディレクトリ構成。jigasi/jibri/transcriber は使わないため作成しない。
mkdir -p "${CONFIG}"/{web,issuer,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb}
mkdir -p "${CONFIG}"/storage/{prosody,transcripts,web}
mkdir -p "${CONFIG}"/tmp/{web-crontabs,web-load-test}
chmod 700 "${CONFIG}" "${CONFIG}/issuer"
if [[ "$(id -u)" == "1000" ]]; then
    # コンテナ実行ユーザー(uid 1000)と所有者が一致するため 777 は不要
    chmod 750 "${CONFIG}"/storage/* "${CONFIG}"/tmp/*
else
    # Handbook 記載の方法（コンテナは uid 1000 で動作）
    chmod 777 "${CONFIG}"/storage/{prosody,transcripts,web} "${CONFIG}"/tmp/{web-crontabs,web-load-test}
fi
echo "CONFIG ディレクトリ: ${CONFIG}"
