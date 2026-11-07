#!/usr/bin/env bash
# 停止・コンテナ削除: scripts/down.sh <local|production>
# ボリューム・CONFIG ディレクトリは削除しない（-v は付けない）。
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
compose down
