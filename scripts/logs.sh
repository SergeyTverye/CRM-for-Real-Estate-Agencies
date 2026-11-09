#!/usr/bin/env bash
# Логи: ./scripts/logs.sh [app|db|migrate] [--follow]. Логи приложения не содержат паролей и токенов.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env
SERVICE=""; FOLLOW=""
for a in "$@"; do case "$a" in --follow|-f) FOLLOW="--follow" ;; *) SERVICE="$a" ;; esac; done
dc logs --tail 300 $FOLLOW $SERVICE
