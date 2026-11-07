#!/usr/bin/env bash
# 状態確認: scripts/status.sh <local|production>
source "$(dirname "$0")/common.sh"
require_env "${1:-}"
compose ps
