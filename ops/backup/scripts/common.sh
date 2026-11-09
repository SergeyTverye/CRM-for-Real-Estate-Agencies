#!/usr/bin/env bash


set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
FILES_DIR="${FILES_DIR:-/data/files}"
export PGHOST="${PGHOST:-${POSTGRES_HOST:-db}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-crm}}"
export PGUSER="${PGUSER:-${POSTGRES_USER:-crm}}"
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
export PGCONNECT_TIMEOUT=10

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ОШИБКА: $*"; exit 1; }

psql_q() { psql -X -v ON_ERROR_STOP=1 -qtA "$@"; }


sql_lit() {
  if [ -z "${1-}" ]; then printf 'NULL'; else printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; fi
}

is_valid_backup_id() { [[ "${1-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]]; }

backup_path() {
  local id="$1"
  is_valid_backup_id "$id" || die "некорректный backup_id: $id"
  printf '%s/%s' "$BACKUP_DIR" "$id"
}

db_available() { psql_q -c 'SELECT 1' >/dev/null 2>&1; }

# Запись состояния BackupRun (best effort: отсутствие БД не должно ломать сам backup).
record_run_start() {
  local id="$1" trigger="$2" initiator="${3-}"
  db_available || return 0
  psql_q -c "INSERT INTO backup_runs (backup_id, deployment_id, started_at, trigger_type, local_status, initiated_by_user_id, app_version)
             VALUES ($(sql_lit "$id"), $(sql_lit "$DEPLOYMENT_ID"), now(), $(sql_lit "$trigger"), 'running', $( [ -n "$initiator" ] && sql_lit "$initiator" || printf NULL ), $(sql_lit "${APP_VERSION:-dev}+${APP_COMMIT:-unknown}"))
             ON CONFLICT (backup_id) DO NOTHING" >/dev/null || log "не удалось записать backup_runs (start)"
}

record_run_finish() {
  local id="$1" status="$2" dump_size="${3-}" files_size="${4-}" manifest_sha="${5-}" schema="${6-}" err="${7-}"
  db_available || return 0
  psql_q -c "UPDATE backup_runs SET local_status=$(sql_lit "$status"), finished_at=now(),
               database_dump_size=$( [ -n "$dump_size" ] && printf '%s' "$dump_size" || printf NULL ),
               files_archive_size=$( [ -n "$files_size" ] && printf '%s' "$files_size" || printf NULL ),
               manifest_sha256=$(sql_lit "$manifest_sha"), schema_version=$(sql_lit "$schema"),
               error_summary=$(sql_lit "$err")
             WHERE backup_id=$(sql_lit "$id")" >/dev/null || log "не удалось записать backup_runs (finish)"
}

file_size() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }
