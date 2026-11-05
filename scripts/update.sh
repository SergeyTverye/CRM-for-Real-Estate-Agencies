#!/usr/bin/env bash
# Обновление (ТЗ 36.4): защитный backup → сборка новой версии → миграции → перезапуск app.
# Если миграция завершилась ошибкой, новая версия не считается развернутой.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

require_docker
require_env

if [ -n "$(dc ps -q db 2>/dev/null)" ]; then
  info "Защитный backup перед обновлением…"
  "$ROOT_DIR/scripts/backup.sh" --trigger pre_update || fail "Backup перед обновлением не создан — обновление прервано"
fi

export APP_COMMIT="${APP_COMMIT:-$(git_commit)}"
dc build app
dc --profile ops build backup
dc up -d db
wait_healthy db 120 || fail "PostgreSQL недоступна"
dc run --rm migrate || fail "Миграция завершилась ошибкой. Новая версия НЕ развернута; восстановить данные можно из backup перед обновлением."
dc up -d --no-deps app worker
wait_healthy app 240 || fail "Новая версия не прошла healthcheck"
info "Обновление завершено: $(app_url)"
