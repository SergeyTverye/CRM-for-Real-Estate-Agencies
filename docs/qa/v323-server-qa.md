# QA серверной версии CRM v3.2.3 — отчёт стенда `:3390` / БД `crm_qa`

Дата: 2026-11-09. Ветка `feature/v3.2.3-qa-server`. Все данные синтетические (`[QA-V323]`, телефоны `+7 900 000-*`, адреса вымышлены).

## 1. Окружение

- Хост с Docker Engine; рабочие контейнеры `crm-*` не трогались (только `docker build` образа `crm-qa-check:local` — OK, `compose.yaml config` — valid).
- `crm-test-testdb-1`: создана БД `crm_qa`, `prisma migrate deploy` (13 миграций), `prisma db seed` (manager/realtor1/realtor2), затем `scripts/demo/seed-realistic.ts` (идемпотентный, guard на `/crm_qa`, детерминированный ГПСЧ).
- Данные: 120 клиентов (80 физлиц + 40 компаний), 130 потребностей (офис/склад/торговля/квартира/дом; Новосибирск/Бердск/Академгородок/Обь/Кольцово), 150 объектов с 2–3 синтетическими JPEG, 140 обращений, 60 показов, ~270 задач (просрочки/сегодня/будущее/еженедельные повторы), 12 КП (+PDF/DOCX), 8 сделок с 2 комиссиями, 15 договоров (+PDF/DOCX, допсоглашение, архив), 25 объявлений (часть истекает ≤5 дней), 30 записей исторического архива, ~430 документов.
- Стенд: `next build --webpack` → `NEXT_DIST_DIR=.next-qa-server`, `next start 127.0.0.1:3390` + search-worker + notifications-worker. `APP_ORIGIN=http://127.0.0.1:3390`, `SCRAPER_*=true`, `AI_ENABLED=true`, бюджет ИИ 3,00 ₽ / 10 вызовов.
- Секреты только через окружение, в отчёт не печатались. `private-data` и реальный Excel не использовались.

## 2. Сценарии (Playwright, `tests/qa/`, конфиг `playwright.qa.config.ts`) — все PASS

| # | Сценарий | Итог |
|---|----------|------|
| QA-01 | Вход/выход, неверный пароль 401, форма логина | PASS |
| QA-02 | Входящий звонок → клиент → потребность → задача; дедупликация чужого телефона (нейтральный ответ, без раскрытия) | PASS |
| QA-03 | Конфликт оптимистичной блокировки: второй PATCH со старым `updatedAt` → 409; чужому риелтору need → 403/404 | PASS |
| QA-04 | Объект (UI), фото (multipart), запрос доступа к контактам чужого объекта; показ → результат | PASS |
| QA-05 | Перенос задачи (31 мс), календарь, уведомления | PASS |
| QA-06 | КП со снапшотами (заморожены) → отправка; печатная A4 | PASS |
| QA-07 | Сделка: 2 стороны + 2 комиссии → закрытие → постсделочные задачи | PASS |
| QA-08 | Договор + PDF при создании с `linkKind=agreement`, допсоглашение, архив | PASS |
| QA-09 | Реклама с истекающим сроком | PASS |
| QA-10 | Отчёты manager/detail (146/152 мс) + drill-down, скриншоты | PASS |
| QA-11 | Импорт: workbook-like (0 строк, без утечек) + enterprise-workbook (маппинг → dry-run → commit → повтор без дублей → экспорт) | PASS |
| QA-12 | Поиск + AI-разбор 2 вызова, +0,23 ₽ (лимит ≤3 ₽, ≤10) | PASS |
| QA-13 | AI-помощник на 2 экранах, суммарно 1,41 ₽ | PASS |
| QA-14 | Админка только руководителю (UI → /forbidden, API → 403) | PASS |
| QA-15 | RBAC: чужой клиент/документы/поиск/архив недоступны | PASS |
| QA-16 | Backup: pg_dump + 827 файлов + manifest/sha256 → restore в `crm_qa_restore` → counts/control совпали | PASS |

Замеры: login 1,4–1,5 с; создание КП 98 мс; dry-run+mapping ~1 с; pg_dump 600 мс; restore 800–1000 мс.

## 3. Найденные дефекты и исправления

1. **Имя загружаемого файла терялось** (`enterprise-service.ts`): `sourceFilename` и `commitRow.sourceFilename` были захардкожены как `enterprise-workbook.xlsx`. Исправлено на `file.name` / `job.sourceFilename`. Регрессионный тест `tests/integration/enterprise-workbook-api.test.ts` (+1 `it`). Проверено повторной загрузкой `workbook-like.xlsx` — имя сохраняется. Коммит: `fix(import): preserve actual uploaded workbook filename`.
2. Мелочь процесса: лист-справочник с `target: null` даёт неустранимый `unresolved` (строка-маркер, колонка 0) — операторское решение «пометить лист `ignore`» задокументировано в QA-шаге; отдельный дефект не заводился (поведение детерминировано и объяснено в UI).
3. Предсуществующий провал `integration-sqlite/ai-tariff-bootstrap.test.ts` (1 тест, `ConflictError` лимита) — воспроизводится и без моих изменений (`git stash` проверка), к QA не относится.

## 4. Регрессия

- `tsc --noEmit`: PASS. `eslint` (изменённые файлы + `tests/qa`): PASS.
- `npm test` (unit + browser-cycle): 2167 passed, 5 skipped.
- `vitest --project integration enterprise-workbook-api`: 2 passed (TEST_DATABASE_URL=crm_test_d).
- `test:integration:sqlite`: 475 passed, 1 failed — предсуществующий AI-тариф (см. п.3).
- `test:integration` полный и `test:e2e` не гонялись в рамках QA (покрыты точечно + серверный прогон 16/16).

## 5. Ограничения

- Live-поиск по внешним площадкам не выполнялся (нет внешних creds в стенде; SCRAPER включён, worker запущен).
- AI: всего 4 платных вызова на 1,41 ₽ (2 разбора + 2 ассистента); ранжирование отдельным вызовом не делалось — бюджет сохранён для диссертации.
- Восстановление проверено на уровне dump+файлы в изолированную БД (`crm_qa_restore`, затем удалена), а не отдельным compose-проектом.
- Смена пароля и блокировка пользователя проверены на уровне API/админки (деактивация StateFlow), массовая блокировка по перебору не провоцировалась на боевых QA-учётках.
- `tsconfig.json`, `prisma/sqlite/schema.prisma`, `workbook-like.xlsx` из сборки не коммитятся (откачены).

## 6. Артефакты

- Скриншоты: `docs/thesis/screenshots/server/01–33-*.png` (1440×900, deviceScaleFactor 2) + `captions.json`.
- Сид: `scripts/demo/seed-realistic.ts`. Прогон: `tests/qa/*.spec.ts`.
- Временная папка бэкапа: `data-qa/tmp-restore-test/` (gitignored через `/data-qa/`).
