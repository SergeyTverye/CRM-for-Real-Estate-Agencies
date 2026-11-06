# SQLite core prototype — этап 1

Дата: 2026-11-06. Рабочая ветка feature/desktop-v3.2; базовый наблюдавшийся HEAD 628f131a11b1a59f52eb782bd32e45ec5f53ceab. Изменения незакоммичены, координатор управляет общей копией. Позднейшие коммиты других агентов не означают повторного прогона их полного выпуска.

## Воспроизведение

Только синтетика; тест создаёт новый файл в системном temp, мигрирует его и отдельный storage. .env не читается desktop Prisma config. Команды не используют рабочую CRM БД.

~~~powershell
npm ci
npm run desktop:generate
npm run desktop:audit
npm run desktop:smoke:migrate
npm run test:integration:sqlite
npx tsc --noEmit
npm test
$env:TEST_DATABASE_URL="postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_a"
npm run test:integration
~~~

Для нового локального desktop-файла:

~~~powershell
$env:CRM_DEPLOYMENT_MODE="desktop"
$env:DATABASE_URL="file:C:/Users/<user>/AppData/Local/RealEstateCRM/data/crm.db"
$env:SQLITE_DATABASE_URL=$env:DATABASE_URL
npm run desktop:migrate
~~~

Миграция не создаёт предопределённых пользователей/паролей. Это инфраструктурный прототип; первый запуск/мастер/офлайн runtime относятся к следующему этапу. Для server CRM_DEPLOYMENT_MODE=server (или не задан), обычные DATABASE_URL и PG миграции.

## Реально проверено

Windows x64, host Node v22.23.4, Prisma/client/adapter 7.10.1, better-sqlite3 12.6.2, SQLite 3.51.2. Нативный addon установлен и запущен на Windows Node22 после npm rebuild better-sqlite3. npm12 требует allowScripts: разрешён только pinned better-sqlite3@12.6.2, записи prisma/esbuild не менялись. Engines better-sqlite3 разрешает Node22 и Node24; фактический Windows Node24 bundled runtime ещё требует отдельного прогона, не объявлен проверенным.

Из установленных этой задачей packages: @prisma/adapter-better-sqlite3@7.10.1, better-sqlite3@12.6.2, @types/better-sqlite3@7.6.13, все --save-exact. Другие новые dependencies принадлежат параллельной работе и не откатывались.

- Создание чистого SQLite-файла; Prisma migrate deploy, повторный deploy, 84 таблицы, integrity_check=ok.
- Argon2 вход, hashed sessions, logout revocation.
- Клиент → обращение/звонок → ClientNeed + следующая Task атомарно → планер → локальный объект → подборка и связь с потребностью → КП со snapshot → Document и bytes через StorageAdapter → аудит.
- Денежный максимум 99999999999999.99, сумма 0.10 + 0.20, нормализованные несколько DealCommission, integer storage, ограничения масштаба/диапазона; native stock Decimal probe воспроизводит REAL/округление.
- Client/Need/Deal другого сотрудника недоступны; historical archive manager-only; owner contacts скрыты; global search с кириллицей не раскрывает чужие записи; Document client/need/template-role scopes; exact insensitive equality с Ё и буквальными %/_.
- Optimistic concurrency; отказ active без task; task completion не оставляет need без следующего действия; повтор задачи; FK и CHECK; rollback не виден параллельному читателю.
- SQL planner 1500 Task без загрузки первичных строк, локальная граница суток и scope второго сотрудника; call-source report и reactivation interval.
- 12 конкурентных AI reserves, разные repository instances: 2 успеха по 1 RUB при лимите 2.50, остальные именно AI_BUDGET_EXHAUSTED, итог ledger 2 RUB.
- PRAGMA actual connection: foreign_keys=1, busy_timeout=10000, journal_mode=wal.

## Результаты gate

Результаты финальных прогонов и команда ESLint записаны в локальных synthetic-only logs data/sqlite-*.log. Они не публикуются как пользовательские артефакты. Здесь сохраняется только обезличенный итог:

| Проверка | Фактический результат |
|---|---|
| Чистый + повторный Prisma migrate | PASS, 84 модели, integrity_check=ok |
| SQLite core integration | PASS: 10 сценариев core.test.ts; общий проект 11/11 (2 файла), 9.55 s |
| Дополнительный SQLite backup-settings тест параллельного агента | PASS в общем integration-sqlite проекте (отдельный файл; не часть реализации ядра) |
| Полный npm test | PASS: 1418/1418, 66 файлов, 115.93 s |
| PG integration/authorization, crm_test_a | PASS: 332/332, 53 файла, финальный повтор 241.04 s |
| tsc / targeted ESLint | PASS: npx tsc --noEmit; ESLint изменённых TS-файлов --max-warnings=0 |
| Production Next build | PASS: npm run build, NEXT_DIST_DIR=.next-sqlite-core-check; compile 16.9 s, typecheck 29.1 s, 124 static routes |

PG schema и migrations, tsconfig и каталог .next не изменены. Tauri/installer не разрабатывались. Секреты не печатались, коммерческий Excel и производные не открывались.

## Остаток этапа 2

1. PG→SQLite transfer всех сущностей, исходных ID, FK, snapshots/versions, attachments/checksum, агрегатов финансов; staging rollback и source read-only (DT-06 TODO).
2. property-search results/exports: отдельный SQLite SQL для LATERAL latest snapshot, revision digest, JSON path, raw decimal conversions и стабильных сортировок. Сейчас явный SQLITE_MODULE_NOT_PORTED.
3. Полные JSON path source.kind/source.ids для generated-document history, scalar-list filtering/push, Decimal _avg/multiply/divide и batch-array $transaction. Сейчас эти контракты fail closed/не заявлены.
4. Полная SQLite regression import/export, templates/DOCX/XLSX/PDF, notifications/search workers, browser sessions, AI-chat и всех administrative endpoints. Портированный lock или наличие таблицы не доказывает готовность модуля.
5. Сборки server/desktop, supervisor, native Node24 Windows10/11, ACL/reparse-point проверки, offline production routes, clean install/update/restore и совместная нагрузка. DT-17 PARTIAL.
6. Работа desktop backup/remotes ведётся параллельно другим агентом; этот core-протокол не подтверждает их production/offline/restore критерии.

DT-05 PARTIAL (core subset доказан); DT-06 TODO; DT-17 PARTIAL. Полная CRM на SQLite и готовность installer не объявляются.


## Продолжение

Перечень «Остаток этапа 2» выше фиксирует историческое состояние этапа 1. Текущая реализация, двойная регрессия, transfer и init/upgrade описаны в [sqlite-stage2.md](sqlite-stage2.md); актуальные результаты следует брать оттуда.
