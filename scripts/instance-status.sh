#!/usr/bin/env bash
# Идентичность и роль экземпляра (ТЗ 41.4): deployment_id, instance_id, режим, active/standby.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_env
printf 'DEPLOYMENT_MODE=%s\nDEPLOYMENT_ID=%s\nINSTANCE_ID=%s\nINSTANCE_ROLE=%s\n' \
  "$(env_value DEPLOYMENT_MODE)" "$(env_value DEPLOYMENT_ID)" "$(env_value INSTANCE_ID)" "$(env_value INSTANCE_ROLE)"
if curl -fsS "$(app_url)/api/health" 2>/dev/null; then echo; else warn "приложение не отвечает на $(app_url)"; fi
