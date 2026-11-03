#!/usr/bin/env bash
# Локальный логический backup (ТЗ 36.4, 39.5): один backup_id = каталог
#   database.dump      — pg_dump custom format
#   files.tar.zst      — архив пользовательских файлов StorageAdapter
#   manifest.json      — backup_id, deployment_id, версия приложения/схемы, PostgreSQL major,
#                        компоненты с размерами и SHA-256, контрольные счётчики строк
#   checksums.sha256   — SHA-256 всех компонентов
# Набор формируется в staging-каталоге и атомарно переименовывается только после
# успешного завершения всех шагов (local_success). Выход: backup_id в stdout.
#
# Использование: backup.sh [--trigger scheduled|manual|pre_update|pre_migration|shutdown] [--initiated-by <user uuid>]
set -euo pipefail
. "$(dirname "$0")/common.sh"

TRIGGER="manual"
INITIATOR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --trigger) TRIGGER="$2"; shift 2 ;;
    --initiated-by) INITIATOR="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "неизвестный аргумент: $1" ;;
  esac
done
case "$TRIGGER" in scheduled|manual|pre_update|pre_migration|shutdown) ;; *) die "некорректный trigger: $TRIGGER" ;; esac
[ -n "${DEPLOYMENT_ID:-}" ] || die "DEPLOYMENT_ID не задан"
[ -z "$INITIATOR" ] || [[ "$INITIATOR" =~ ^[0-9a-fA-F-]{36}$ ]] || die "некорректный --initiated-by"

mkdir -p "$BACKUP_DIR"
# Защита от параллельного запуска (ТЗ 37.17).
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || die "backup уже выполняется"

ID="$(date -u +%Y-%m-%d_%H-%M-%S)"
while [ -e "$BACKUP_DIR/$ID" ]; do sleep 1; ID="$(date -u +%Y-%m-%d_%H-%M-%S)"; done
STAGING="$BACKUP_DIR/.staging-$ID"
FINAL="$BACKUP_DIR/$ID"

cleanup_failed() {
  local msg="$1"
  rm -rf "$STAGING"
  record_run_finish "$ID" failed "" "" "" "" "$msg"
  die "$msg"
}

mkdir -p "$STAGING"
record_run_start "$ID" "$TRIGGER" "$INITIATOR"
log "начат backup $ID (trigger=$TRIGGER)"

db_available || cleanup_failed "PostgreSQL недоступна"
pg_dump -Fc --no-owner --no-privileges -f "$STAGING/database.dump" || cleanup_failed "pg_dump завершился ошибкой"

mkdir -p "$FILES_DIR"
tar -C "$FILES_DIR" -cf - . | zstd -q -T0 -3 -o "$STAGING/files.tar.zst" || cleanup_failed "архивация файлов завершилась ошибкой"
zstd -q -t "$STAGING/files.tar.zst" || cleanup_failed "архив файлов не прошёл проверку"

SCHEMA_VERSION="$(psql_q -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1" || true)"
PG_MAJOR="$(psql_q -c "SHOW server_version_num" | cut -c1-2)"
FILES_COUNT="$(find "$FILES_DIR" -type f | wc -l | tr -d ' ')"
# Контрольные счётчики строк для проверки восстановления (не содержат ПДн).
COUNTS_JSON="$(psql_q -c "SELECT json_build_object(
  'users', (SELECT count(*) FROM users),
  'clients', (SELECT count(*) FROM clients),
  'client_needs', (SELECT count(*) FROM client_needs),
  'lead_requests', (SELECT count(*) FROM lead_requests),
  'properties', (SELECT count(*) FROM properties),
  'tasks', (SELECT count(*) FROM tasks),
  'deals', (SELECT count(*) FROM deals),
  'documents', (SELECT count(*) FROM documents),
  'audit_log', (SELECT count(*) FROM audit_log))" 2>/dev/null || echo '{}')"

DUMP_SIZE="$(file_size "$STAGING/database.dump")"
FILES_SIZE="$(file_size "$STAGING/files.tar.zst")"
DUMP_SHA="$(sha256sum "$STAGING/database.dump" | cut -d' ' -f1)"
FILES_SHA="$(sha256sum "$STAGING/files.tar.zst" | cut -d' ' -f1)"

jq -n \
  --arg backup_id "$ID" \
  --arg deployment_id "$DEPLOYMENT_ID" \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg trigger "$TRIGGER" \
  --arg app_version "${APP_VERSION:-dev}" \
  --arg app_commit "${APP_COMMIT:-unknown}" \
  --arg schema_version "$SCHEMA_VERSION" \
  --arg pg_major "$PG_MAJOR" \
  --argjson dump_size "$DUMP_SIZE" --arg dump_sha "$DUMP_SHA" \
  --argjson files_size "$FILES_SIZE" --arg files_sha "$FILES_SHA" --argjson files_count "$FILES_COUNT" \
  --argjson row_counts "$COUNTS_JSON" \
  '{format_version: 1, backup_id: $backup_id, deployment_id: $deployment_id, created_at: $created_at,
    trigger_type: $trigger, app_version: $app_version, app_commit: $app_commit,
    schema_version: $schema_version, postgres_major: ($pg_major|tonumber),
    components: [
      {name: "database.dump", format: "pg_dump custom", size: $dump_size, sha256: $dump_sha},
      {name: "files.tar.zst", format: "tar+zstd", size: $files_size, sha256: $files_sha, files_count: $files_count}
    ],
    control: {row_counts: $row_counts}}' > "$STAGING/manifest.json" || cleanup_failed "не удалось сформировать manifest"

(cd "$STAGING" && sha256sum database.dump files.tar.zst manifest.json > checksums.sha256) || cleanup_failed "не удалось вычислить checksums"
MANIFEST_SHA="$(sha256sum "$STAGING/manifest.json" | cut -d' ' -f1)"

mv "$STAGING" "$FINAL"
record_run_finish "$ID" success "$DUMP_SIZE" "$FILES_SIZE" "$MANIFEST_SHA" "$SCHEMA_VERSION" ""
log "backup $ID создан: dump=${DUMP_SIZE}B files=${FILES_SIZE}B"

# Ротация локальных копий: храним BACKUP_RETENTION_DAILY последних scheduled/manual копий.
# Копии pre_update/pre_migration не удаляются автоматически; текущая копия не удаляется никогда.
KEEP="${BACKUP_RETENTION_DAILY:-14}"
if [[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 1 ]; then
  mapfile -t ROTATABLE < <(
    for d in "$BACKUP_DIR"/*/; do
      d="${d%/}"; b="$(basename "$d")"
      is_valid_backup_id "$b" || continue
      [ "$b" = "$ID" ] && continue
      t="$(jq -r '.trigger_type // "manual"' "$d/manifest.json" 2>/dev/null || echo manual)"
      case "$t" in (scheduled|manual) echo "$b" ;; esac
    done | sort -r
  )
  i=0
  for b in "${ROTATABLE[@]}"; do
    i=$((i + 1))
    if [ "$i" -ge "$KEEP" ]; then rm -rf "${BACKUP_DIR:?}/$b"; log "ротация: удалена старая копия $b"; fi
  done
fi

printf '%s\n' "$ID"
