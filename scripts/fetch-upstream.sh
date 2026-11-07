#!/usr/bin/env bash
# 公式 docker-jitsi-meet の固定リリースを取得・展開する（Handbook推奨のリリースアーカイブ方式）
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/VERSION.env"
DEST="${ROOT_DIR}/upstream/docker-jitsi-meet-${JITSI_IMAGE_VERSION}"

if [[ -d "${DEST}" ]]; then
    echo "既に取得済み: ${DEST}"; exit 0
fi
mkdir -p "${ROOT_DIR}/upstream"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
URL="https://github.com/jitsi/docker-jitsi-meet/archive/refs/tags/${JITSI_IMAGE_VERSION}.tar.gz"
echo "取得: ${URL}"
curl -fsSL -o "${TMP}/release.tar.gz" "${URL}"
mkdir -p "${TMP}/x"
tar -xzf "${TMP}/release.tar.gz" -C "${TMP}/x"
mv "${TMP}/x/docker-jitsi-meet-${JITSI_IMAGE_VERSION}" "${DEST}"
sha256sum "${TMP}/release.tar.gz" | tee "${DEST}.sha256"
echo "展開完了: ${DEST}"
