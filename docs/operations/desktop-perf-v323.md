# Desktop perf v3.2.3 — замеры и внедрения (Tauri 2 + Next standalone + SQLite)

Дата: 2026-11-09. Ветка `feature/v3.2.3-desktop-perf`. Только синтетика:
`scripts/desktop/perf-measure.mjs`, `tests/sqlite/desktop-perf.test.ts`.
`.env` и `private-data` не читались; `property-search` не трогался.

## 1. Замеры «до» (стенд: file DB, 2000 клиентов / 5000 задач / 1000 событий)

| # | Метрика | До |
|---|---------|----|
| M1 | Холодный старт supervisor→`/api/health/ready` | standalone не собран: разбор по коду. `node -e ""` ~61 мс; супервизор: freePort → spawn server.js (Next standalone) → migrate/upgrade → `waitReady` poll 300 мс (средняя задержка детекта ~150 мс) → 3 воркера → runtime.json. `graceful.cjs` тривиален (<1 мс) |
| M2 | PRAGMA из коробки (`sqlite-adapter`) | `journal_mode=WAL`, `busy_timeout=10000`, `synchronous=FULL(1)`, `cache_size=-16000` (16 МБ), `temp_store=DEFAULT(0)`, `mmap_size=0` |
| M3 | Микробенч: 2000 вставок задач + 2000 точечных select | запись ~110–114 мс, чтение ~72–73 мс |
| M4 | EXPLAIN 8 горячих запросов (списки, Сегодня, Календарь) | 7/8 `SEARCH USING INDEX`, 1 SCAN (см. R1) |
| M5 | FullCalendar в бандле `/calendar` | статический импорт, ~1814 КБ JS исходников (core 1250 + interaction 220 + timegrid 160 + daygrid 136 + list 44) в общем чанке страницы |
| M6 | Календарь: `linksAccessible` в цикле по событиям | до 4 запросов/событие (N+1); плюс `clientNeed.count` на событие при фильтре по клиенту |
| M7 | Сегодня: контрольные даты | 7 последовательных await-блоков (водопад: showings→today→agreements→ads→offers→needs→counts) |

## 2. Внедрено (с измерением)

| Что | Файл | Эффект (после) |
|-----|------|----------------|
| PRAGMA: `synchronous=NORMAL`, `cache_size=-64000` (64 МБ), `temp_store=MEMORY`, `mmap_size=256МБ` (WAL первым, порядок сохранён) | `src/shared/db/sqlite-adapter.ts` (`DESKTOP_SQLITE_PRAGMAS`) | запись 57–63 мс (**−45…48%**), чтение 67–77 мс (нейтрально, ±шум). WAL сохранён |
| Батчинг проверок доступа событий: `batchLinksAccessible` + `needClientMap` (≤4 запроса на весь период вместо ≤4 на событие) | `src/modules/calendar/application/calendar-service.ts` | N+1 устранён; RBAC-семантика идентична (тест + 26 PG-тестов планировщика/календаря зелёные) |
| Контрольные даты «Сегодня» одним `Promise.all` | `src/modules/tasks/application/task-queries.ts` | водопад из ~7 RTT → 1 пакет; результат побайтово тот же |
| FullCalendar в отдельный чанк (`next/dynamic ssr:false` + `calendar-view.tsx`, loading-фолбэк) | `src/app/(crm)/calendar/` | ~1.8 МБ JS убраны из начального чанка `/calendar`; страница и фильтры рендерятся до подгрузки сетки |
| Опрос готовности 300→200 мс | `scripts/desktop/runtime/supervisor.mjs` | средняя задержка детекта READY ~150→~100 мс (−50 мс аналит.) |

Backup-совместимость: механизм `sqlite3_backup` (`Database.backup`, как в `desktop-coordinator`) проверен
тестом на БД с новыми PRAGMA — `integrity_check=ok`, данные целы; `tests/desktop-backup` 48/48 зелёные.
Новые PRAGMA применяются только к app-подключению и не влияют на соединение бекапа.

## 3. Отклонено (выигрыш не измерен / риск)

- R1. Индекс под `clients-search` (`LIKE '%…%'`): ведущий `%` не покрывается B-tree — SCAN неустраним
  без триграмм/FTS. Семантику поиска не менял. Зафиксировано тестом (осознанный SCAN).
- R2. Индекс `(status, updated_at)` под сортировку списка клиентов: фильтр варьируется, выигрыш
  на LIMIT 20 не измерен, лишний индекс замедлил бы запись. Миграций SQLite/PG не потребовалось:
  EXPLAIN показал покрытие всех остальных горячих форм существующими индексами
  (`tasks_responsible_user_id_status_due_at_idx`, `tasks_status_due_at_idx`,
  `calendar_events_owner_user_id_start_at_idx`, `calendar_events_start_at_idx`, …).
- R3. Кэш `plannerSetting`/`userOptions`: чтение одной строки/малых справочников, выигрыш <1 мс,
  риск несвежести `soonThresholdHours`. Не внедрял.
- R4. Прогрев страниц после READY: добавляет нагрузку на старт без измеренного выигрыша для
  первого пользователя. Не внедрял.

## 4. Регрессия

- `tsc --noEmit` — чисто (после `prisma generate` + `desktop:generate`; генерация меняет только
  окончания строк в `prisma/sqlite/schema.prisma` — откачено, контент идентичен).
- `eslint` изменённых файлов — чисто.
- `vitest --project unit` — 2123 pass, 1 fail предсуществующий (`ai/search-ai.test.ts`, падает и на чистом HEAD, зона AI не трогалась).
- `vitest --project integration-sqlite` — 472 pass, 1 fail предсуществующий (`ai-tariff-bootstrap`, падает и на чистом HEAD).
- `vitest --config tests/desktop-backup` — 48 pass / 2 skipped.
- PG (`TEST_DATABASE_URL=…/crm_test_b`): затронутые `calendar-ux`, `calendar-notifications`,
  `iceman-today-counters`, `planner-v31`, `operations-flow` — 26/26; authorization
  `calendar-notifications`, `p0-nested-dto` — 14/14.

## 5. Воспроизведение

```
node scripts/desktop/perf-measure.mjs
npx vitest run --project integration-sqlite tests/sqlite/desktop-perf.test.ts
npx vitest run --config tests/desktop-backup/vitest.config.ts
```
