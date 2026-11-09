#!/usr/bin/env bash
# T08: фактическое восстановление backup в ОТДЕЛЬНЫЙ тестовый контур (non-interactive).
# Поднимает compose project "<project>-restoretest" с собственными томом БД и каталогами
# restore-test/, восстанавливает БД и файлы, запускает приложение в роли standby и проверяет:
#   1) readiness /api/health. 2) вход пользователя. 3) контрольные счётчики записей (manifest).
#   4) контрольный файл: SHA-256 восстановленного документа совпадает с documents.checksum
#      (и при возможности — выдача через API с проверкой прав).
# Учётные данные для проверки входа: RESTORE_TEST_LOGIN/RESTORE_TEST_PASSWORD
# (по умолчанию SEED_MANAGER_LOGIN/SEED_MANAGER_PASSWORD из .env).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env

ID=""; KEEP=0
for a in "$@"; do case "$a" in --keep) KEEP=1 ;; *) ID="$a" ;; esac; done
if [ -z "$ID" ]; then
  ID="$(ls -1 backups 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$' | sort | tail -1 || true)"
  [ -n "$ID" ] || fail "нет локальных backup — сначала ./scripts/backup.sh"
fi
[ -d "backups/$ID" ] || fail "backup не найден: backups/$ID"

MAIN_PROJECT="$(env_value COMPOSE_PROJECT_NAME)"; MAIN_PROJECT="${MAIN_PROJECT:-crm}"
RT_PROJECT="${MAIN_PROJECT}-restoretest"
RT_PORT="${RESTORE_TEST_PORT:-18080}"
RT_ENV="$ROOT_DIR/restore-test/.env"
[ ! -e "$ROOT_DIR/restore-test" ] || fail "restore-test уже существует: остановите прежний тестовый контур и сохраните его результаты"
mkdir -p restore-test/data/files restore-test/data/import-staging restore-test/backups
cp -a "backups/$ID" "restore-test/backups/$ID"
grep -vE '^(COMPOSE_PROJECT_NAME|APP_PORT|APP_BIND|INSTANCE_ID|INSTANCE_ROLE)=' "$ENV_FILE" > "$RT_ENV"
{ echo "COMPOSE_PROJECT_NAME=$RT_PROJECT"; echo "APP_PORT=$RT_PORT"; echo "APP_BIND=127.0.0.1"; echo "INSTANCE_ID=restore-test"; echo "INSTANCE_ROLE=standby"; } >> "$RT_ENV"
chmod 600 "$RT_ENV"

rt() { docker compose -p "$RT_PROJECT" --env-file "$RT_ENV" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.restore-test.yaml" "$@"; }
rt_wait() {
  local service="$1" timeout="${2:-120}" waited=0 cid status
  while [ "$waited" -lt "$timeout" ]; do
    cid="$(rt ps -q "$service" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      [ "$status" = "healthy" ] && return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}
cleanup() { if [ "$KEEP" = 0 ]; then rt down -v >/dev/null 2>&1 || true; rm -rf "$ROOT_DIR/restore-test"; fi; }
trap cleanup EXIT

START_TS=$(date +%s)
REPORT_DIR="$ROOT_DIR/backups/restore-test-reports"; mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/T08-$ID.txt"
results=()
check() { results+=("$1: $2"); printf '  %-28s %s\n' "$1" "$2"; }

info "Тестовый контур $RT_PROJECT (порт $RT_PORT), backup $ID"
rt up -d db >/dev/null
rt_wait db 120 || fail "PostgreSQL тестового контура не стартовала"
rt --profile ops run --rm -T backup restore-data.sh "$ID" --confirm || fail "восстановление БД/файлов не выполнено"
check "restore_db_files" "PASS"
rt run --rm -T migrate >/dev/null || fail "migrate после восстановления завершился ошибкой"
check "migrations_compat" "PASS"
rt up -d --no-deps app >/dev/null
URL="http://127.0.0.1:$RT_PORT"
ok=0; for _ in $(seq 1 120); do if curl -fsS "$URL/api/health/ready" >/dev/null 2>&1; then ok=1; break; fi; sleep 2; done
[ "$ok" = 1 ] && check "readiness" "PASS" || { check "readiness" "FAIL"; exit 1; }

LOGIN="${RESTORE_TEST_LOGIN:-$(env_value SEED_MANAGER_LOGIN)}"; LOGIN="${LOGIN:-manager}"
PASS="${RESTORE_TEST_PASSWORD:-$(env_value SEED_MANAGER_PASSWORD)}"
JAR="$ROOT_DIR/restore-test/login.cookies"
LOGIN_RESPONSE="$ROOT_DIR/restore-test/login-response.json"
LOGIN_JSON="$(printf '%s\n%s\n' "$LOGIN" "$PASS" | rt exec -T app node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const [login,password]=s.trimEnd().split("\n");process.stdout.write(JSON.stringify({login,password}))})')"
HTTP="$(printf '%s' "$LOGIN_JSON" | curl -s -o "$LOGIN_RESPONSE" -w '%{http_code}' -c "$JAR" -H 'content-type: application/json' -H "origin: $URL" -X POST "$URL/api/v1/auth/login" --data-binary @- || true)"
unset PASS LOGIN_JSON
MUST_CHANGE="$(rt exec -T app node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).mustChangePassword??""))}catch{}})' < "$LOGIN_RESPONSE")"
rm -f "$LOGIN_RESPONSE"
if [ "$HTTP" = 200 ]; then check "login" "PASS ($LOGIN)"; else check "login" "FAIL (HTTP $HTTP; задайте RESTORE_TEST_LOGIN/RESTORE_TEST_PASSWORD)"; fi

# Контрольный файл: первый неархивный документ с checksum.
DOC_LINE="$(rt --profile ops run --rm -T backup sh -c "psql -X -qtA -F '|' -c \"SELECT id, storage_key, checksum FROM documents WHERE checksum IS NOT NULL ORDER BY created_at LIMIT 1\"" 2>/dev/null | tail -1 || true)"
if [ -n "$DOC_LINE" ]; then
  DOC_ID="${DOC_LINE%%|*}"; REST="${DOC_LINE#*|}"; KEY="${REST%%|*}"; SUM="${REST#*|}"
  FILE_SUM="$(sha256sum "restore-test/data/files/$KEY" 2>/dev/null | cut -d' ' -f1 || true)"
  [ "$FILE_SUM" = "$SUM" ] && check "control_file_storage" "PASS" || check "control_file_storage" "FAIL"
  if [ "$HTTP" = 200 ] && [ "$MUST_CHANGE" != "true" ]; then
    API_SUM="$(curl -fsS -b "$JAR" "$URL/api/v1/documents/$DOC_ID/download" | sha256sum | cut -d' ' -f1 || true)"
    [ "$API_SUM" = "$SUM" ] && check "control_file_api" "PASS" || check "control_file_api" "FAIL"
  fi
else
  check "control_file_storage" "FAIL (в копии нет контрольного документа)"
fi
rt --profile ops run --rm -T backup sh -c 'psql -X -qtA -F "|" -v ON_ERROR_STOP=1 -c "SELECT storage_key, checksum FROM documents UNION ALL SELECT thumbnail_storage_key, NULL FROM documents WHERE thumbnail_storage_key IS NOT NULL"' > "$ROOT_DIR/restore-test/media-checks.txt"
MEDIA_OK=1; MEDIA_COUNT=0
while IFS='|' read -r key checksum; do
  [ -n "$key" ] || continue
  [ -f "restore-test/data/files/$key" ] || { MEDIA_OK=0; continue; }
  MEDIA_COUNT=$((MEDIA_COUNT + 1))
  if [ -n "$checksum" ]; then
    actual="$(sha256sum "restore-test/data/files/$key" | cut -d' ' -f1)"
    [ "$actual" = "$checksum" ] || MEDIA_OK=0
  fi
done < "$ROOT_DIR/restore-test/media-checks.txt"
[ "$MEDIA_OK" = 1 ] && check "gallery_files" "PASS ($MEDIA_COUNT files)" || check "gallery_files" "FAIL"
if TEMPLATE_RESULT="$(rt exec -T app node node_modules/tsx/dist/cli.mjs scripts/ops-verify-template-files.ts)"; then
  check "template_files" "PASS ($TEMPLATE_RESULT)"
else
  check "template_files" "FAIL"
fi
if find restore-test/data/files -name 'crm-browser-session-*' -print -quit | grep -q .; then
  check "temporary_profiles_excluded" "FAIL"
else
  check "temporary_profiles_excluded" "PASS"
fi
rm -f "$JAR"
check "control_row_counts" "PASS (сверены restore-data.sh)"
check "duration_sec" "$(( $(date +%s) - START_TS ))"

{
  echo "T08 restore test"
  echo "backup_id: $ID"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "app_commit: $(git_commit)"
  printf '%s\n' "${results[@]}"
} > "$REPORT"
if printf '%s\n' "${results[@]}" | grep -q 'FAIL'; then fail "T08: есть непройденные проверки (отчёт $REPORT)"; fi
info "T08 PASS — отчёт: $REPORT"
