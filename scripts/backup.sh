#!/usr/bin/env bash





set -euo pipefail
. "$(dirname "$0")/lib.sh"

require_docker
require_env

TRIGGER="manual"; TARGETS=""
while [ $
  case "$1" in
    --local) shift ;;
    --targets) TARGETS="$2"; shift 2 ;;
    --target) TARGETS="$2"; shift 2 ;;
    --trigger) TRIGGER="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) fail "неизвестный аргумент: $1" ..
  esac
done

dc up -d db >/dev/null
wait_healthy db 120 || fail "PostgreSQL недоступна"
ID="$(backup_run backup.sh --trigger "$TRIGGER" | tail -1)"
[ -n "$ID" ] || fail "backup не создан"
backup_run verify.sh "$ID" >/dev/null || fail "созданный backup $ID не прошёл проверку"
info "Локальный backup создан и проверен: backups/$ID"

if [ -n "$TARGETS" ]; then
  if backup_run replicate.sh "$ID" --targets "$TARGETS"; then
    info "Off-site репликация $ID завершена"
  else
    warn "Off-site репликация завершилась с ошибками; локальная копия $ID остаётся валидной (см. ./scripts/backup-retry.sh)"
    exit 2
  fi
fi
echo "$ID"
