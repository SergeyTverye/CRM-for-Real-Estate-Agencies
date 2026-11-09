#!/usr/bin/env bash
# Off-site репликация логического backup_id в BackupRemote (ТЗ 39, FR-34, FR-36, NFR-19/20/25).
#
#
# Каждый target описан в rclone.conf (каталог секретов, не в БД/Git/backup-наборе):
#   [<code>]        — транспорт (s3 — Yandex Object Storage, webdav — Облако Mail.ru, local — диск/NAS)
#   [<code>-crypt]  — rclone crypt поверх <code>: шифруются содержимое, имена файлов и каталогов.
# Набор шифруется на стороне узла CRM до передачи провайдеру. Статус upload/verification хранится
# отдельно по каждому target (backup_target_runs). ошибка одного target не влияет на другие и на
# локальную копию. Повтор (--failed-only) не создаёт новый снимок. verified = чтение через crypt-слой
# + совпадение SHA-256 manifest/checksums.
set -uo pipefail
. "$(dirname "$0")/common.sh"

ID=""; TARGETS=""; FAILED_ONLY=0; VERIFY_ONLY=0; LIST=0; DOWNLOAD_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --targets|--target) TARGETS="$2"; shift 2 ;;
    --failed-only) FAILED_ONLY=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --list) LIST=1; shift ;;
    --download-from) DOWNLOAD_FROM="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) ID="$1". shift ..
  esac
done

if [ -z "${BACKUP_TARGETS:-}" ] && [ -z "$DOWNLOAD_FROM" ] && [ "$LIST" = 0 ]; then
  log "off-site targets не настроены (BACKUP_TARGETS пуст) — пропуск"
  exit 0
fi
[ -f "${RCLONE_CONFIG:-/secrets/rclone.conf}" ] || die "rclone.conf не найден (${RCLONE_CONFIG:-/secrets/rclone.conf}) — см. scripts/backup-remote-add.sh"
export RCLONE_CONFIG="${RCLONE_CONFIG:-/secrets/rclone.conf}"
RC=(rclone --config "$RCLONE_CONFIG" --retries 3 --low-level-retries 5 --stats 0)
[ -n "${RCLONE_CONFIG_PASS:-}" ] && export RCLONE_CONFIG_PASS

resolve_targets() {
  if [ "$TARGETS" = "all" ] || [ -z "$TARGETS" ]; then echo "${BACKUP_TARGETS:-}" | tr ',' '\n'; else echo "$TARGETS" | tr ',' '\n'; fi | sed 's/ //g' | grep -E '^[a-z0-9][a-z0-9_-]{1,40}$' || true
}

provider_of() {
  local type
  type="$("${RC[@]}" config show "$1" 2>/dev/null | awk -F' = ' '/^type/{print $2; exit}')"
  case "$type" in
    s3) echo "yandex_s3 s3" ;;
    webdav) echo "mailru_webdav webdav" ;;
    local|alias|sftp) echo "filesystem filesystem" ;;
    *) echo "other other" ..
  esac
}

is_mandatory() { case ",${BACKUP_MANDATORY_TARGETS:-}," in *",$1,"*) echo true ;; *) echo false ;; esac; }

upsert_remote() {
  local code="$1" provider transport
  read -r provider transport <<<"$(provider_of "$code")"
  db_available || { echo ""; return; }
  psql_q -c "INSERT INTO backup_remotes (remote_code, display_name, provider_type, transport_type, is_enabled, is_mandatory, config_ref, remote_prefix, retention_daily, updated_at)
             VALUES ($(sql_lit "$code"), $(sql_lit "$code"), $(sql_lit "$provider"), $(sql_lit "$transport"), true, $(is_mandatory "$code"), $(sql_lit "$code-crypt"), NULL, ${BACKUP_REMOTE_RETENTION_DAILY:-14}, now())
             ON CONFLICT (remote_code) DO UPDATE SET provider_type=EXCLUDED.provider_type, transport_type=EXCLUDED.transport_type,
               is_mandatory=EXCLUDED.is_mandatory, config_ref=EXCLUDED.config_ref, updated_at=now()
             RETURNING id" | head -1
}

target_run() {
  local run_id="$1" remote_id="$2" fields="$3"
  [ -n "$run_id" ] && [ -n "$remote_id" ] || return 0
  psql_q -c "INSERT INTO backup_target_runs (backup_run_id, backup_remote_id, upload_status, verify_status, updated_at)
             VALUES ('$run_id', '$remote_id', 'pending', 'not_verified', now()) ON CONFLICT (backup_run_id, backup_remote_id) DO NOTHING" >/dev/null
  psql_q -c "UPDATE backup_target_runs SET $fields, updated_at=now() WHERE backup_run_id='$run_id' AND backup_remote_id='$remote_id'" >/dev/null
}

current_upload_status() {
  local run_id="$1" remote_id="$2"
  [ -n "$run_id" ] && [ -n "$remote_id" ] || { echo ""; return; }
  psql_q -c "SELECT upload_status || ':' || verify_status FROM backup_target_runs WHERE backup_run_id='$run_id' AND backup_remote_id='$remote_id'"
}

# Безопасная диагностика: последняя строка ошибки rclone без URL с параметрами и без токенов.
sanitize_err() { tail -3 | tr '\n' ' ' | sed -E 's#(https?://)[^ ]+#\1…#g; s/(token|key|pass(word)?|secret)[=:][^ ]+/\1=***/Ig' | cut -c1-500; }

verify_remote() {
  local code="$1" dir="$2" tmp
  tmp="$(mktemp -d)"
  # Чтение через crypt-слой: manifest и checksums расшифровываются и сверяются с локальными.
  if ! "${RC[@]}" copy "$code-crypt:$ID" "$tmp" --include manifest.json --include checksums.sha256 2>"$tmp/err.log"; then
    sanitize_err <"$tmp/err.log"; rm -rf "$tmp"; return 1
  fi
  if ! cmp -s "$tmp/manifest.json" "$dir/manifest.json" || ! cmp -s "$tmp/checksums.sha256" "$dir/checksums.sha256"; then
    echo "manifest/checksums на target не совпадают с локальной копией"; rm -rf "$tmp"; return 1
  fi
  # Целостность больших компонентов: сверка хэшей зашифрованного содержимого.
  if ! "${RC[@]}" cryptcheck "$dir" "$code-crypt:$ID" --one-way 2>"$tmp/err.log"; then
    sanitize_err <"$tmp/err.log"; rm -rf "$tmp"; return 1
  fi
  rm -rf "$tmp"
  return 0
}

if [ "$LIST" = 1 ]; then
  for code in $(resolve_targets); do
    echo "== $code"
    "${RC[@]}" lsf "$code-crypt:" --dirs-only 2>/dev/null | sed 's#/$##' | sort -r || echo "(недоступен)"
  done
  exit 0
fi

DIR="$(backup_path "$ID")"

if [ -n "$DOWNLOAD_FROM" ]; then
  [[ "$DOWNLOAD_FROM" =~ ^[a-z0-9][a-z0-9_-]{1,40}$ ]] || die "некорректный код remote"
  [ -e "$DIR" ] && die "локальный каталог $ID уже существует — удалите его или используйте --source local"
  log "загрузка $ID из $DOWNLOAD_FROM через crypt-слой"
  mkdir -p "$DIR"
  "${RC[@]}" copy "$DOWNLOAD_FROM-crypt:$ID" "$DIR" || { rm -rf "$DIR"; die "не удалось загрузить копию из $DOWNLOAD_FROM"; }
  "$(dirname "$0")/verify.sh" "$ID" || { rm -rf "$DIR"; die "загруженная копия не прошла проверку"; }
  exit 0
fi

[ -d "$DIR" ] || die "локальная копия $ID не найдена"
"$(dirname "$0")/verify.sh" "$ID" >/dev/null || die "локальная копия $ID не прошла проверку — репликация отменена"
RUN_ID=""
db_available && RUN_ID="$(psql_q -c "SELECT id FROM backup_runs WHERE backup_id=$(sql_lit "$ID")")"

FAILED=0
for code in $(resolve_targets); do
  REMOTE_ID="$(upsert_remote "$code")"
  STATE="$(current_upload_status "$RUN_ID" "$REMOTE_ID")"
  if [ "$FAILED_ONLY" = 1 ] && [ "${STATE%%:*}" = "uploaded" ] && [ "${STATE##*:}" = "verified" ]; then
    log "$code: уже verified — пропуск"; continue
  fi
  if ! "${RC[@]}" listremotes 2>/dev/null | grep -qx "$code-crypt:"; then
    log "$code: в rclone.conf нет $code-crypt — target пропущен"
    target_run "$RUN_ID" "$REMOTE_ID" "upload_status='skipped', error_code='NOT_CONFIGURED', error_summary='нет crypt-конфигурации', finished_at=now()"
    FAILED=1; continue
  fi
  if [ "$VERIFY_ONLY" = 0 ]; then
    log "$code: загрузка $ID (client-side encryption)"
    target_run "$RUN_ID" "$REMOTE_ID" "upload_status='uploading', attempt_count=attempt_count+1, started_at=now(), error_code=NULL, error_summary=NULL"
    ERRF="$(mktemp)"
    if "${RC[@]}" copy "$DIR" "$code-crypt:$ID" 2>"$ERRF"; then
      BYTES="$(du -sb "$DIR" | cut -f1)"
      target_run "$RUN_ID" "$REMOTE_ID" "upload_status='uploaded', finished_at=now(), bytes_uploaded=$BYTES, remote_backup_ref=$(sql_lit "$ID")"
    else
      MSG="$(sanitize_err <"$ERRF")"
      target_run "$RUN_ID" "$REMOTE_ID" "upload_status='failed', finished_at=now(), error_code='UPLOAD_FAILED', error_summary=$(sql_lit "$MSG")"
      log "$code: ошибка загрузки: $MSG"; FAILED=1; rm -f "$ERRF"; continue
    fi
    rm -f "$ERRF"
  fi
  target_run "$RUN_ID" "$REMOTE_ID" "verify_status='verifying'"
  if MSG="$(verify_remote "$code" "$DIR")"; then
    target_run "$RUN_ID" "$REMOTE_ID" "verify_status='verified', verified_at=now()"
    log "$code: verified"
    # Ротация на target — только после появления новой verified копии. текущая не удаляется.
    KEEP="${BACKUP_REMOTE_RETENTION_DAILY:-14}"
    mapfile -t OLD < <("${RC[@]}" lsf "$code-crypt:" --dirs-only 2>/dev/null | sed 's#/$##' | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_' | sort -r | tail -n +$((KEEP + 1)))
    for o in "${OLD[@]}"; do [ "$o" != "$ID" ] && "${RC[@]}" purge "$code-crypt:$o" 2>/dev/null && log "$code: ротация — удалена $o"; done
  else
    target_run "$RUN_ID" "$REMOTE_ID" "verify_status='failed', error_code='VERIFY_FAILED', error_summary=$(sql_lit "$MSG")"
    log "$code: проверка не пройдена: $MSG"; FAILED=1
  fi
done
[ "$FAILED" = 0 ] || exit 2
exit 0
