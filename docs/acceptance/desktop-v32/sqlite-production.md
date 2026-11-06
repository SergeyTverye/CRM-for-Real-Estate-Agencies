# Production SQLite acceptance

2026-11-06T21:27:39.046Z

Image: `crm-app:v32-clean-11a2778`; APP_COMMIT: `11a27784bdead108483ca058bfa72179597fb8fe`; Node 24.22.2, Linux Docker. Host orchestrator: v22.23.4.
Fixture: `D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-06T21-24-46-468Z`. Container: `crm-v32-sqliteqa`, loopback 3567, dedicated internal Docker network (no external egress). No PostgreSQL.

**22 PASS / 0 FAIL. Not full Desktop gates / T01–T10 PASS.**

- **PASS image**: {"id":"sha256:965356828d986cddf1f61ffd175e4629b124b0f4e31d9dad2502cbadd2e60d8e","commit":"11a27784bdead108483ca058bfa72179597fb8fe","node":"24.22.2"}
- **PASS clean SQLite migration**
- **PASS readiness**: {"status":"ok","checks":{"database":{"ok":true,"detail":"migrations=2"},"fileStorage":{"ok":true}},"version":"3.2.1+11a27784bdead108483ca058bfa72179597fb8fe","instanceRole":"active","deploymentMode":"server"}
- **PASS first manager via API**: {"id":"76fc8902-3fbe-49a1-bec5-74ef8cc9fdc7","login":"sqliteqa.manager","displayName":"SQLITE-QA manager","role":"manager","mustChangePassword":false}
- **PASS roles and direct denial**: {"realtorLogin":true,"passwordChanged":true,"realtorAdminDenied":true,"realtorArchiveDenied":true,"anonymousAdminDenied":true}
- **PASS create client**: {"id":"4408391e-70a6-4ba0-9b02-8b3930fb6781"}
- **PASS record call**: {"id":"7af1a0d4-f621-4e72-828e-803464373bc5","taskId":null}
- **PASS need plus next task**: {"id":"a1cdd4eb-1232-4680-a477-94db89b4970a","taskId":"6f011933-edb1-423e-8361-b22179e0c5e1"}
- **PASS calendar contains next task**: {"items":1}
- **PASS property**: {"id":"0ddb6c21-3ebd-4bdd-9d66-fa1fe80acd6e"}
- **PASS collection**: {"id":"fd3b4886-7a47-46f4-8027-8f072081d218"}
- **PASS collection to offer**: {"id":"cabaf4fe-d21c-4215-8bf8-6ad6abc48c0e"}
- **PASS DOCX generation and download**: {"id":"40e6b915-ab7d-4e2c-b60a-210700d3a9b2","bytes":11227,"sha256":"ef786a7685318bbfd925b68db20cdbe854d70f35298ac59385ce1bf4257a260e"}
- **PASS PDF rendering**: {"bytes":47868,"sha256":"84a22ff1130bf4f87eabdbc0830c8c0a0d4daddd5702ac861ec8377b08b77d39"}
- **PASS XLSX export**: {"bytes":9279,"sha256":"93b89c4f4e8217753362f9a666f97ac8cd77fc3c18e51e6ab8cf5025478a7ba6"}
- **PASS open data export**: {"bytes":11056,"sha256":"6d6cf7e172981ae72b1975b9915dcf3e2bedbdab270f39a60174097c368c4100"}
- **PASS foreign client and document direct denial**: {"clientDenied":true,"documentDenied":true}
- **PASS artifact structure and synthetic content**: {"docxEntries":17,"xlsxEntries":21,"exportEntries":24,"pdfBytes":47868}
- **PASS SQLite integrity, counts and stored file checksums**: {"counts":{"users":2,"clients":1,"communications":1,"client_needs":1,"tasks":1,"properties":1,"property_collections":1,"commercial_offers":1,"documents":1,"_prisma_migrations":2},"integrity":"ok","foreignKeyErrors":0,"checkedFiles":1}
- **PASS restart persistence and login**: {"existingSession":true,"freshLogin":true,"client":true,"document":true}
- **PASS encrypted generic archive and actual restore**: {"backupId":"bf7cb7bb-e959-45ba-9297-af49e181eaf8","bytes":1860442,"sha256":"53974b8645f39240c497f90faeb718327ade86c88fc78a171d6d24407772cbc7","manifestSha256":"2c768b143b97d74ed621fd8fdf7b37adeab802200aadceba9d4a96c634e9750c","restored":true,"components":["sqlite","settings","documents"]}
- **PASS restored production readiness login client document**: {"readiness":true,"login":true,"client":true,"document":true}

## Reproduce

`node scripts/acceptance/sqlite-production.mjs` (existing named QA container must be absent; script refuses reuse). Existing image only; no install/build/generation. Commands use public desktop scripts mounted read-only; normal runtime, supervised upgrade flag absent.

## Boundaries

Synthetic data only; no private/Excel/existing customer data, root dotenv or pre-existing backups read. Password/passphrase/recovery key remain in process memory, not in protocol. Generic archive API uses stopped single writer, native Linux SQLite and production encryption/restore modules, not DPAPI. No Windows launcher, native picker, supervisor, DPAPI or cloud compatibility claim. Container is stopped and isolated fixture retained.

## Docker commands

```text
docker image inspect crm-app:v32-clean-11a2778
docker ps -a --filter name=^/crm-v32-sqliteqa$ --format {{.Names}}
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-06T21-24-46-468Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=0cf1e6b0-8e87-4ea5-bd1b-c41a6377e149 -e INSTANCE_ID=70b96c92-2df5-44d5-91f0-ccef0181183e -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 --entrypoint node crm-app:v32-clean-11a2778 --import tsx scripts/desktop/init-db.ts --initialize
docker network create --internal crm-v32-sqliteqa-2026-11-06t21-24-46-468z
docker run -d --name crm-v32-sqliteqa --network crm-v32-sqliteqa-2026-11-06t21-24-46-468z -p 127.0.0.1:3567:3567 --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-06T21-24-46-468Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=0cf1e6b0-8e87-4ea5-bd1b-c41a6377e149 -e INSTANCE_ID=70b96c92-2df5-44d5-91f0-ccef0181183e -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 crm-app:v32-clean-11a2778 node_modules/.bin/next start -p 3567 -H 0.0.0.0
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-06T21-24-46-468Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=0cf1e6b0-8e87-4ea5-bd1b-c41a6377e149 -e INSTANCE_ID=70b96c92-2df5-44d5-91f0-ccef0181183e -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 --entrypoint node crm-app:v32-clean-11a2778 --import tsx /app/scripts/acceptance/sqlite-production.mjs --verify-artifacts
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-06T21-24-46-468Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=0cf1e6b0-8e87-4ea5-bd1b-c41a6377e149 -e INSTANCE_ID=70b96c92-2df5-44d5-91f0-ccef0181183e -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 --entrypoint node crm-app:v32-clean-11a2778 --import tsx /app/scripts/acceptance/sqlite-production.mjs --inspect-db
docker restart crm-v32-sqliteqa
docker stop crm-v32-sqliteqa
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-06T21-24-46-468Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=0cf1e6b0-8e87-4ea5-bd1b-c41a6377e149 -e INSTANCE_ID=70b96c92-2df5-44d5-91f0-ccef0181183e -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 --entrypoint node crm-app:v32-clean-11a2778 --import tsx /app/scripts/acceptance/sqlite-production.mjs --backup-restore
docker rm crm-v32-sqliteqa
docker run -d --name crm-v32-sqliteqa --network crm-v32-sqliteqa-2026-11-06t21-24-46-468z -p 127.0.0.1:3567:3567 --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-06T21-24-46-468Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/restored/data/crm.db -e DESKTOP_DATA_DIR=/qa/restored/data -e FILE_STORAGE_PATH=/qa/restored/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=0cf1e6b0-8e87-4ea5-bd1b-c41a6377e149 -e INSTANCE_ID=70b96c92-2df5-44d5-91f0-ccef0181183e -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 crm-app:v32-clean-11a2778 node_modules/.bin/next start -p 3567 -H 0.0.0.0
docker stop crm-v32-sqliteqa
```

## Ограничения и история прогонов

HTTP исполнялся через `docker exec` внутри Linux-контейнера на `127.0.0.1:3567`: internal network исключает внешний egress. Порт опубликован только на loopback хоста, но доступ из браузера Windows-хоста не подтверждён. Локальные health/API не используют внешние сетевые probes. AI, scraper, web search и backup targets выключены.

DOCX/XLSX проверены распаковкой и наличием synthetic content; PDF реально сформирован Chromium, проверены сигнатура/EOF и SHA-256, но визуальная вёрстка и извлечение текста PDF не проверялись. Созданы manager и один realtor, не полный T01 с тремя пользователями. Readiness сообщает deploymentMode=server (отдельный DEPLOYMENT_MODE), тогда как CRM_DEPLOYMENT_MODE=desktop и реальная SQLite подтверждены файлами/миграциями. Встроенный image healthcheck на 3000 не является этой проверкой readiness на 3567.

Предварительные прогоны harness не были зелёными: отсутствовал родитель fixture-каталога; затем не были заданы CRM_DESKTOP_PORT и корректный recovery-key format, а HTTP с Windows-хоста не проходил в internal network. Исправлен только acceptance harness, не core. После этого полный прогон дал 21 PASS, а финальный с дополнительными RBAC-проверками — результаты выше. Подтверждённых core-дефектов в проверенном объёме не найдено; это не утверждение об отсутствии дефектов вне него. Все новые fixtures сохранены; архивные ключи не сохранены, поэтому для дальнейшей проверки оставлена уже восстановленная DB/files.
