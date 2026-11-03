#!/usr/bin/env bash
# Общие функции хостовых эксплуатационных скриптов. На хосте нужны только Docker Engine
# и Docker Compose plugin (NFR-22): Node.js, npm, Prisma и PostgreSQL client не требуются.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="${CRM_ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE_MAIN="$ROOT_DIR/compose.yaml"

info() { printf '\033[1;34m[crm]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[crm]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[crm] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker не найден. Установите Docker Engine и Compose plugin."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin не найден (нужна команда 'docker compose')."
  docker info >/dev/null 2>&1 || fail "Docker daemon недоступен (запущен ли Docker? есть ли права у пользователя?)."
}

require_env() {
  [ -f "$ENV_FILE" ] || fail "Файл $ENV_FILE не найден. Сначала выполните ./scripts/bootstrap.sh"
}

# Значение переменной из .env (без вывода секретов в лог).
env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE_MAIN" "$@"
}

app_url() {
  local port bind
  port="$(env_value APP_PORT)"; port="${port:-8080}"
  bind="$(env_value APP_BIND)"
  if [ -z "$bind" ] || [ "$bind" = "0.0.0.0" ]; then bind="localhost"; fi
  printf 'http://%s:%s' "$bind" "$port"
}

wait_healthy() {
  local service="$1" timeout="${2:-180}" waited=0 cid status
  while [ "$waited" -lt "$timeout" ]; do
    cid="$(dc ps -q "$service" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      [ "$status" = "healthy" ] && return 0
      [ "$status" = "exited" ] && return 1
    fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

git_commit() { git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown; }
# Версия commit попадает в образ, manifest backup и отчёты проверки.
export APP_COMMIT="${APP_COMMIT:-$(git_commit)}"

backup_run() {
  # Запуск команды в одноразовом ops/backup контейнере.
  dc --profile ops run --rm -T backup "$@"
}
