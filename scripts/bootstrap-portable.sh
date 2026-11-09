#!/usr/bin/env bash






set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker

BUNDLE=""; RCONF=""; SOURCE="local"; ID=""
while [ $
  case "$1" in
    --config-bundle) BUNDLE="$2"; shift 2 ;;
    --rclone-conf) RCONF="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --backup) ID="$2"; shift 2 ;;
    *) fail "неизвестный аргумент: $1" ..
  esac
done
[ -n "$BUNDLE" ] && [ -f "$BUNDLE" ] || fail "укажите --config-bundle <файл>"
[ -n "$ID" ] || fail "укажите --backup <backup_id> (список: ./scripts/backup-list.sh --remote <code>)"
[ ! -f "$ENV_FILE" ] || fail ".env уже существует — узел не пустой; восстановление поверх рабочих данных выполняйте restore.sh"
command -v openssl >/dev/null || fail "нужен openssl"

info "Расшифровка config bundle…"
CFG="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$BUNDLE")" || fail "не удалось расшифровать bundle (неверный пароль?)"
grep -q '^CONFIG_SCHEMA_VERSION=1$' <<<"$CFG" || fail "несовместимая версия config bundle"

"$ROOT_DIR/scripts/bootstrap.sh" >/dev/null

apply_kv() {
  local k="$1" v="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$k" -v v="$v" 'BEGIN{d=0} $0 ~ "^"k"=" {print k"="v; d=1; next} {print} END{if(!d) print k"="v}' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
}
while IFS='=' read -r k v; do
  [ -n "$k" ] && [ "$k" != "CONFIG_SCHEMA_VERSION" ] && apply_kv "$k" "$v"
done <<<"$CFG"
apply_kv DEPLOYMENT_MODE portable
apply_kv INSTANCE_ROLE standby
apply_kv APP_BIND 127.0.0.1
chmod 600 "$ENV_FILE"
if [ -n "$RCONF" ]; then
  install -m 600 "$RCONF" secrets/rclone.conf
fi

"$ROOT_DIR/scripts/deploy.sh"
info "Восстановление выбранной копии $ID (источник: $SOURCE)…"
"$ROOT_DIR/scripts/restore.sh" --source "$SOURCE" --backup "$ID" --yes
info "Переносимый узел запущен в роли STANDBY (только чтение). Для работы с записью: ./scripts/promote-instance.sh"
