#!/usr/bin/env bash



set -euo pipefail
. "$(dirname "$0")/lib.sh"

require_docker
require_env

export APP_COMMIT="${APP_COMMIT:-$(git_commit)}"
info "Сборка образов (commit $APP_COMMIT)…"
dc build app
dc --profile ops build backup

info "Запуск PostgreSQL…"
dc up -d db
wait_healthy db 120 || fail "PostgreSQL не перешла в состояние healthy (см. ./scripts/logs.sh db)"

info "Миграции и seed…"
dc run --rm migrate || fail "Миграция не выполнена — приложение не запускается (см. вывод выше)"

info "Запуск приложения…"
dc up -d --no-deps app worker search-worker
wait_healthy app 240 || fail "Приложение не прошло healthcheck (см. ./scripts/logs.sh app)"

info "Готово: $(app_url)"
