#!/usr/bin/env bash
# Перевод экземпляра в standby (только чтение): изменяющие API-запросы отклоняются (ТЗ 41.6).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker
require_env

DEP="$(env_value DEPLOYMENT_ID)"
INST="$(env_value INSTANCE_ID)"
set_env_role "standby"
dc up -d db >/dev/null
wait_healthy db 120 || true
record_instance_event "instance.demoted" "$DEP" "$INST" "operator"
dc up -d --no-deps --force-recreate app worker
info "Экземпляр $INST переведён в standby (только чтение)"
