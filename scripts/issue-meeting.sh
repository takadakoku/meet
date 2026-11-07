#!/usr/bin/env bash
# 会議URLの発行: scripts/issue-meeting.sh <local|production> [--hours N] [--name 主催者表示名]
#
# - 推測困難なランダム会議室名を生成し、主催者用URL（JWT付き）とゲスト用URLを表示する。
# - 予約機能ではない。日時・顧客情報・発行履歴はどこにも保存しない。
# - JWT はURLの # 以降に付けるため、サーバーへは送信されずアクセスログにも残らない。
# - 主催者用URLは主催者本人だけが使う。顧客にはゲスト用URLだけを送る。
# - 署名鍵（JWT_APP_SECRET）は .env から読むだけで、表示・引数渡し・ログ出力はしない。
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
shift

HOURS=24
HOST_NAME="主催者"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --hours) HOURS="${2:-}"; shift 2 ;;
        --name)  HOST_NAME="${2:-}"; shift 2 ;;
        *) echo "usage: $0 <local|production> [--hours N] [--name 主催者表示名]" >&2; exit 2 ;;
    esac
done
[[ "${HOURS}" =~ ^[0-9]+$ && "${HOURS}" -ge 1 && "${HOURS}" -le 168 ]] \
    || { echo "ERROR: --hours は 1〜168 の整数で指定してください。" >&2; exit 2; }

# 生成処理は発行画面（issuer/）と共通。-I で作業ディレクトリ等からのモジュール読み込みを防ぐ。
python3 -I "${ROOT_DIR}/issuer/meeting.py" "${ENV_FILE}" "${HOURS}" "${HOST_NAME}"
