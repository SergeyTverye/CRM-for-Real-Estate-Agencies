#!/usr/bin/env bash
# Подключение off-site target (ТЗ 39.2, 39.4). Создаёт в secrets/rclone.conf транспорт <code>
# и слой шифрования <code>-crypt со случайными паролем и солью. Облачные credentials берутся из
# переменных окружения оператора на время команды и НЕ записываются в .env, БД или Git.
#
#   ./scripts/backup-remote-add.sh <code> filesystem             (каталог BACKUP_FILESYSTEM_TARGET_PATH, например NAS)
#   YC_ACCESS_KEY_ID=… YC_SECRET_ACCESS_KEY=… YC_BUCKET=… ./scripts/backup-remote-add.sh <code> yandex
#   MAILRU_USER=… MAILRU_APP_PASSWORD=… ./scripts/backup-remote-add.sh <code> mailru
#   SBER_WEBDAV_URL=… SBER_USER=… SBER_PASSWORD=… ./scripts/backup-remote-add.sh <code> sberdisk   (только после probe)
#
# После добавления: допишите <code> в BACKUP_TARGETS в .env и выполните ./scripts/backup-remote-probe.sh <code>.
# Файл secrets/recovery/<code>.txt содержит crypt-пароль и соль — перенесите его на офлайн-носитель:
# без него облачные копии невосстановимы (ТЗ 39.4).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env

CODE="${1-}"; KIND="${2-}"
[[ "$CODE" =~ ^[a-z0-9][a-z0-9_-]{1,40}$ ]] || fail "код target: латиница/цифры/-/_, например nas-main"
mkdir -p secrets/recovery; chmod 700 secrets secrets/recovery
touch secrets/rclone.conf; chmod 600 secrets/rclone.conf

rc() { docker run --rm -i -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$ROOT_DIR/secrets:/secrets" -e RCLONE_CONFIG=/secrets/rclone.conf crm-backup:local rclone "$@"; }
docker image inspect crm-backup:local >/dev/null 2>&1 || dc --profile ops build backup

PREFIX="crm-backups"
case "$KIND" in
  filesystem)
    rc config create "$CODE" alias remote=/remote-store >/dev/null
    BASE="$CODE:$PREFIX" ;;
  yandex)
    : "${YC_ACCESS_KEY_ID:?}" "${YC_SECRET_ACCESS_KEY:?}" "${YC_BUCKET:?}"
    rc config create "$CODE" s3 provider=Other endpoint=https://storage.yandexcloud.net region=ru-central1 \
      access_key_id="$YC_ACCESS_KEY_ID" secret_access_key="$YC_SECRET_ACCESS_KEY" >/dev/null
    BASE="$CODE:$YC_BUCKET/$PREFIX" ;;
  mailru)
    : "${MAILRU_USER:?}" "${MAILRU_APP_PASSWORD:?}"
    rc config create "$CODE" webdav url=https://webdav.cloud.mail.ru vendor=other user="$MAILRU_USER" pass="$MAILRU_APP_PASSWORD" --obscure >/dev/null
    BASE="$CODE:$PREFIX" ;;
  sberdisk)
    : "${SBER_WEBDAV_URL:?}" "${SBER_USER:?}" "${SBER_PASSWORD:?}"
    rc config create "$CODE" webdav url="$SBER_WEBDAV_URL" vendor=other user="$SBER_USER" pass="$SBER_PASSWORD" --obscure >/dev/null
    BASE="$CODE:$PREFIX"
    warn "СберДиск — compatibility profile: включайте в BACKUP_TARGETS только после успешного probe и тестового restore" ;;
  *) fail "тип: filesystem | yandex | mailru | sberdisk" ;;
esac

CRYPT_PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40 || true)"
CRYPT_SALT="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40 || true)"
rc config create "$CODE-crypt" crypt remote="$BASE" filename_encryption=standard directory_name_encryption=true \
  password="$CRYPT_PASS" password2="$CRYPT_SALT" --obscure >/dev/null
umask 077
cat > "secrets/recovery/$CODE.txt" <<REC
CRM off-site backup recovery material — target: $CODE ($KIND)
Создано: $(date -u +%FT%TZ)
rclone crypt: filename_encryption=standard, directory_name_encryption=true
remote: $BASE
password:  $CRYPT_PASS
password2: $CRYPT_SALT
ХРАНИТЕ ЭТОТ ФАЙЛ ОФЛАЙН (сейф/отчуждаемый носитель) отдельно от облака и сервера.
REC
info "Target $CODE добавлен. Recovery material: secrets/recovery/$CODE.txt — перенесите на офлайн-носитель."
info "Добавьте $CODE в BACKUP_TARGETS (.env) и выполните ./scripts/backup-remote-probe.sh $CODE"
