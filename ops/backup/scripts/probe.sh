#!/usr/bin/env bash
# Compatibility probe BackupRemote (ТЗ 39.2): list → write → read → delete временного объекта через crypt-слой.
# Обязательна перед включением профиля СберДиск и при подключении нового target.
#   probe.sh <code>
set -uo pipefail
. "$(dirname "$0")/common.sh"
CODE="${1-}"
[[ "$CODE" =~ ^[a-z0-9][a-z0-9_-]{1,40}$ ]] || die "укажите код target"
export RCLONE_CONFIG="${RCLONE_CONFIG:-/secrets/rclone.conf}"
RC=(rclone --config "$RCLONE_CONFIG" --stats 0)
TMP="$(mktemp -d)"; NAME="probe-$(date -u +%Y%m%d%H%M%S)-$$.txt"
echo "crm probe $(date -u +%FT%TZ)" > "$TMP/$NAME"
status="ok"
"${RC[@]}" mkdir "$CODE-crypt:" >/dev/null 2>&1 || true
"${RC[@]}" lsf "$CODE-crypt:" >/dev/null 2>&1 || status="list_failed"
[ "$status" = ok ] && { "${RC[@]}" copyto "$TMP/$NAME" "$CODE-crypt:.probe/$NAME" >/dev/null 2>&1 || status="write_failed"; }
[ "$status" = ok ] && { "${RC[@]}" cat "$CODE-crypt:.probe/$NAME" 2>/dev/null | cmp -s - "$TMP/$NAME" || status="read_failed"; }
[ "$status" = ok ] && { "${RC[@]}" deletefile "$CODE-crypt:.probe/$NAME" >/dev/null 2>&1 || status="delete_failed"; }
rm -rf "$TMP"
if db_available; then
  psql_q -c "UPDATE backup_remotes SET last_probe_at=now(), probe_status=$(sql_lit "$status"), updated_at=now() WHERE remote_code=$(sql_lit "$CODE")" >/dev/null || true
fi
log "probe $CODE: $status"
[ "$status" = ok ]
