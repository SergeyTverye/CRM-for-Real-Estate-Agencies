#!/usr/bin/env bash
# Остановка контейнеров БЕЗ удаления данных (тома и каталоги data/, backups/ сохраняются).
# Полное удаление данных разработки — только явно: CRM_ALLOW_PURGE=yes ./scripts/down.sh --purge-dev-data
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env
if [ "${1-}" = "--purge-dev-data" ]; then
  [ "${CRM_ALLOW_PURGE-}" = "yes" ] || fail "для удаления данных установите CRM_ALLOW_PURGE=yes"
  [ "$(env_value NODE_ENV)" != "production" ] || [ "${CRM_PURGE_PRODUCTION-}" = "i-understand" ] || fail "NODE_ENV=production: удаление данных запрещено"
  printf 'Будут удалены БД, файлы и import-staging этого стека. Введите PURGE: '; read -r a; [ "$a" = "PURGE" ] || fail "отменено"
  dc down -v
  rm -rf data/files/* data/import-staging/*
  info "Данные разработки удалены"
else
  dc down
  info "Контейнеры остановлены, данные сохранены"
fi
