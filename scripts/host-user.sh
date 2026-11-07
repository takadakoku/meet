#!/usr/bin/env bash
# 主催者アカウントの管理（会議URL発行画面のログイン用）
#   scripts/host-user.sh <local|production> add <ID> --name <表示名>   # パスワードは非表示で2回入力
#   scripts/host-user.sh <local|production> passwd <ID>
#   scripts/host-user.sh <local|production> del <ID>
#   scripts/host-user.sh <local|production> list
# 保存先: ${CONFIG}/issuer/users.json（Webルート外・600）。変更はコンテナ再起動なしで即時反映。
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
shift
CFG="$(config_dir)"
install -d -m 700 "${CFG}/issuer"
python3 -I "${ROOT_DIR}/issuer/manage_users.py" "${CFG}/issuer/users.json" "$@"
