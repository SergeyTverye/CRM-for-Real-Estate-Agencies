#!/usr/bin/env bash
# Проверка локального backup-набора (ТЗ 39.8): checksums, manifest, читаемость dump и архива.
# Использование: verify.sh <backup_id>
set -euo pipefail
. "$(dirname "$0")/common.sh"

ID="${1-}"
DIR="$(backup_path "$ID")"
[ -d "$DIR" ] || die "backup не найден: $ID"
for f in database.dump files.tar.zst manifest.json checksums.sha256; do [ -f "$DIR/$f" ] || die "отсутствует компонент $f"; done

(cd "$DIR" && sha256sum --quiet -c checksums.sha256) || die "контрольные суммы не совпадают"
[ "$(jq -r .backup_id "$DIR/manifest.json")" = "$ID" ] || die "backup_id в manifest не совпадает с каталогом"
if [ -n "${DEPLOYMENT_ID:-}" ] && [ "$(jq -r .deployment_id "$DIR/manifest.json")" != "$DEPLOYMENT_ID" ]; then
  log "ВНИМАНИЕ: deployment_id копии отличается от текущего экземпляра"
fi
for c in database.dump files.tar.zst; do
  want="$(jq -r --arg n "$c" '.components[] | select(.name==$n) | .sha256' "$DIR/manifest.json")"
  have="$(sha256sum "$DIR/$c" | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "SHA-256 компонента $c не совпадает с manifest"
done
pg_restore --list "$DIR/database.dump" >/dev/null || die "database.dump не читается pg_restore"
zstd -q -t "$DIR/files.tar.zst" || die "files.tar.zst повреждён"
log "backup $ID: проверка пройдена"
echo "verified"
