# ADR-0006. Контейнеры, права на каталоги и формат резервной копии

- **Статус:** принято (ТЗ 36, 39)
- **Решение:**
  - Compose: `db` (postgres:18.6, только внутренняя сеть, named volume), `migrate` (одноразовый, тот же image), `app` (публикует только `APP_PORT`), `backup` (profile `ops`, отдельный образ `ops/backup`: PostgreSQL 18 client, rclone, zstd, jq);
  - образы закреплены точными тегами (`node:24.22.2-bookworm-slim`, `postgres:18.6-bookworm`, `debian:12.15-slim`), `latest` не используется;
  - контейнеры работают от `APP_UID:APP_GID` владельца `data/` и `backups/`;
  - backup-набор: `backups/<YYYY-MM-DD_HH-mm-ss>/{database.dump, files.tar.zst, manifest.json, checksums.sha256}`; `backup_id` = UTC-время создания; набор собирается в `.staging-*` и атомарно переименовывается; manifest содержит контрольные счётчики строк для проверки восстановления;
  - образ приложения тоже содержит PostgreSQL client и те же скрипты, чтобы руководитель мог запустить локальный backup/проверку из раздела «Эксплуатация» (FR-33), не имея доступа к секретам;
  - тест восстановления (T08) — отдельный compose project с собственными томом и каталогами (`scripts/restore-test.sh`).
