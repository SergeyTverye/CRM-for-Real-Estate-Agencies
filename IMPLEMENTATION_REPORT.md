# Отчёт о реализации CRM «Магазин недвижимости»

Отчёт отражает фактическое состояние кода. Нормативная база — ТЗ v1.6.1 (`tz.md`).
Проверяемая версия: commit `806cfaf (и последующий commit с этим отчётом)` ветки `main`, дата 2026-11-03.

## 1. Реализованный объём

**Core MVP (пункты 1–18, 20 и локальный backup/restore пункта 19 раздела 4 ТЗ) — реализован.**

| Инкремент | Содержание | Состояние |
|---|---|---|
| I0 | Next.js 16 + TypeScript, PostgreSQL 18, Prisma 7, полная baseline-схема одной миграцией, Docker (db/migrate/app/backup), скрипты эксплуатации, health/readiness, JSON-логи, тесты | готово; проверено развёртыванием на чистой копии |
| I1 | локальный вход, Argon2id, серверные сессии, защита от перебора, CSRF, RBAC, администрирование пользователей, AuditLog | готово |
| I2 | клиенты (дубли без утечки, без auto-merge), обращения («чей объект, того и клиент»), потребности (жизненный цикл, StageHistory), объекты и собственники, подбор, задачи | готово |
| I3 | коммуникации, показы (атомарный результат), «Сегодня», повторяемые задачи, договоры, реклама, коммерческие предложения со snapshot, глобальный поиск, доступ к контактам собственников | готово |
| I4 | сделки, участники, несколько комиссий, ИП/ООО, документы (StorageAdapter, проверка прав при выдаче), DOCX КП, постсделочные задачи | готово |
| I5 | импорт Excel (секции, политика ПДн, dry-run/commit), исторический архив, экспорт ZIP/CSV, управленческий отчёт, эксплуатация, backup/restore с тестом восстановления | готово |
| Расширения | off-site репликация (rclone crypt, несколько targets), portable-режим (standby/promote), «Обзор руководителя» | частично (см. §11) |
| AI (P3) | — | не реализуется в core (флаг `AI_ENABLED=false`, таблица `ai_runs` есть) |

## 2. Архитектура

Модульный монолит (ADR-0001): `src/app` — страницы и REST `/api/v1`; `src/server` — HTTP-слой (аутентификация,
CSRF, standby-guard, единый формат ошибок); `src/modules/<домен>/application` — use-case и запросы с транзакциями;
`src/modules/<домен>/domain` и `src/modules/access` — бизнес-правила и политики доступа; Prisma → PostgreSQL;
`src/shared/storage` — StorageAdapter. React-компоненты не обращаются к Prisma (правило ESLint).

## 3. Технологический стек

Node.js 24.22 LTS (образ `node:24.22.2-bookworm-slim`), Next.js 16.4, React 19.3, TypeScript 5.9 (strict),
PostgreSQL 18.6, Prisma ORM 7.10 (driver adapter pg), Zod 4, Pino 10, @node-rs/argon2, exceljs, docx, fflate,
Tailwind CSS 4; Vitest 5, Playwright 1.64; Docker Compose; rclone (crypt/s3/webdav) в ops-образе.

## 4. Модули

access, auth, users, audit, dictionaries, legal-entities, clients, requests, needs, properties, matching,
communications, showings, tasks, agreements, advertisements, commercial-offers, deals, documents, search,
reports, import, export, archive, operations.

## 5. Модель данных

49 таблиц раздела 29 (+ `dictionary_items`); соответствие — `docs/data-model-mapping.md`. UUID, snake_case,
timestamptz(3), numeric(16,2) для денег, date для календарных дат, CHECK для системного codebook
(сверяется тестом с кодом), partial unique для активных grant и контактов, без ON DELETE CASCADE.
Комиссии — отдельная таблица `deal_commissions`; связи задач и документов — нормализованные join-таблицы.

## 6. Бизнес-инварианты

- ClientNeed: active → незавершённая Task; paused → Task возврата; closed → `stop_reason_code` + `closed_at`
  (и CHECK в БД); success → без причины. Проверка в конце каждой команды в той же транзакции, включая
  завершение/отмену последней задачи, результат показа, коммуникацию, импорт.
- Обращение сохраняется всегда; новый клиент по объекту/объявлению получает ответственного объекта;
  существующий клиент сохраняет ответственного, конфликт показывается.
- Дубли: нормализованный телефон/e-mail; риелтору — нейтральный конфликт без сведений о чужом клиенте.
- Реактивация inactive-клиента новым обращением/потребностью; archived — только руководителем.
- КП: snapshot цены/адреса/площади/условий; prepared/sent требуют ИП/ООО; документ наследует legal_entity_id.
- Сделка: Property, ответственный, LegalEntity, статус, opened_at, ≥1 участник; закрытие не архивирует клиента.
- Optimistic concurrency по `updated_at` во всех формах редактирования.

## 7. Аутентификация и авторизация

Argon2id, временный пароль с обязательной сменой, серверные сессии (SHA-256 токена в БД), HttpOnly/SameSite cookie,
отзыв при деактивации/смене пароля, защита от перебора, CSRF (Origin + JSON). Права проверяются сервером
(`access/domain/scopes.ts`): чужая запись → 404, функция роли → 403; контакты собственника — по ответственности
или grant; файлы — по доступу к связанной сущности; поиск и экспорт подчиняются тем же правилам.
Подробно — `docs/security-review.md`.

## 8. Импорт

Профили `import-profiles/*.json` (7 секций ТЗ 38.2, версия mapping фиксируется в задании). Детектор секций по
маркеру и заголовкам; паспорт/«выдан»/регистрация/дата рождения отбрасываются при разборе; неоднозначные поля
не получают придуманных значений. Dry-run пишет только `import_jobs`/`import_row_results`; commit по секциям,
построчно, с `commit_result` и контрольным равенством `rows_read = imported + skipped + error`; повтор того же
файла не создаёт дублей. Мастер импорта — раздел «Импорт».

## 9. Backup / restore

`backup.sh`: `pg_dump -Fc` + `files.tar.zst` + `manifest.json` (версии, PostgreSQL major, контрольные счётчики
строк) + `checksums.sha256`, сборка в staging и атомарное переименование, ротация 14 копий, запись `backup_runs`.
`backup-verify.sh`, `restore.sh` (подтверждение, защитный snapshot, проверка миграций и health),
`restore-test.sh` — T08 в изолированном compose-проекте (вход, контрольные счётчики, контрольный файл через API).
Off-site: `replicate.sh` — rclone crypt (содержимое и имена), независимые `backup_target_runs`, verify через
crypt-слой, `--failed-only`, ротация на target; `probe.sh` для проверки совместимости.

## 10. Запуск

```bash
./scripts/bootstrap.sh && ./scripts/deploy.sh     # установка
./scripts/update.sh                                # обновление
./scripts/backup.sh [--targets all]                # копия
./scripts/restore-test.sh                          # проверка восстановления (T08)
./scripts/status.sh | logs.sh | down.sh
```

Разработка и тесты — README («Разработка»), `docs/dev-conventions.md`.

## 11. Тестирование и результаты T01–T10

Фактический прогон перед передачей: `npx tsc --noEmit` — без ошибок; `npx eslint . --max-warnings=0` — без замечаний;
`npx vitest run` — **20 файлов, 165 тестов, все PASS** (unit 9 файлов, integration 9, authorization 2, на реальной PostgreSQL 18);
`npx playwright test` — **6 E2E PASS** на production-сборке (`next build`, 142 маршрута); Docker: `bootstrap.sh && deploy.sh`
на чистой копии репозитория, backup с off-site репликацией и `restore-test.sh` — PASS.

| Сценарий | Автоматическая проверка | Результат |
|---|---|---|
| T01 вход и роли | auth, admin-users, admin-api, e2e | PASS |
| T02 обращение, дубли, «чей объект» | clients-requests, crm-access, e2e | PASS |
| T03 жизненный цикл ClientNeed | need-lifecycle | PASS |
| T04 подбор → показ → результат → этап → действие | operations-flow, match-score | PASS |
| T05 негативные проверки доступа | crm-access, deals-offers-documents, reports-export, e2e | PASS |
| T06 сделка, ИП/ООО, комиссии, постсделка | deals-offers-documents | PASS |
| T07 импорт dry-run/commit | import, import-parser | PASS |
| T08 backup и восстановление в отдельном контуре | `restore-test.sh` на чистой копии (Docker) | PASS |
| T09 управленческий отчёт | reports-export | PASS |
| T10 коммерческое предложение | deals-offers-documents | PASS |

Описания и доказательства — `docs/acceptance/T01.md … T10.md`. Пользовательская приёмка (UAT) — на стороне
заказчика по сценариям T02–T06 (ТЗ 17.8, 31.3.1).

## 12. ADR и допущения

ADR: 0001 модульный монолит, 0002 Prisma как data access, 0003 сессии и CSRF, 0004 ограничение попыток входа,
0005 служебные поля сверх раздела 29, 0006 контейнеры и формат backup (`docs/adr/`).
Допущения A-01…A-18 — `docs/implementation-assumptions.md`.

## 13. Известные ограничения

- Производительность (NFR-14) измеряется на сервере предприятия до M6.
- Профили импорта построены по описанию ТЗ 38 и синтетическому образцу; на реальном файле предприятия возможно
  уточнение mapping (новая версия профиля) по итогам пробного импорта.
- Off-site: проверен target типа filesystem (NAS/диск) с шифрованием; Yandex Cloud Object Storage и Облако Mail.ru
  настроены шаблонами, но не проверены без учётных данных заказчика (**BLOCKED**); СберДиск — только через probe.
- Portable: standby/promote/demote, config bundle и bootstrap реализованы; полный сценарий T11 на Windows 11 не выполнялся.
- Защита от перебора паролей хранится в памяти одного контейнера (ADR-0004); CSP с `'unsafe-inline'` (A-16).
- Образ приложения ~1,7 ГБ (полный `node_modules` нужен migrate/seed); оптимизация — в backlog.
- AI-контур (P3) не реализован.

## 14. Расширения и BLOCKED-точки интеграции

| Точка | Что готово | Что нужно извне |
|---|---|---|
| Yandex Cloud Object Storage | `backup-remote-add.sh <code> yandex`, replicate/verify/probe | ключи сервисного аккаунта и bucket |
| Облако Mail.ru (WebDAV) | `backup-remote-add.sh <code> mailru` | логин и пароль внешнего приложения |
| СберДиск | профиль WebDAV + обязательный probe | адрес WebDAV/API и учётные данные, успешный probe |
| Портативный узел на Windows | PowerShell-обёртки `scripts/*.ps1` | тестовый ПК с Docker Desktop/WSL2 |
| Целевой сервер | Docker-развёртывание | ОС/CPU/RAM/диск и проверка производительности |

## v2.4.1 — срез 05.11.2026

Baseline выше описывает v1.6.1; в P1 v2.4.1 AI/скрапер уже реализованы. Ветка feature/tz-v2.4.1 от ba7e6fa; итоговый SHA: **заполняет координатор**.
Объём: перспективные обращения, pause_return, поиск/закладки/подборки/перенос, persistent AI-бюджет, галерея, редакции КП, чек-лист, drill-down, календарь/уведомления.
Архитектура: модульный монолит app + worker + db, одноразовые migrate/backup; SearchAi/AiGate, ScraperAdapter, StorageAdapter, серверный RBAC.
Решения: отдельные candidate/Property/Match, snapshots КП/поиска, транзакционные бюджетные резервы, ENV-потолки, worker dedupKey; [журнал](docs/implementation-assumptions.md).
Проверки координатора: unit **301/301**, integration+authorization **152/152**; итоговые общие логи/SHA: **заполняет координатор**.
[Docker-протокол](docs/operations/docker-v241-verification.md): build/migrate/readiness, Chromium start/close, worker restart без дублей, restore БД/файлов с входом и скачиванием — PASS.
[AI-протокол](docs/integrations/yandex-ai.md): 3 live parse completed и ранее completed web; были failed parse с неизвестным расходом, полная стоимость не объявляется.
Ограничения: живые площадки и реальный Excel PARTIAL; чистая установка v2.4.1, NFR-14, три одновременных пользователя и хронометраж не подтверждены; PDF/визуальная печать не приняты.
Результаты E2E и подлинные скриншоты: **в процессе; заполняет координатор**. P2/P3 не включены; общая готовность P1 пока PARTIAL.
[Трассировка](docs/requirements-traceability.md#v241), [приёмка: 13 сценариев](docs/acceptance/v241), [ВКР](docs/vkr/test-protocol.md), [API](docs/api.md); экономика отделяет live-токены от прогнозов.
