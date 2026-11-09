#!/usr/bin/env bash




set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env

SOURCE="local"; ID=""; YES=0; VERIFY_ONLY=0
while [ $
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --backup) ID="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) ID="$(basename "$1")". shift ..
  esac
done
[ -n "$ID" ] || fail "укажите backup_id"

dc up -d db >/dev/null
wait_healthy db 120 || fail "PostgreSQL недоступна"

if [ "$SOURCE" != "local" ]; then
  info "Загрузка $ID из remote $SOURCE через crypt-слой…"
  backup_run replicate.sh "$ID" --download-from "$SOURCE"
fi
backup_run verify.sh "$ID" || fail "backup $ID не прошёл проверку — восстановление невозможно"
if [ "$VERIFY_ONLY" = 1 ]; then info "Проверка $ID пройдена (--verify-only)"; exit 0; fi

if [ "$YES" != 1 ]; then
  warn "ВНИМАНИЕ: текущие данные БД и файлов будут ЗАМЕНЕНЫ содержимым копии $ID."
  printf 'Для подтверждения введите идентификатор копии (%s): ' "$ID"
  read -r answer
  [ "$answer" = "$ID" ] || fail "подтверждение не получено — восстановление отменено"
fi

info "Защитный snapshot текущих данных…"
PROTECT_ID="$(backup_run backup.sh --trigger pre_migration | tail -1)" || fail "не удалось создать защитный snapshot"
info "Защитный snapshot: backups/$PROTECT_ID"

info "Остановка приложения…"
dc stop app worker >/dev/null 2>&1 || true
backup_run restore-data.sh "$ID" --confirm || fail "восстановление завершилось ошибкой; защитная копия: $PROTECT_ID"
dc run --rm migrate >/dev/null || fail "проверка миграций после восстановления не пройдена"
dc up -d --no-deps app worker
wait_healthy app 240 || fail "приложение после восстановления не прошло healthcheck"
info "Восстановление из $ID завершено: $(app_url)"
