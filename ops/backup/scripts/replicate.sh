#!/usr/bin/env bash
# Off-site репликация backup_id в BackupRemote через rclone crypt (ТЗ 39).
# Реализация — в инкременте I5; без настроенных targets команда ничего не делает.
set -euo pipefail
. "$(dirname "$0")/common.sh"
if [ -z "${BACKUP_TARGETS:-}" ]; then log "off-site targets не настроены (BACKUP_TARGETS пуст)"; exit 0; fi
die "off-site репликация ещё не реализована"
