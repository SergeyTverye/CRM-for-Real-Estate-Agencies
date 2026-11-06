# SQLite backend — этап 2 (DT-05, DT-06, DT-17)

ТЗ v3.2.1 §4. Исходные данные всех проверок синтетические. PostgreSQL schema/migrations не менялись. Инсталлятор, чистая Windows и облачная эксплуатация — отдельные release gates других исполнителей.

## Изменения

- Все существующие integration/authorization файлы включены в `integration-sqlite`, включая Chromium/HITL. Global setup применяет SQLite-миграции в шаблон, каждый test file получает свою копию и временное файловое хранилище. Реальная рабочая база не используется.
- Поиск: indexed correlated latest snapshot вместо LATERAL, JSON1, точные scaled суммы, детерминированная ревизия всей выдачи, NULLS LAST/tie-break, freshness, пагинация/экспорт >2000 и пакетирование enrichment по 500 ID. Сохранены проверки private scopes и foreign IDs.
- SQLite: очередь на файл и BEGIN IMMEDIATE, транзакционный createMany skipDuplicates (только UNIQUE), list set/push/has/hasSome/hasEvery/equals/isEmpty, JSON source.kind/source.ids/accessRoles, точный Decimal average/multiply/divide, deferred batch rollback. Unicode и RBAC predicates сохраняются.
- Для AI-анализа отдельный сериализованный lock scope: каждая оплаченная группа коммитится независимо; последующий сбой не откатывает уже оплаченный cache/ledger. Атомарная budget reservation сохраняется в транзакции.
- Epoch → Date в деталях звонков/операциях; migration metadata создаётся и при offline init. Spy/instrumentation поддерживаются lazy client.

## Модули → исполняемые проверки

| Модуль | Integration/authorization на SQLite |
|---|---|
| Поиск/очередь/результаты/сортировки/экспорт | property-search*, property-search-server-v31, property-search-price-replay-v31 |
| Планер/агрегаты/повторы/задачи | planner-v31, calendar*, needs-tasks, sqlite/core |
| Звонки/статистика/таймлайн/отчёты | calls-timeline-v31, reports-export, p0-nested-dto |
| Подборки | collections + authorization/collections |
| Шаблоны/версии/документы | document-templates, p1a*, deals-offers-documents |
| AI-chat/анализ/бюджет | ai-chat, ai-persistence, listing-analysis-v31, p2-ai-drafts, sqlite/core |
| Уведомления/worker | calendar-notifications, calendar-ux, planner-v31 |
| Существующий Excel import | import, admin-api, p0-nested-dto (синтетика) |
| ZIP/CSV/архив/backup metadata | reports-export, admin-extras, p0-nested-dto, crm-access |
| Browser sessions | browser-sessions-pg, captcha-hitl-production: тот же синтетический Chromium-cycle на SQLite |
| Контракты/первый запуск/upgrade | sqlite/contracts, sqlite/lifecycle, sqlite/desktop-setup |

## PostgreSQL → SQLite

`npm run desktop:transfer -- <новый.db> <исходное-storage> <новое-storage>`; `SOURCE_DATABASE_URL` задаётся окружением. Источник необходимо остановить для согласованного переноса файлов; DB читается в REPEATABLE READ READ ONLY. Используйте роль БД с SELECT-only правами. Инструмент не меняет исходные таблицы и не печатает строки/секреты.

До записи: сверяется hash Prisma mapping, наличие/типы таблиц, представимость decimal/date/list/JSON, конфиденциальные file references. Все 84 модели переносятся с исходными PK/FK, в порядке зависимостей; циклы проверяются deferred FK до COMMIT. Сверяются counts каждой модели, все FK и decimal суммы (80-digit accumulator). Storage целиком копируется с SHA-256; дополнительно проверяются metadata checksum/size Document и бинарных версий шаблонов. Symlinks и небезопасные storage keys запрещены. Существующий target отвергается. При ошибке удаляются только созданный целевой SQLite и новое целевое storage; source не меняется. Отчёт содержит counts/sums и коды несовместимости без содержимого строк.

`TEST_DATABASE_URL=...crm_test_a npm run test:desktop:transfer` пересоздаёт только выделенную test DB, создаёт seed + демо-подмножество, переносит документы/версии/AI/search/finances и выполняет login/list/download smoke через API на полученном SQLite. Проверяет rollback при неверном checksum и отказ перезаписи target.

## Первый запуск и обновление

`CRM_DEPLOYMENT_MODE=desktop`, `DESKTOP_DATA_DIR` (или системный LOCALAPPDATA), `DATABASE_URL=file:.../crm.db`; `npm run desktop:init`. CLI --initialize не создаёт учётных записей: мастер `/setup` просит собственный пароль руководителя и режим «Пустая база» / «Демонстрационные данные». `--setup-stdin` принимает JSON {directory,account:{login,displayName,password},mode}; пароль не передаётся аргументом командной строки и не выводится. Random UUID/256-bit локальный секрет сохраняются в локальном data dir; owner-only ACL накладывает native supervisor. Все входы проверяются штатной password policy, hash Argon2id.

Offline migrator выполняет проверенные migration.sql в BEGIN IMMEDIATE с SHA-256 историей `_prisma_migrations`, checksum mismatch закрывает запуск. `npm run desktop:upgrade-db`: SQLite backup API → миграции → integrity/FK checks. Защитный снимок сохраняется при ошибке. Runtime upgrade дополнительно делает согласованный DB+files archive и отвечает за rollback версии приложения.

## Ограничения протокола

- Production route-handler smoke дополнен реальным Next dev HTTP startup на перенесённой SQLite; это не доказательство запуска EXE на чистой Windows.
- Тестовый host runtime и packaged Node24/native addon проверяются отдельно в desktop bundle gate.
- SQLite поддерживает одну локальную writer-установку; сетевые/облачные рабочие файлы запрещены. PG сохраняет многопользовательский режим.
- Динамические предметные JSON values не трактуются как фильтры. Внешний ввод SQL не интерполируется.

## Результаты

| Gate | Фактический результат 06.11.2026 | Evidence (локальные synthetic-only logs) |
|---|---|---|
| Полная SQLite integration/authorization + desktop | PASS 360/360, 62 файла, 473.71 s | data/sqlite-stage2-complete-sqlite.log |
| Полная PG integration/authorization, crm_test_a | PASS 342/342, 57 файлов, 527.00 s | data/sqlite-stage2-final-pg.log |
| npm test | PASS 1438/1438, 69 файлов, 289.16 s | data/sqlite-stage2-final-unit2.log |
| PG→SQLite + preflight/rollback | PASS 2/2, 25.36 s | data/sqlite-stage2-transfer-final.log |
| Реальное приложение Next/HTTP на полученном SQLite | PASS readiness 200, no-session 401, login/list/download/page 200, foreign Origin 403; сервер остановлен | data/sqlite-stage2-http2.log |
| TypeScript / targeted ESLint | PASS | data/sqlite-stage2-final-tsc3.log; data/sqlite-stage2-final-added-lint.log; data/sqlite-stage2-final-lint2.log |
| First launch / update / Prisma history compatibility | PASS (в составе SQLite gate) | tests/sqlite/lifecycle.test.ts |

### Отчёт расхождений

Общий integration/authorization набор: PG **342/342**, тот же набор SQLite **342/342**, без ослабления assertions. SQLite дополнительно **18** проверок core/contracts/backup-settings/first-run/lifecycle (всего **360**). Browser-cycle без БД остаётся общим npm test; Chromium production-cycle включён на обоих DB. Новые enterprise-import тесты параллельного исполнителя входят в оба полных прогона.

Исправленные различия: PG raw SQL → SQLite search dialect; Json-path/scalar lists/createMany skipDuplicates; raw epoch/count DTO; точный Decimal arithmetic/average; rollback batch; 2000+ export parameter limit; независимые paid AI group commits; стабильные lazy delegate методы. PG introspection tests параметризованы SQLite schema introspection/ORM count, проверка полного codebook сохранена. Origin test fixtures соответствуют loopback и продолжают проверять чужой Origin. Два timestamp одной core-фикстуры заменены одним значением для устранения случайного миллисекундного расхождения.

Промежуточный unit-прогон имел 6 timeout при Windows subprocess >5 s; unit timeout увеличен до 15 s, assertions не менялись, финальный полный npm test PASS. Промежуточный SQLite-run видел одновременно изменявшиеся demo fixture/service; повтор на актуальном состоянии PASS. PG driver выдал только deprecation warning о concurrent client.query (pg@8), тесты PASS. На рабочем Node v22.23.4 это не заменяет bundled Node24 gate.

DT-05 PASS на уровне всех модулей/backend regression. DT-06 PASS на синтетическом переносе и реальном HTTP startup. DT-17 PASS для двойной backend regression; общий installer/OS/restore gate остаётся вне этой задачи и не объявляется готовым.


Воспроизведение HTTP: после успешного `npm run test:desktop:transfer` запустить `npx tsx tests/desktop-transfer/http-smoke.ts`. Он использует только сгенерированный synthetic fixture pointer в data/, проверяет свободный 3511, запускает `next dev --webpack`, закрывает только своё дерево процессов и удаляет только свои auto-includes `.next-3511` из tsconfig.
