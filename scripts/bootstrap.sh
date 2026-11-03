#!/usr/bin/env bash
# Первичная подготовка узла (ТЗ 36.4): проверка Docker/Compose, каталоги данных,
# .env из .env.example с безопасно сгенерированными секретами, проверка конфигурации.
# Существующий .env не перезаписывается.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

require_docker

mkdir -p data/files data/import-staging backups secrets
chmod 700 secrets
# Контейнеры app/migrate/backup работают от владельца каталогов данных (APP_UID/APP_GID).
if [ "$(id -u)" = "0" ]; then
  RUN_UID=1000; RUN_GID=1000
  chown -R "$RUN_UID:$RUN_GID" data backups
else
  RUN_UID="$(id -u)"; RUN_GID="$(id -g)"
fi

rand_secret() {
  local s
  s="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 22)"
  printf '%s%s' "$s" "$(LC_ALL=C tr -dc '0-9' </dev/urandom | head -c 2)"
}

new_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  else
    local h; h="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
    printf '%s-%s-4%s-%x%s-%s\n' "${h:0:8}" "${h:8:4}" "${h:13:3}" $(( (0x${h:16:1} & 0x3) | 0x8 )) "${h:17:3}" "${h:20:12}"
  fi
}

set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" 'BEGIN{done=0} $0 ~ "^"k"=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
}

if [ -f "$ENV_FILE" ]; then
  info ".env уже существует — секреты не перегенерируются."
else
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  PGPASS="$(rand_secret)"
  set_env POSTGRES_PASSWORD "$PGPASS"
  set_env DATABASE_URL "postgresql://$(env_value POSTGRES_USER):${PGPASS}@db:5432/$(env_value POSTGRES_DB)"
  set_env DEPLOYMENT_ID "$(new_uuid)"
  set_env INSTANCE_ID "$(hostname -s 2>/dev/null || echo node)-$(new_uuid | cut -c1-8)"
  set_env SEED_MANAGER_PASSWORD "$(rand_secret)"
  set_env SEED_REALTOR1_PASSWORD "$(rand_secret)"
  set_env SEED_REALTOR2_PASSWORD "$(rand_secret)"
  set_env APP_UID "$RUN_UID"
  set_env APP_GID "$RUN_GID"
  info "Создан .env с новыми секретами (права 600)."
  info "Первичные пароли учётных записей: SEED_*_PASSWORD в .env (смена при первом входе)."
fi

dc config -q || fail "Конфигурация Docker Compose невалидна — проверьте .env"
info "Конфигурация корректна. Следующий шаг: ./scripts/deploy.sh"
