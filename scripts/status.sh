#!/usr/bin/env bash
# Состояние стека: контейнеры, health, версия приложения.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env
dc ps
echo
if curl -fsS "$(app_url)/api/health" 2>/dev/null; then echo; else warn "Приложение не отвечает на $(app_url)/api/health"; fi
