#!/usr/bin/env bash
# branding/web/ 配下の公式カスタムファイルを ${CONFIG}/web/ へ同期する。
# 対象（公式の仕組み: web コンテナ起動時に生成ファイルへ追記される）:
#   custom-config.js, custom-interface_config.js, nginx/custom-meet.conf
#   branding/（ロゴ・ファビコン画像。custom-meet.conf から /run/web/config/branding/ として配信）
# branding/web/ にファイルが無ければ何もしない（Jitsi 標準のまま）。
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
CFG="$(config_dir)"
SRC="${ROOT_DIR}/branding/web"
for f in custom-config.js custom-interface_config.js nginx/custom-meet.conf; do
    if [[ -f "${SRC}/${f}" ]]; then
        install -D -m 640 "${SRC}/${f}" "${CFG}/web/${f}"
        echo "branding: ${f} を適用"
    elif [[ -f "${CFG}/web/${f}" ]]; then
        rm -f "${CFG}/web/${f}"
        echo "branding: ${f} を除去（branding/web に存在しないため）"
    fi
done
# 画像ディレクトリは丸ごと同期（branding/web/branding が無ければ除去）
if [[ -d "${SRC}/branding" ]]; then
    rm -rf "${CFG}/web/branding"
    install -d -m 755 "${CFG}/web/branding"
    install -m 644 "${SRC}/branding/"* "${CFG}/web/branding/"
    echo "branding: branding/（画像）を適用"
elif [[ -d "${CFG}/web/branding" ]]; then
    rm -rf "${CFG}/web/branding"
    echo "branding: branding/（画像）を除去（branding/web に存在しないため）"
fi
