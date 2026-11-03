#!/usr/bin/env bash
# Promote/takeover (ТЗ 41.6, NFR-23): перевод экземпляра в active writer.
# Выполняется только после явного подтверждения, что прежний active instance остановлен,
# выведен из эксплуатации или признан недоступным. Автоматического fencing офлайн-узла нет —
# предотвращение split-brain опирается на эту административную процедуру.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker
require_env

DEP="$(env_value DEPLOYMENT_ID)"
INST="$(env_value INSTANCE_ID)"
if [ "$(env_value INSTANCE_ROLE)" = "active" ]; then
  info "Экземпляр уже active"
  exit 0
fi
warn "ВНИМАНИЕ: одновременная работа двух active-экземпляров одного deployment приводит к расхождению данных."
printf 'Подтвердите, что прежний active-узел остановлен или выведен из эксплуатации.\nВведите DEPLOYMENT_ID (%s): ' "$DEP"
read -r answer
[ "$answer" = "$DEP" ] || fail "подтверждение не получено"
printf 'Кто выполняет promote (ФИО/должность): '
read -r who
who="$(printf '%s' "$who" | tr -cd '[:alnum:][:space:]._-' | cut -c1-120)"

set_env_role "active"
dc up -d db >/dev/null
wait_healthy db 120 || fail "PostgreSQL недоступна"
record_instance_event "instance.promoted" "$DEP" "$INST" "$who"
dc up -d --no-deps --force-recreate app
wait_healthy app 240 || fail "приложение не прошло healthcheck"
info "Экземпляр $INST переведён в active writer"
