#!/usr/bin/env bash
# Повтор репликации только в ошибочные targets без создания нового снимка (FR-36):
#   ./scripts/backup-retry.sh <backup_id> --failed-only
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env
ID="${1-}"; [ -n "$ID" ] || fail "укажите backup_id"
backup_run replicate.sh "$ID" --targets all --failed-only
