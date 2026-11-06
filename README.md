# CRM for Real Estate Agencies

## v3.1

Расширены поиск недвижимости, планер на день/неделю/месяц/три месяца, ручные звонки,
независимые подборки, управляемые DOCX/XLSX-шаблоны и контекстный AI-чат.
Обычный `docker compose up -d --wait` запускает app, notification worker, search-worker,
PostgreSQL и одноразовый migrate/seed. Шаблоны работают при выключенном AI.

Release gate **c812d18** от 06.11.2026 — **AT-17 PASS**: unit/browser-cycle
**1363/1363**, PostgreSQL integration/authorization **326/326**, production E2E
**24 passed / 1 opt-in REPLAY skipped**; Prisma/typecheck/lint/build, Docker,
чистый clone/deploy, смена пароля, restart persistence и оба backup/restore — PASS.

Первый запуск (на host нужны Docker Engine, Compose plugin и Bash):
`bash scripts/bootstrap.sh`, настройка локального `.env`, затем
`docker compose build` и `docker compose up -d --wait`.
Сервис migrate автоматически применяет миграции и seed. Открыть порт APP_PORT
(по умолчанию 8080), войти с SEED_MANAGER_LOGIN/SEED_MANAGER_PASSWORD из локального
`.env` и сменить временный пароль. Пароли не публиковать. Проверка восстановления:
`bash scripts/backup.sh`, затем `bash scripts/restore-test.sh --keep` в отдельном контуре.
На Windows использовать Git Bash; APP_UID/APP_GID для Linux-контейнеров — 1000/1000.

Ограничения: внешний доступ Циан/Авито/Домклик BLOCKED; даты публикации части источников
остаются unknown. Работают ручная форма/ссылка, CSV preview/commit и поиск по первому
обнаружению CRM. HITL продолжение включается только для разрешённых источников;
проверка на стенде не снимает блокировки площадок. AI необязателен, платные вызовы
требуют лимитов и подтверждения; шаблоны работают без него. Полнота LIVE-охвата и
апробация руководителем и двумя риелторами (AT-18) ещё не подтверждены.
**Готовность всего MVP по §11 не объявляется.** Команды и доказательства —
[release gate v3.1](docs/operations/release-gate-v31.md),
[AT-17](docs/acceptance/v31/AT-17.md), [вся приёмка](docs/acceptance/v31/README.md).

CRM-система для ООО «Магазин недвижимости», разрабатываемая в рамках выпускной квалификационной работы по автоматизации процессов агентства недвижимости.

Система предназначена для ведения клиентской базы, регистрации обращений, сохранения истории взаимодействия с клиентами, работы с потребностями и объектами недвижимости, планирования следующих действий, сопровождения показов, договоров, коммерческих предложений и сделок, контроля рекламы, документов и постсделочных задач.

Проект ориентирован на небольшое агентство недвижимости с локальной инфраструктурой и ограниченным числом постоянных пользователей.

---

## Статус проекта

Core MVP реализован по инкрементам I0–I5 технического задания: инфраструктура, аутентификация и RBAC,
ядро CRM, операционный контур, сделки и документы, импорт, отчётность, резервное копирование
с проверяемым восстановлением. Фактическое состояние, результаты T01–T10 и известные ограничения —
в [`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md); трассировка требований —
[`docs/requirements-traceability.md`](docs/requirements-traceability.md).

Нормативный baseline: **ТЗ v1.6.1** — [`tz.md`](tz.md). Для расширения действует [ТЗ v2.4.1](ТЗ_CRM_итоговое_v2.4.1_проверено.md): в явно изменённых требованиях оно имеет приоритет. Разделы ниже про исходный core описывают baseline; новое состояние приведено в разделе «Что нового в v2.4.1».

Документация: [инструкция администратора](docs/operations/admin-guide.md) ·
[инструкция пользователя](docs/user-guide.md) · [модель данных](docs/data-model-mapping.md) ·
[инженерные допущения](docs/implementation-assumptions.md) · [ADR](docs/adr) ·
[соглашения разработки](docs/dev-conventions.md) · [приёмка](docs/acceptance).

---

## Репозиторий

GitHub:

```text
https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies
```

SSH:

```text
git@github.com:SergeyTverye/CRM-for-Real-Estate-Agencies.git
```

Клонирование:

```bash
git clone git@github.com:SergeyTverye/CRM-for-Real-Estate-Agencies.git
cd CRM-for-Real-Estate-Agencies
```

---

## Основная задача

CRM должна заменить разрозненное ведение клиентской и объектной информации в Excel единым рабочим контуром.

Основные проблемы исходного процесса:

- данные находятся в нескольких таблицах
- новые обращения могут фиксироваться с задержкой
- история взаимодействия с клиентом хранится фрагментарно
- дальнейшие действия во многом зависят от памяти сотрудника
- клиент может выпасть из работы после первого обращения
- показ, договор, реклама, задача и сделка не связаны общей моделью
- повторная работа со старой клиентской базой затруднена
- руководителю приходится вручную контролировать текущую работу

Один из центральных процессных принципов целевой системы:

> Каждая активная потребность клиента должна иметь зафиксированное следующее действие.

---

## Пользователи

Система проектируется прежде всего для трёх постоянных пользователей:

- руководитель / администратор
- риелтор
- риелтор

Руководитель получает доступ к общему управленческому контуру и административным функциям.

Риелтор работает со своими клиентами, обращениями, потребностями и сделками, а также с доступной ему частью общей объектной базы.

Точная модель доступа определяется в `tz.md` и обеспечивается на серверной стороне.

---

## Основные функциональные области

Core CRM охватывает:

- локальную аутентификацию
- пользователей и роли
- клиентов и контактных лиц
- входящие обращения
- потребности клиентов
- объекты недвижимости
- контакты собственников
- подбор объектов
- историю коммуникаций
- показы
- задачи и напоминания
- экран «Сегодня»
- договоры
- коммерческие предложения
- рекламные размещения
- сделки
- участников сделки
- комиссионные обязательства
- юридические субъекты ООО / ИП
- документы и файлы
- исторический архив сделок
- импорт исходных Excel-данных
- глобальный поиск
- управленческие отчёты
- AuditLog
- локальное резервное копирование
- проверяемое восстановление

Расширенные возможности имеют отдельный приоритет и реализуются только в объёме, установленном `tz.md`.

---

## Технологический baseline

Базовый стек проекта:

```text
Node.js 24 LTS
Next.js 16
React
TypeScript
PostgreSQL 18
Prisma ORM 7.x
Docker
Docker Compose
npm
```

Дополнительные библиотеки выбираются во время реализации с учётом архитектурных ограничений `tz.md`.

Для runtime validation предполагается Zod или эквивалентное решение.

Для хранения паролей используется Argon2id.

Для автоматизированного тестирования предусматриваются unit, integration, authorization и browser/e2e tests.

---

## Архитектура

Базовая архитектура проекта — модульный монолит.

```text
Browser
   │
   ▼
Next.js application
   ├── UI
   ├── /api/v1
   ├── application services
   ├── domain rules
   ├── authorization
   └── infrastructure adapters
            │
            ▼
          Prisma
            │
            ▼
       PostgreSQL
```

UI, API и бизнес-логика входят в один application container.

PostgreSQL работает отдельным контейнером.

Браузер не обращается к PostgreSQL напрямую.

React-компоненты не работают с Prisma напрямую.

Логическое разделение:

```text
presentation
    ↓
API
    ↓
application
    ↓
domain / policy
    ↓
data access
    ↓
PostgreSQL / file storage
```

Инфраструктурные зависимости изолируются через адаптеры там, где такая абстракция действительно нужна.

---

## Структура репозитория

```text
/
├── src/
│   ├── app/
│   │   ├── (auth)/            вход, смена пароля
│   │   ├── (crm)/             рабочие места (Сегодня, Обращения, Клиенты, Потребности, Объекты, …)
│   │   └── api/v1/            REST/JSON API (route handlers)
│   ├── server/                HTTP-слой: аутентификация, CSRF, формат ошибок, форматирование
│   ├── modules/<домен>/       application (use-case, queries) и domain (правила)
│   │                          access (RBAC-политики), auth, users, clients, requests, needs,
│   │                          properties, matching, communications, showings, tasks, agreements,
│   │                          advertisements, commercial-offers, deals, documents, search,
│   │                          reports, import, export, archive, operations, audit, dictionaries
│   ├── shared/                config, db, errors, validation, codebook, storage, logging, time
│   └── ui/                    общие компоненты интерфейса
├── prisma/                    schema.prisma, migrations/, seed.ts, seed/
├── import-profiles/           versioned профили импорта Excel
├── ops/backup/                образ и скрипты резервного копирования (pg_dump, rclone crypt)
├── scripts/                   bootstrap/deploy/update/backup/restore/status/logs/down, portable
├── tests/                     unit, integration, authorization, e2e (Playwright)
├── docs/                      ADR, приёмка, трассировка, модель данных, инструкции
├── compose.yaml               production-like стек (db, migrate, app, backup)
├── compose.test.yaml          PostgreSQL для разработки и тестов
├── compose.restore-test.yaml  изолированный контур проверки восстановления (T08)
├── Dockerfile
└── .env.example
```

---

## Нормативные документы проекта

### `tz.md`

Главный источник требований.

Перед архитектурными решениями или реализацией новой функциональности разработчик или coding-агент должен сверяться с этим файлом.

### `AGENTS.md`

Общие инструкции для coding-агентов, работающих с репозиторием.

### `CLAUDE.md`

Инструкции и рабочие правила для Claude Code.

### `docs/requirements-traceability.md`

Трассировка требований:

```text
требование
→ реализация
→ модуль / файл
→ автоматический тест
→ acceptance scenario
→ статус
```

### `docs/data-model-mapping.md`

Соответствие:

```text
сущность предметной модели
→ Prisma model
→ PostgreSQL table
```

### `docs/implementation-assumptions.md`

Инженерные решения по вопросам, которые допускают несколько допустимых трактовок.

### `docs/adr/`

Существенные архитектурные решения.

### `docs/future-backlog.md`

Полезные идеи за пределами текущего MVP.

---

## Начало разработки

Проект создаётся непосредственно в этом репозитории.

Отдельный вложенный Git-репозиторий создавать не требуется.

Перед началом реализации необходимо полностью прочитать:

```text
tz.md
```

Разработка выполняется инкрементами, установленными техническим заданием.

Общая последовательность:

```text
I0 — infrastructure / bootstrap

I1 — authentication / users / sessions / RBAC / audit

I2 — clients / requests / needs / properties / tasks

I3 — communications / matching / showings /
     Today / agreements / commercial offers

I4 — deals / commissions / documents /
     advertising / operational modules

I5 — import / reporting / backup /
     operations / hardening / acceptance
```

Точное содержание каждого инкремента определяется `tz.md`.

---

## I0

Первый инкремент создаёт рабочий технический фундамент проекта.

После I0 должны существовать:

- Next.js application
- TypeScript configuration
- package.json
- package-lock.json
- Dockerfile
- Docker Compose
- PostgreSQL container
- Prisma configuration
- первая миграционная инфраструктура
- seed infrastructure
- runtime validation environment variables
- structured logging
- health/readiness endpoint
- persistent volumes
- test infrastructure
- `.env.example`
- bootstrap/start/stop scripts или эквивалентные команды

I0 должен завершаться реальным запуском системы из чистого состояния.

---

## Запуск

На хосте нужны только **Docker Engine** и **Docker Compose plugin** (Linux x86_64/arm64; для разработки — также Docker Desktop/Colima).
Node.js, npm, Prisma и PostgreSQL на хосте не требуются.

```bash
./scripts/bootstrap.sh   # проверка Docker, каталоги data/ и backups/, .env с новыми секретами
./scripts/deploy.sh      # сборка образов, PostgreSQL, миграции + seed, запуск приложения
```

После `deploy.sh` в консоли выводится адрес (по умолчанию `http://<сервер>:8080`).
Первичные учётные записи: `manager`, `realtor1`, `realtor2`; пароли — в `.env` (`SEED_*_PASSWORD`), при первом входе система требует смену пароля.

### Эксплуатационные команды

В v2.4.1 `deploy.sh` / `update.sh` запускают `app` и фоновый `worker` из единого Node 24 образа
с Chromium и sharp. Диагностика: `docker compose -p crm ps`,
`docker compose -p crm logs --tail=30 worker`, `docker compose -p crm restart worker`.
Проверка браузера без обращения к площадкам и Linux sharp:
`docker compose -p crm exec -T app node scripts/container-smoke.mjs`.
Readiness: `/api/health/ready`. Backup включает фото и миниатюры:
`./scripts/backup.sh`, `./scripts/backup-verify.sh <id>`, `./scripts/restore-test.sh <id>`.
Параметры Chrome, worker и лимиты AI описаны в [инструкции администратора](docs/operations/admin-guide.md).

| Команда | Назначение |
|---|---|
| `./scripts/bootstrap.sh` | первичная подготовка узла (существующий `.env` не перезаписывается) |
| `./scripts/deploy.sh` | развёртывание/повторный запуск (идемпотентно) |
| `./scripts/update.sh` | обновление: защитный backup → сборка → миграции → перезапуск |
| `./scripts/status.sh` | состояние контейнеров и `/api/health` |
| `./scripts/logs.sh [app\|db] [--follow]` | логи без секретов |
| `./scripts/backup.sh [--targets all]` | локальный backup (+ off-site репликация) |
| `./scripts/backup-verify.sh <id>` | проверка checksums/manifest/читаемости |
| `./scripts/backup-list.sh` | список копий |
| `./scripts/restore.sh <id>` | восстановление (с подтверждением и защитным snapshot) |
| `./scripts/restore-test.sh [<id>]` | T08: восстановление в изолированный тестовый контур |
| `./scripts/down.sh` | остановка без удаления данных |

Данные: PostgreSQL — том `postgres_data`; файлы — `./data/files`; резервные копии — `./backups` (рекомендуется дополнительно копировать на другой носитель/NAS).

## Разработка

```bash
npm ci
docker compose -f compose.test.yaml up -d --wait   # PostgreSQL 18 для разработки и тестов (порт 55432)
cp .env.example .env.local                         # затем укажите DATABASE_URL=postgresql://crm:crm_test_password@127.0.0.1:55432/crm_dev
npx prisma migrate deploy && npx prisma db seed
npm run dev
```

Проверки: `npm run lint`, `npm run typecheck`, `npm test` (unit), `npm run test:integration` (integration + authorization на БД `crm_test`), `npm run test:e2e` (Playwright).

## Конфигурация

Шаблон переменных окружения:

```text
.env.example
```

Локальная конфигурация:

```text
.env
```

`.env` не коммитится в Git.

В репозитории запрещено хранить:

- реальные пароли
- raw session tokens
- cloud credentials
- production secrets
- ключи шифрования
- реальные резервные копии
- реальные персональные данные клиентов
- рабочие Excel-файлы предприятия с персональными данными

---

## База данных

Основная СУБД:

```text
PostgreSQL 18
```

ORM:

```text
Prisma ORM 7.x
```

Физическая модель должна соответствовать предметной модели `tz.md`.

К ключевым сущностям относятся:

```text
User
UserSession

Client
ClientContact
ClientContactPerson

LeadRequest
ClientNeed
NeedStageHistory

Property
PropertyOwner
PropertyContactGrant

NeedPropertyMatch
Communication
Showing
Task

Agreement
Advertisement

CommercialOffer
CommercialOfferItem

LegalEntity
Deal
DealParty
DealCommission

Document

HistoricalDealArchive

ImportJob
ImportRowResult

AuditLog
BackupRun
```

Полный перечень сущностей, атрибутов, связей и ограничений определяется `tz.md`.

---

## Основные бизнес-правила

### Потребность клиента

`ClientNeed` имеет самостоятельный жизненный цикл.

Основные состояния:

```text
active
paused
success
closed
```

Для `active` требуется незавершённая задача следующего действия.

Для `paused` требуется задача возврата с контрольной датой.

Для `closed` требуется структурированная причина завершения работы.

`success` фиксирует успешный результат работы по потребности.

Эти правила обеспечиваются серверной бизнес-логикой.

---

### Распределение ответственности

Для обращения по конкретному объекту учитывается действующее правило предприятия:

> «Чей объект, того и клиент».

Точная логика назначения ответственного, включая обработку существующего клиента и доступ к чужой клиентской карточке, определяется `tz.md`.

---

### Дедупликация клиентов

Телефоны и email нормализуются перед поиском дублей.

Автоматическое объединение клиентских карточек не выполняется.

Результат поиска дублей не должен раскрывать риелтору сведения о клиенте, к которому у него отсутствует доступ.

---

### История

Изменение текущего состояния бизнес-сущности не должно уничтожать значимую историческую информацию.

История контактов, этапов, показов, задач, коммерческих предложений и сделок сохраняется согласно модели `tz.md`.

---

### Комиссии

Комиссионные обязательства хранятся отдельно от самой сделки:

```text
Deal
  │
  └── DealCommission
```

Одна сделка может иметь несколько записей `DealCommission`.

Единственное поле `commission_amount` внутри `Deal` для этой модели не используется.

---

### Юридический субъект

Операция может выполняться от имени:

```text
ООО
ИП
```

Для этого используется `LegalEntity`.

Связи `LegalEntity` с Deal, Agreement, CommercialOffer и документами определяются техническим заданием.

---

## Коммерческие предложения

`CommercialOffer` является самостоятельной структурированной сущностью.

Базовая связь:

```text
ClientNeed
    ↓
CommercialOffer
    ↓
CommercialOfferItem
    ↓
Property
```

Условия предложения сохраняются как исторический snapshot.

Последующее изменение актуальной карточки Property не должно менять содержание уже подготовленного предложения.

Редактируемый или сформированный файл коммерческого предложения может храниться как `Document`.

---

## Объекты недвижимости

`Property` используется для разных типов объектов, поддерживаемых предприятием.

Точная структура характеристик зависит от типа объекта.

Модель различает происхождение объекта, включая собственную агентскую базу и внешний рынок, если это предусмотрено `tz.md`.

Контакты собственника имеют более строгие правила доступа, чем общая информация об объекте.

---

## Реклама

`Advertisement` используется для контроля рекламного размещения объекта.

Сущность включает данные, предусмотренные `tz.md`, в том числе:

```text
platform
url
ad_text
status
published_at
last_checked_at
expires_at
```

Core MVP не требует автоматической публикации объявлений на внешние площадки.

---

## Задачи и экран «Сегодня»

`Task` используется для:

- следующего действия
- звонков
- встреч
- повторных контактов
- напоминаний
- контрольных дат
- постсделочных действий

Экран «Сегодня» формируется на основе актуальных задач, показов и других контрольных событий.

Отдельную независимую сущность Reminder создавать не требуется, если иное не установлено `tz.md`.

---

## Постсделочное сопровождение

После завершения сделки CRM должна поддерживать последующие задачи.

Примеры:

```text
tax declaration
rent review
addendum
invoice
acceptance act
return of premises
follow-up
```

Фактический codebook и правила назначения определяются `tz.md`.

---

## Импорт данных

Исходные данные предприятия имеют нестандартную структуру Excel.

Один лист может содержать несколько логических регистров.

Импорт не должен полагаться исключительно на фиксированные номера строк.

Базовый pipeline:

```text
parse
→ normalize
→ policy filter
→ validate
→ duplicate detection
→ candidate mapping
```

Импорт выполняется в два этапа:

```text
dry-run
   ↓
commit
```

Dry-run не должен создавать рабочие записи CRM.

Для строки импорта отдельно хранятся:

```text
validation_status
commit_result
```

Политика импорта должна исключать запрещённые персональные данные до попадания в operational tables и пользовательский preview.

---

## Исторический архив

Исторический реестр прошлых сделок хранится отдельно от текущего операционного контура.

Для этого используется:

```text
HistoricalDealArchive
```

Архив имеет более строгие правила доступа.

Legacy-записи не требуется искусственно превращать в полноценные текущие Deal, если техническое задание этого не предусматривает.

---

## Документы и файлы

Пользовательские файлы хранятся отдельно от PostgreSQL.

В БД сохраняются:

- метаданные
- тип документа
- размер
- MIME type
- checksum
- storage reference
- автор
- время загрузки
- архивный статус
- связи с бизнес-сущностями

Файл выдаётся пользователю только через серверную проверку доступа.

Прямой внутренний storage path пользователю не раскрывается.

---

## Аутентификация

Система использует локальные учётные записи.

Пароли хранятся только в виде Argon2id hash.

Сессии являются серверными и отзывными.

Raw session token хранится на стороне браузера в HttpOnly cookie.

В БД сохраняется hash session token.

Logout инвалидирует сессию.

Деактивированный пользователь теряет доступ.

---

## Авторизация

Проверка доступа выполняется сервером.

Скрытие элемента интерфейса не считается механизмом безопасности.

Отдельно тестируются:

- доступ к чужому Client
- доступ к чужому ClientNeed
- доступ к Deal
- контакты собственников
- исторический архив
- документы
- global search
- административные функции
- прямые API-запросы

Система должна исключать IDOR.

---

## Optimistic concurrency

Для сущностей, где параллельное редактирование может привести к потере изменений, используется контроль по:

```text
updated_at
```

Если запись изменилась после загрузки формы, сервер возвращает conflict response.

UI должен сообщить пользователю о конфликте и позволить обновить данные.

---

## Глобальный поиск

Поиск должен учитывать RBAC.

Пользователь не должен получать запрещённую сущность через:

- название результата
- snippet
- количество найденных объектов
- подробное сообщение об ошибке

Поиск не должен становиться обходным каналом авторизации.

---

## Отчётность

Управленческие показатели рассчитываются на основе первичных событий системы.

В числе рабочих показателей могут использоваться:

- обращения
- источники обращений
- этапы потребностей
- показы
- просроченные задачи
- потребности без движения
- сделки
- повторно активированные клиенты
- пользовательская активность

Точная методика определяется `tz.md`.

---

## Резервное копирование

Локальный backup входит в обязательный core MVP.

Backup должен включать:

```text
PostgreSQL dump
user files
manifest
checksums
```

Наличие backup-файла само по себе не подтверждает работоспособность резервирования.

Успешная проверка требует реального восстановления в отдельную тестовую среду.

---

## Проверка восстановления

Restore test должен подтвердить как минимум:

- восстановление PostgreSQL
- восстановление файлов
- запуск восстановленной системы
- вход пользователя
- наличие контрольных записей
- доступность контрольного файла

Этот сценарий входит в приёмочное тестирование.

---

## Расширения

Техническое задание может предусматривать расширенные эксплуатационные возможности, включая:

- encrypted off-site backup
- несколько backup targets
- portable deployment
- AI-функции

Они не должны задерживать реализацию core MVP, если `tz.md` прямо относит их к более низкому приоритету.

---

## Тестирование

Тестирование выполняется одновременно с разработкой.

Проект предусматривает:

```text
unit tests
integration tests
API tests
authorization tests
e2e tests
```

Тестовые данные должны быть синтетическими.

Реальные персональные данные предприятия запрещено добавлять в:

- fixtures
- seed
- screenshots
- Git
- тестовые отчёты

---

## Definition of Done инкремента

Инкремент считается завершённым, если:

- реализация закончена
- build проходит
- lint проходит
- TypeScript typecheck проходит
- соответствующие unit tests проходят
- integration tests проходят
- authorization tests проходят
- необходимые e2e tests проходят
- миграции применяются к чистой БД
- приложение запускается
- критические известные дефекты отсутствуют
- документация синхронизирована с кодом

---

## Приёмочные сценарии

Core MVP проверяется сценариями:

```text
T01–T10
```

Они охватывают:

- вход и ролевую модель
- новое обращение
- существующего и нового клиента
- жизненный цикл ClientNeed
- подбор объекта
- показ и следующее действие
- отрицательные проверки доступа
- создание сделки
- LegalEntity
- DealCommission
- постсделочную Task
- dry-run/commit импорта
- backup/restore
- управленческий отчёт
- CommercialOffer

Доказательства выполнения хранятся в:

```text
docs/acceptance/
```

Сценарий получает статус PASS только после фактической проверки.

---

## Трассировка требований

Файл:

```text
docs/requirements-traceability.md
```

должен связывать требования с реализацией:

```text
requirement
→ implementation
→ module/file
→ automated test
→ acceptance scenario
→ status
```

Допустимые итоговые статусы:

```text
PASS
PARTIAL
BLOCKED
```

`PARTIAL` и `BLOCKED` должны содержать объяснение.

---

## Работа coding-агентов

Инструкции для coding-агентов находятся в:

```text
AGENTS.md
CLAUDE.md
```

Перед началом работы агент обязан полностью прочитать:

```text
tz.md
```

Coding-агент должен:

- работать внутри существующего репозитория
- самостоятельно принимать обычные инженерные решения
- соблюдать scope
- документировать существенные решения
- писать тесты одновременно с реализацией
- проверять инкремент перед переходом дальше
- не объявлять функцию завершённой без проверки

---

## Git workflow

Этот репозиторий уже является целевым Git-репозиторием проекта.

Повторный `git init` внутри него не требуется.

Рекомендуется создавать логические commits после завершённых и проверенных блоков работы.

Примеры:

```text
chore: bootstrap crm infrastructure

feat: implement authentication and sessions

feat: add client and lead request domain

feat: implement client need lifecycle

feat: add property and matching workflows

feat: implement commercial offers

feat: add deal commission model

feat: implement excel import pipeline

ops: add verified backup and restore workflow
```

Запрещено:

- коммитить secrets
- коммитить `.env`
- коммитить реальные ПДн
- force-push без осознанной необходимости
- переписывать историю репозитория без причины

---

## Что не входит в core MVP

Если `tz.md` прямо не устанавливает обратное, core MVP не включает:

- IP-телефонию
- SMS
- WhatsApp integration
- Telegram integration
- автоматический сбор объявлений с площадок
- автоматическую публикацию объявлений
- OCR
- электронную подпись
- отдельное мобильное приложение
- workflow engine
- event bus
- микросервисную архитектуру
- Kubernetes

Полезные идеи за пределами MVP фиксируются в:

```text
docs/future-backlog.md
```

---

## Документация финальной реализации

После завершения разработки репозиторий должен содержать:

```text
README.md
tz.md
AGENTS.md
CLAUDE.md

docs/
├── requirements-traceability.md
├── data-model-mapping.md
├── implementation-assumptions.md
├── future-backlog.md
├── adr/
└── acceptance/

IMPLEMENTATION_REPORT.md
```

`IMPLEMENTATION_REPORT.md` формируется по фактическому состоянию реализованной системы.

---

## Критерий готовности проекта

Проект можно считать технически готовым, когда:

- приложение воспроизводимо собирается
- Docker Compose запускается с чистого состояния
- PostgreSQL создаётся и мигрируется автоматически
- seed выполняется
- аутентификация работает
- RBAC работает
- основные CRM-сценарии работают
- бизнес-инварианты соблюдаются
- импорт проходит dry-run и commit
- документы защищены серверной авторизацией
- отчёты формируются из данных системы
- backup создаётся
- backup реально восстанавливается
- T01–T10 проверены
- полный test suite проходит
- трассировка требований заполнена

Количество написанного кода само по себе критерием готовности не считается.

---

## Лицензия

Отдельная лицензия проекта пока не установлена.

До появления файла `LICENSE` условия использования и распространения исходного кода определяются владельцем репозитория.

## Что нового в v2.4.1

Ветка feature/tz-v2.4.1 от ba7e6fa; документационный срез 05.11.2026. Добавлены контроль перспективных обращений, специальная задача возврата pause_return, поиск объектов и подборки, persistent AI-бюджет, галерея, редакции КП, чек-лист сделки, календарь и уведомления. Это расширение P1, поэтому прежнее отнесение любого AI/сбора к будущему scope в разделах baseline относится только к v1.6.1.

Фактическая готовность и ограничения: [трассировка](docs/requirements-traceability.md#v241), [приёмка этапа 2](docs/acceptance/stage2-live-ai-ux.md), [протокол испытаний](docs/vkr/test-protocol.md). Итоговые числа тестов и финальный SHA ведутся в единой сводке координатора. Подлинные DEMO/LIVE снимки — [реестр](docs/vkr/screenshots.md). Чистая установка на `d69a3fb`, production build, миграции, вход, PDF и T08 restore/restart подтверждены [отдельным протоколом](docs/operations/clean-deploy-v241.md); финальный HEAD этим прогоном не проверен. WEB-карточки, реальный Excel и NFR-14 на согласованном оборудовании остаются PARTIAL.

### Поиск объектов и ИИ

`/property-search` открывается отдельно или из потребности с needId. Фильтры работают вручную; AI предлагает условия для проверки сотрудником. Закладка → кандидат потребности → явный перенос Property → отдельный факт предложения Match → КП. Нулевой успешный ответ площадки не запускает платный web-резерв; авто допустим только при полном техническом отказе, отдельных разрешениях и бюджете. Статусы источников: success/partial/blocked/timeout/unsupported_filter/error/disabled.

Руководитель: `/settings/ai`, настройки и тарифы; API журнала `/api/v1/ai/usage`, личного остатка `/api/v1/ai/limits`. ENV ограничивает UI. По умолчанию AI, web и скрапер выключены. [Контракт поиска](docs/integrations/property-search-application.md), [скрапер и география](docs/integrations/scraper.md), [Yandex AI и живые проверки](docs/integrations/yandex-ai.md), [API](docs/api.md).

### Календарь и уведомления

`/calendar`: день/неделя/месяц/повестка; Task по сроку, Showing по времени, договорные даты и CalendarEvent. «Сегодня» объединяет действующие источники. Личная занятость другим сотрудникам показывается без названия. `/notifications` и колокольчик: чтение, переход, отложить без изменения срока задачи. Worker доставляет без открытого браузера, догоняет сроки после рестарта, на standby не пишет. Внешние каналы относятся к P3. [Подробности](docs/calendar-notifications.md).

### Новые параметры окружения

Имена и безопасные значения — в [.env.example](.env.example); источник runtime-валидации — `src/shared/config/env.ts`. Ключи задаются только локально на сервере.

| Группа | Переменные / исходные значения |
|---|---|
| Часовой пояс | `APP_TIMEZONE=Asia/Novosibirsk`; UTC в БД сохраняется |
| Доступ к AI | `AI_ENABLED=false`, `YANDEX_CLOUD_API_KEY` пустой, `YANDEX_CLOUD_FOLDER`, `YANDEX_CLOUD_MODEL=aliceai-llm-flash/latest`, `YANDEX_CLOUD_WEB_MODEL` пустой, `YANDEX_CLOUD_BASE_URL=https://ai.api.cloud.yandex.net/v1` |
| Ограничения AI | `YANDEX_AI_STORE_RESPONSES=false`, `YANDEX_AI_MAX_OUTPUT_TOKENS=1800`, `YANDEX_AI_TIMEOUT_MS=30000`, `YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR=30`, `YANDEX_AI_MAX_MONTHLY_COST_RUB=1000` |
| Web-поиск | `YANDEX_WEB_SEARCH_ENABLED=false`, `YANDEX_WEB_SEARCH_AUTO_FALLBACK=false`, `YANDEX_WEB_SEARCH_CONTEXT_SIZE=low`, `YANDEX_WEB_SEARCH_REGION=65`, `YANDEX_WEB_SEARCH_MAX_CALLS_PER_JOB=1`, `YANDEX_WEB_SEARCH_MAX_JOBS_PER_USER_DAY=3`, `YANDEX_WEB_SEARCH_ALLOWED_DOMAINS` пустой |
| Скрапер | `SCRAPER_ENABLED=false`, `SCRAPER_BROWSER_ENABLED=true`, `SCRAPER_CHROME_PATH=/usr/bin/chromium` в Docker, `SCRAPER_JOB_TIMEOUT_MS=180000`, `SCRAPER_MAX_CONCURRENT_JOBS=1`, `SCRAPER_RESULT_TTL_HOURS=24` |
| Записанное демо | `SCRAPER_DEMO_FIXTURES=false`; true — только явно обозначенный тестовый режим |
| Worker | `NOTIFICATIONS_INTERVAL_MS=15000`, существующий `INSTANCE_ROLE=active/standby` |

Для Новосибирска часть площадок требует серверные location/sourceOptions; без них возвращается unsupported_filter, город не заменяется. Начальный потолок 1000 ₽ — предохранитель, не согласованный бюджет. Месячные/суточные лимиты и тарифы сохраняются в БД. Точные условия — в документации интеграций.

### Команды расширения

```bash
npm run db:seed:demo                     # только подготовленная локальная crm_demo
npx tsx src/worker/notifications-worker.ts # локальный worker
# Штатный Docker entrypoint worker — ops/worker/start.mjs:
docker compose up -d worker
docker compose logs --tail=50 worker
```

Очередь поиска v3.1 обслуживает `search-worker` из основного `compose.yaml`,
с тем же образом, что `app`, после успешных миграций. Отдельный Compose overlay больше не нужен.
`docker compose -p crm up -d` запускает оба worker; состояние и журнал:
`docker compose -p crm ps search-worker`, `docker compose -p crm logs --tail=30 search-worker`.
Healthcheck проверяет дочерний процесс, ошибки проходов — JSON-событие
`property_search.queue_tick_failed`. На рабочем стеке `SCRAPER_DEMO_FIXTURES=false`.
При `SCRAPER_ENABLED=false` запуск через API завершается `completed`, источники — `disabled`;
`POST /api/v1/property-search/runs/{id}/cancel` отменяет ожидающий/активный запуск.

Повторы календаря (PL-04/AT-12): если исходного числа нет в целевом месяце,
используется последний день этого месяца. Исходное число сохраняется для следующих
вхождений: 31 января раз в квартал → 30 апреля → 31 июля → 31 октября.
Ежегодное 29 февраля приходится на 28 февраля в невисокосные годы и снова на
29 февраля в високосные. `COUNT` включает каждое фактическое вхождение, включая первое.

Demo seed не применяет миграции и не меняет пароли; его ENV и проверка повторного запуска — [demo-data](docs/vkr/demo-data.md). Для интерактивного демо окружение процесса app задаётся отдельно.

AI-smoke — отдельный opt-in скрипт, npm-команды ai-smoke нет. Примеры ниже выполняют платный синтетический запрос и не входят в обычные тесты. Сначала задайте проверенные тарифы `AI_SMOKE_INPUT_RUB_PER_MILLION`, `AI_SMOKE_OUTPUT_RUB_PER_MILLION`, `AI_SMOKE_TARIFF_EFFECTIVE_FROM`, ключ и разрешённый бюджет; для web дополнительно разрешите web ENV. См. [протокол](docs/integrations/yandex-ai.md).

```bash
npx tsx --env-file=.env scripts/ai-smoke.ts --live
npx tsx --env-file=.env scripts/ai-smoke.ts --live --case=rent
npx tsx --env-file=.env scripts/ai-smoke.ts --live --case=clarification
npx tsx --env-file=.env scripts/ai-smoke.ts --live --web
```

Каждая команда — отдельный вызов без автоматического retry, process-local smoke ledger не заменяет production учёт. Агент документации эти команды не запускал.

Материалы защиты: [архитектура](docs/vkr/architecture.md), [ER](docs/vkr/er-diagram.md), [AS-IS/TO-BE](docs/vkr/as-is-to-be.md), [демонстрация](docs/vkr/demo-guide.md), [испытания](docs/vkr/test-protocol.md), [экономика](docs/vkr/economics.md).

## Этап 2: живой AI и UI/UX

Реализованы печать КП A4 с заполненной обложкой/сравнением, серверный PDF и согласованный DOCX; поиск клиента/потребности по названиям, районы, понятные статусы площадок, диалоги действий и расходов, сравнение результатов; календарные повторения и связи, «Сегодня», уведомления и карточка клиента; читаемые отчёты, эффективные ENV-лимиты/бюджет ИИ и мобильные карточки с нижней панелью. Два P2-помощника готовят черновики заметки после звонка и текста КП, сохраняя данные только после подтверждения сотрудником.

LIVE: путь «запрос → подборка → каталог → КП», частичные отказы, тайм-аут/восстановление, повтор, исправный ноль без web и сохранность после restart проверены. Yandex web технически работает, но конкретных пригодных карточек не дал — **PARTIAL**; Циан CAPTCHA, Авито/Домклик — **BLOCKED**. Основной журнал с финальными parse содержит 5,925000 ₽, отдельный P2 — 0,346900 ₽; это расчёт CRM по usage/тарифам без сверки Cloud billing. Секреты не входят в доказательства.

Независимые находки Iceman/Beam исправлены `9e2b71b` и `f15adc8`. QA зафиксировал unit, PostgreSQL integration/authorization и dev E2E; production build общей копии блокировался EPERM/Deny ACL. Изолированный clean deployment на `d69a3fb` прошёл build/login/PDF/restore/restart; поздний HEAD требует собственной финальной сверки. NFR-14 подтверждён только локально; UAT сотрудников и реальный Excel не закрыты.

Инструкции и доказательства: [пользователь](docs/user-guide.md), [API](docs/api.md), [приёмка этапа 2](docs/acceptance/stage2-live-ai-ux.md), [LIVE](docs/vkr/live-ai-trials.md), [единая сводка тестов](docs/vkr/test-protocol.md), [чистое развёртывание](docs/operations/clean-deploy-v241.md).


### Закрытие дефектов поиска P0-A

[Протокол и границы](docs/vkr/live-search-v31.md#закрытие-дефектов-p0-a): исправлены OnRealt retail rent URL, gzip-транспорт Мир Квартир, извлечение дат и оформление штатного XLSX. Ограниченный LIVE: 4 запуска + 1 перехваченная DEMO-постановка, 0 AI/web_search; бюджет восстановлен. Отмена сохраняет 55 результатов, повтор профиля даёт 68 известных/2 новых, реальные probable межплощадочные группы показаны в UI. AT-07/09 локально PASS; AT-02, естественное изменение цены LIVE и общий production gate остаются PARTIAL. Доказательства и обновлённые кадры — в приёмке v3.1.
