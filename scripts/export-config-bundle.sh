#!/usr/bin/env bash



set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_env
OUT="${1:-deployment-config.enc}"
command -v openssl >/dev/null || fail "нужен openssl"
KEYS='^(DEPLOYMENT_ID|DEPLOYMENT_MODE|APP_TIMEZONE|BACKUP_TARGETS|BACKUP_MANDATORY_TARGETS|BACKUP_REMOTE_RETENTION_DAILY|SESSION_TTL_HOURS|MAX_UPLOAD_MB|UPLOAD_ALLOWED_EXTENSIONS|REACTIVATION_GAP_DAYS|NEED_INACTIVITY_DAYS|AGREEMENT_EXPIRY_WARNING_DAYS|AD_CHECK_INTERVAL_DAYS|APP_VERSION)='
{ grep -E "$KEYS" "$ENV_FILE"; echo "CONFIG_SCHEMA_VERSION=1"; } | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -out "$OUT"
info "Создан $OUT (AES-256, PBKDF2). Реплицируйте его в off-site targets; пароль bundle храните отдельно."
