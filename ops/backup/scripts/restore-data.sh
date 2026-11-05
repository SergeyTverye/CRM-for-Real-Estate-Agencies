#!/usr/bin/env bash
# Восстановление PostgreSQL и файлового хранилища из локального backup-набора.
# Вызывается хостовым scripts/restore.sh (production, с подтверждением)
# либо scripts/restore-test.sh (изолированный тестовый контур T08). Приложение должно быть остановлено.
# Использование: restore-data.sh <backup_id> --confirm
set -euo pipefail
. "$(dirname "$0")/common.sh"

ID="${1-}"
[ "${2-}" = "--confirm" ] || die "восстановление разрушает текущие данные: требуется аргумент --confirm"
DIR="$(backup_path "$ID")"
"$(dirname "$0")/verify.sh" "$ID" >/dev/null

log "восстановление PostgreSQL из $ID"
# Чистая схема: удаляем public и восстанавливаем объекты из dump в одной транзакции.
psql_q -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" >/dev/null
pg_restore --no-owner --no-privileges --single-transaction --exit-on-error -d "$PGDATABASE" "$DIR/database.dump"

log "восстановление файлов"
mkdir -p "$FILES_DIR"
find "$FILES_DIR" -mindepth 1 -delete
# Bind-mount roots on Docker Desktop do not support restoring Unix owner/mode/mtime.
zstd -q -dc "$DIR/files.tar.zst" | tar --strip-components=1 --no-same-owner --no-same-permissions --no-overwrite-dir --touch -C "$FILES_DIR" -xf -
if [ -s "$DIR/files.sha256" ]; then
  (cd "$FILES_DIR" && sha256sum --quiet -c "$DIR/files.sha256") || die "контрольные суммы восстановленных файлов не совпадают"
fi

# Восстановленная копия содержит свою запись backup_runs в состоянии running — фиксируем успех.
psql_q -c "UPDATE backup_runs SET local_status='success', finished_at=COALESCE(finished_at, now()) WHERE backup_id=$(sql_lit "$ID") AND local_status='running'" >/dev/null || true
psql_q -c "UPDATE backup_runs SET local_status='failed', error_summary='прервано: состояние на момент снимка' WHERE local_status='running'" >/dev/null || true

# Сверка контрольных счётчиков manifest.
mismatch=0
while IFS=$'\t' read -r table expected; do
  [ -n "$table" ] || continue
  actual="$(psql_q -c "SELECT count(*) FROM \"$table\"")"
  if [ "$actual" != "$expected" ]; then log "расхождение $table: ожидалось $expected, получено $actual"; mismatch=1; fi
done < <(jq -r '.control.row_counts // {} | to_entries[] | "\(.key)\t\(.value)"' "$DIR/manifest.json")
want_files="$(jq -r '.components[] | select(.name=="files.tar.zst") | .files_count // empty' "$DIR/manifest.json")"
have_files="$(find "$FILES_DIR" -type f | wc -l | tr -d ' ')"
if [ -n "$want_files" ] && [ "$want_files" != "$have_files" ]; then log "расхождение числа файлов: ожидалось $want_files, получено $have_files"; mismatch=1; fi
[ "$mismatch" = 0 ] || die "контрольные данные после восстановления не совпадают с manifest"
log "восстановление $ID завершено, контрольные счётчики совпадают"
echo "restored"
