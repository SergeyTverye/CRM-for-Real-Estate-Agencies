# Production SQLite acceptance

2026-11-08T01:15:59.351Z

Image: `crm-app:search-f6a7581`; APP_COMMIT: `f6a75814f8027988f5a12e640c2bb5a63460049f`; Node 24.22.2, Linux Docker. Host orchestrator: v22.23.4.
Fixture: `D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-08T01-13-33-907Z`. Container: `crm-v32-sqliteqa-searchf6r`, loopback 3567, dedicated internal Docker network (no external egress). No PostgreSQL.

**22 PASS / 0 FAIL. Not full Desktop gates / T01–T10 PASS.**

- **PASS image**: {"id":"sha256:2727ba44d6bfec1ba058a19a6eba1b8ff118a748386aa88406dc6fcf7783c9e0","commit":"f6a75814f8027988f5a12e640c2bb5a63460049f","node":"24.22.2"}
- **PASS clean SQLite migration**
- **PASS readiness**: {"status":"ok","checks":{"database":{"ok":true,"detail":"migrations=2"},"fileStorage":{"ok":true}},"version":"dev+f6a75814f8027988f5a12e640c2bb5a63460049f","instanceRole":"active","deploymentMode":"server"}
- **PASS first manager via API**: {"id":"4e91432b-3809-425a-8bce-9034d3fdaa4c","login":"sqliteqa.manager","displayName":"SQLITE-QA manager","role":"manager","mustChangePassword":false}
- **PASS roles and direct denial**: {"realtorLogin":true,"passwordChanged":true,"realtorAdminDenied":true,"realtorArchiveDenied":true,"anonymousAdminDenied":true}
- **PASS create client**: {"id":"5bf9958c-601e-46a8-9846-fb6c0f5227ac"}
- **PASS record call**: {"id":"c3670c25-7782-4922-bdf9-b1429ec6550f","taskId":null}
- **PASS need plus next task**: {"id":"4736bf53-76a5-49e5-9ead-ce8cb2a79580","taskId":"f76418b1-0d70-4659-8e36-54063c59a188"}
- **PASS calendar contains next task**: {"items":1}
- **PASS property**: {"id":"cffefeb5-c18d-4291-8c0c-c56ad72a52bb"}
- **PASS collection**: {"id":"581f36df-350c-429e-9eb2-77ed47b7d894"}
- **PASS collection to offer**: {"id":"0c9e1528-369b-4180-b39c-54d83f62611d"}
- **PASS DOCX generation and download**: {"id":"8897ad16-57a3-4a70-84b2-4c74bb7f7543","bytes":11236,"sha256":"c7c54ebedf308e8d7812b35b9f177562dc6c54e63de989f1f1276996befd0770"}
- **PASS PDF rendering**: {"bytes":47816,"sha256":"739e04b87320a703d4ef760b0891eb783589cc2d458ccc3dfdbf2c1d9e9bcf4c"}
- **PASS XLSX export**: {"bytes":9279,"sha256":"ff328793d6141f2d06e57b9d7677b5d71fd2a314255155b77232ff220894a248"}
- **PASS open data export**: {"bytes":11042,"sha256":"6940a7b9b0343cd43add4e78abb2ce68b01ab0178edbc39dd8ca9bab4fb664fb"}
- **PASS foreign client and document direct denial**: {"clientDenied":true,"documentDenied":true}
- **PASS artifact structure and synthetic content**: {"docxEntries":17,"xlsxEntries":21,"exportEntries":24,"pdfBytes":47816}
- **PASS SQLite integrity, counts and stored file checksums**: {"counts":{"users":2,"clients":1,"communications":1,"client_needs":1,"tasks":1,"properties":1,"property_collections":1,"commercial_offers":1,"documents":1,"_prisma_migrations":2},"integrity":"ok","foreignKeyErrors":0,"checkedFiles":1}
- **PASS restart persistence and login**: {"existingSession":true,"freshLogin":true,"client":true,"document":true}
- **PASS encrypted generic archive and actual restore**: {"backupId":"a8ca0a5a-dd04-4235-ad3c-2dc8a2be52c0","bytes":1860451,"sha256":"44026d9f71070319bd8d08ac6f87db85de9b2d256d3d58b58f2884b1962749bd","manifestSha256":"2509107d51cc87d437edf6b7c422c7cecadffe9df3e2301bddcc5fd228164767","restored":true,"components":["sqlite","settings","documents"]}
- **PASS restored production readiness login client document**: {"readiness":true,"login":true,"client":true,"document":true}

## Reproduce

`node scripts/acceptance/sqlite-production.mjs` (existing named QA container must be absent; script refuses reuse). Existing image only; no install/build/generation. Commands use public desktop scripts mounted read-only; normal runtime, supervised upgrade flag absent.

## Boundaries

Synthetic data only; no private/Excel/existing customer data, root dotenv or pre-existing backups read. Password/passphrase/recovery key remain in process memory, not in protocol. Generic archive API uses stopped single writer, native Linux SQLite and production encryption/restore modules, not DPAPI. No Windows launcher, native picker, supervisor, DPAPI or cloud compatibility claim. Container is stopped and isolated fixture retained.

## Docker commands

```text
docker image inspect crm-app:search-f6a7581
docker ps -a --filter name=^/crm-v32-sqliteqa-searchf6r$ --format {{.Names}}
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-08T01-13-33-907Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=023a90f9-2429-44ae-8ed4-aed0b505ed85 -e INSTANCE_ID=94505a06-a827-40a5-90fc-04e974a944d2 -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 -e QA_EXPECTED_COMMIT=f6a75814f8027988f5a12e640c2bb5a63460049f --entrypoint node crm-app:search-f6a7581 --import tsx scripts/desktop/init-db.ts --initialize
docker network create --internal crm-v32-sqliteqa-2026-11-08t01-13-33-907z
docker run -d --name crm-v32-sqliteqa-searchf6r --network crm-v32-sqliteqa-2026-11-08t01-13-33-907z -p 127.0.0.1:3567:3567 --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-08T01-13-33-907Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=023a90f9-2429-44ae-8ed4-aed0b505ed85 -e INSTANCE_ID=94505a06-a827-40a5-90fc-04e974a944d2 -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 -e QA_EXPECTED_COMMIT=f6a75814f8027988f5a12e640c2bb5a63460049f crm-app:search-f6a7581 node_modules/.bin/next start -p 3567 -H 0.0.0.0
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-08T01-13-33-907Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=023a90f9-2429-44ae-8ed4-aed0b505ed85 -e INSTANCE_ID=94505a06-a827-40a5-90fc-04e974a944d2 -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 -e QA_EXPECTED_COMMIT=f6a75814f8027988f5a12e640c2bb5a63460049f --entrypoint node crm-app:search-f6a7581 --import tsx /app/scripts/acceptance/sqlite-production.mjs --verify-artifacts
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-08T01-13-33-907Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=023a90f9-2429-44ae-8ed4-aed0b505ed85 -e INSTANCE_ID=94505a06-a827-40a5-90fc-04e974a944d2 -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 -e QA_EXPECTED_COMMIT=f6a75814f8027988f5a12e640c2bb5a63460049f --entrypoint node crm-app:search-f6a7581 --import tsx /app/scripts/acceptance/sqlite-production.mjs --inspect-db
docker restart crm-v32-sqliteqa-searchf6r
docker stop crm-v32-sqliteqa-searchf6r
docker run --rm --network none --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-08T01-13-33-907Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/data/crm.db -e DESKTOP_DATA_DIR=/qa/data -e FILE_STORAGE_PATH=/qa/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=023a90f9-2429-44ae-8ed4-aed0b505ed85 -e INSTANCE_ID=94505a06-a827-40a5-90fc-04e974a944d2 -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 -e QA_EXPECTED_COMMIT=f6a75814f8027988f5a12e640c2bb5a63460049f --entrypoint node crm-app:search-f6a7581 --import tsx /app/scripts/acceptance/sqlite-production.mjs --backup-restore
docker rm crm-v32-sqliteqa-searchf6r
docker run -d --name crm-v32-sqliteqa-searchf6r --network crm-v32-sqliteqa-2026-11-08t01-13-33-907z -p 127.0.0.1:3567:3567 --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\data\qa-v32-sqliteprod\2026-11-08T01-13-33-907Z,target=/qa --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\desktop,target=/app/scripts/desktop,readonly --mount type=bind,source=D:\CRM-for-Real-Estate-Agencies\scripts\acceptance\sqlite-production.mjs,target=/app/scripts/acceptance/sqlite-production.mjs,readonly -e CRM_DEPLOYMENT_MODE=desktop -e DATABASE_URL=file:/qa/restored/data/crm.db -e DESKTOP_DATA_DIR=/qa/restored/data -e FILE_STORAGE_PATH=/qa/restored/files -e BACKUP_PATH=/qa/backups -e IMPORT_STAGING_PATH=/qa/staging -e DEPLOYMENT_ID=023a90f9-2429-44ae-8ed4-aed0b505ed85 -e INSTANCE_ID=94505a06-a827-40a5-90fc-04e974a944d2 -e APP_TIMEZONE=Asia/Novosibirsk -e COOKIE_SECURE=false -e AI_ENABLED=false -e SCRAPER_ENABLED=false -e SCRAPER_BROWSER_ENABLED=false -e YANDEX_WEB_SEARCH_ENABLED=false -e BACKUP_TARGETS= -e CRM_DESKTOP_PORT=3567 -e QA_EXPECTED_COMMIT=f6a75814f8027988f5a12e640c2bb5a63460049f crm-app:search-f6a7581 node_modules/.bin/next start -p 3567 -H 0.0.0.0
docker stop crm-v32-sqliteqa-searchf6r
```

## Ограничения и история прогонов

HTTP исполнялся через `docker exec` внутри Linux-контейнера на `127.0.0.1:3567`: internal network исключает внешний egress. Порт опубликован только на loopback хоста, но доступ из браузера Windows-хоста не подтверждён. Локальные health/API не используют внешние сетевые probes. AI, scraper, web search и backup targets выключены.

DOCX/XLSX проверены распаковкой и наличием synthetic content; PDF реально сформирован Chromium, проверены сигнатура/EOF и SHA-256, но визуальная вёрстка и извлечение текста PDF не проверялись. Созданы manager и один realtor, не полный T01 с тремя пользователями. Readiness сообщает deploymentMode=server (отдельный DEPLOYMENT_MODE), тогда как CRM_DEPLOYMENT_MODE=desktop и реальная SQLite подтверждены файлами/миграциями. Встроенный image healthcheck на 3000 не является этой проверкой readiness на 3567.

Предварительные прогоны harness не были зелёными: отсутствовал родитель fixture-каталога; затем не были заданы CRM_DESKTOP_PORT и корректный recovery-key format, а HTTP с Windows-хоста не проходил в internal network. Исправлен только acceptance harness, не core. После этого полный прогон дал 21 PASS, а финальный с дополнительными RBAC-проверками — результаты выше. Подтверждённых core-дефектов в проверенном объёме не найдено; это не утверждение об отсутствии дефектов вне него. Все новые fixtures сохранены; архивные ключи не сохранены, поэтому для дальнейшей проверки оставлена уже восстановленная DB/files.
