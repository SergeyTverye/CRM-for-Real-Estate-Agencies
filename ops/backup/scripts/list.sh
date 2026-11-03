#!/usr/bin/env bash
# Список локальных backup-наборов с краткими сведениями из manifest.
set -euo pipefail
. "$(dirname "$0")/common.sh"
for d in "$BACKUP_DIR"/*/; do
  d="${d%/}"; b="$(basename "$d")"
  is_valid_backup_id "$b" || continue
  [ -f "$d/manifest.json" ] || { printf '%s\t(нет manifest)\n' "$b"; continue; }
  jq -r '[.backup_id, .trigger_type, .schema_version, (.components|map(.size)|add|tostring)+"B"] | @tsv' "$d/manifest.json"
done
