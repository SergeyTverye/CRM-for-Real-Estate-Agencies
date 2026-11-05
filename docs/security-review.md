# Security review (перед передачей core MVP)

Отдельный проход по чек-листу безопасности (CLAUDE.md §44, ТЗ 12, 27). Для каждого пункта — что проверено,
где реализовано и чем подтверждено.

| Область | Проверка | Реализация | Подтверждение | Итог |
|---|---|---|---|---|
| Сессии | случайный 256-битный токен; в БД только SHA-256; HttpOnly, SameSite=Lax, Secure при HTTPS; срок жизни; отзыв при logout/деактивации/смене и сбросе пароля | `modules/auth/*`, `server/api-handler.ts` | `tests/integration/auth.test.ts`, `admin-users.test.ts` | OK |
| Пароли | Argon2id (m=19 MiB, t=2, p=1); политика длины/состава; временный пароль + обязательная смена; нет самостоятельной регистрации | `auth/infrastructure/password-hasher.ts`, `password-policy.ts`, `users-service.ts` | `tests/unit/auth-rules.test.ts`; e2e вход | OK |
| Перебор паролей | блокировка по login и login+IP, нарастающая задержка, одинаковый ответ `INVALID_CREDENTIALS`, проверка по фиктивному хэшу для несуществующего логина | `login-rate-limiter.ts`, `auth-service.ts` | `auth.test.ts` | OK (ADR-0004: счётчики в памяти одного контейнера) |
| IDOR | каждая выборка и команда строится с `*Scope(actor)`; чужая запись → 404; не-UUID в пути → 404 | `modules/access/domain/scopes.ts`, `assertRecordId`, `assertIdParams` | `tests/authorization/crm-access.test.ts`, `admin-api.test.ts` | OK |
| RBAC | роли manager/realtor проверяются на сервере; UI-скрытие только UX; админ-API `access: "manager"` | `api-handler.ts`, сервисы `requireManager` | `admin-api.test.ts`, `reports-export.test.ts`, e2e | OK |
| Контакты собственника | выдаются только руководителю, ответственному или по действующему grant; маскируются в DTO, поиске, экспорте нет обхода; grant/revoke в AuditLog | `ownerContactsScope`, `getPropertyCard`, `property-service.ts` | `crm-access.test.ts` | OK |
| Файлы | выдача только после проверки доступа к связанной сущности; storage key/путь наружу не выдаётся; allowlist расширений + проверка сигнатуры; лимит размера; очистка имени; `Content-Disposition: attachment`, `nosniff`; без бесхозных файлов при ошибке | `documents/*`, `shared/storage/storage-adapter.ts` | `deals-offers-documents.test.ts`, `unit/file-policy.test.ts` | OK |
| Глобальный поиск | группы строятся только по разрешённым записям, счётчики не возвращаются, контакты собственников не ищутся | `search/application/search-service.ts` | `operations-flow.test.ts`, e2e | OK |
| Дубли клиентов | риелтору при совпадении с чужим Client — нейтральный конфликт без id/имени/ответственного/статуса | `client-service.ts` | `clients-requests.test.ts` | OK |
| Административные функции | пользователи, справочники, юрлица, аудит, импорт, отчёты, архив, экспорт, эксплуатация — только руководитель | `api({access:"manager"})`, `requirePageActor({manager:true})` | authorization-тесты, e2e | OK |
| Импорт и ПДн | паспорт/«выдан»/регистрация/дата рождения исключаются на этапе разбора; не попадают в БД, `import_row_results`, preview, логи; исходный файл — во временном каталоге вне backup, удаляется по завершении | `import/domain/workbook-parser.ts`, `import-service.ts` | `unit/import-parser.test.ts`, `integration/import.test.ts` | OK |
| Логи | JSON (pino), redact паролей/токенов/cookie; в логах идентификаторы, а не ПДн; correlation id связывает запрос, ошибку и AuditLog | `shared/logging/logger.ts`, `audit.ts` | просмотр логов | OK |
| AuditLog | before/after без password_hash, токенов, storage key, crypt-секретов | `audit/application/audit.ts` (`sanitize`) | `admin-users.test.ts` | OK |
| Секреты backup | crypt-пароли и облачные credentials только в `secrets/` (вне БД, Git и backup-набора); manifest без секретов; recovery material — офлайн | `ops/backup/scripts/*`, `scripts/backup-remote-add.sh` | review + Docker-прогон | OK |
| Docker | PostgreSQL только во внутренней сети (без `ports`); наружу — только порт приложения; контейнеры не под root (APP_UID); фиксированные теги образов | `compose.yaml`, `Dockerfile` | `docker compose ps`, чистое развёртывание | OK |
| SQL-инъекции | только Prisma Client и tagged `$queryRaw` с параметрами; `*Unsafe` в коде приложения не используется | grep по `src/` | review | OK |
| XSS | React экранирует вывод; `dangerouslySetInnerHTML` и `eval` не используются; URL объявлений/источников принимаются только `http(s)://` | формы и сервисы | review | OK |
| CSV-инъекции экспорта | значения, начинающиеся с `= + - @`, экранируются апострофом | `export-service.ts` | `reports-export.test.ts` | OK |
| CSRF | изменяющие запросы требуют `Origin` = `Host`; JSON-эндпоинты — `Content-Type: application/json`; cookie SameSite=Lax | `api-handler.ts` | `admin-api.test.ts` | OK |
| Security headers | CSP (prod), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, без `X-Powered-By` | `next.config.ts` | review | OK; CSP содержит `'unsafe-inline'` для скриптов (A-16) |
| Конфигурация | валидация окружения при старте; в production обязательны DEPLOYMENT_ID/INSTANCE_ID/APP_TIMEZONE; слабый пароль БД отклоняется | `shared/config/env.ts` | `tests/unit/config.test.ts` | OK |
| Standby | изменяющие запросы на standby-узле отклоняются (`503 INSTANCE_READ_ONLY`) | `api-handler.ts` | `admin-api.test.ts` | OK |

## Найдено и исправлено в ходе прохода

1. Форма входа не показывала ошибку неверного пароля (клиент перенаправлял любой 401) — введён код `INVALID_CREDENTIALS`.
2. Комментарий руководителя при разрешении обращения дописывался в `summary`, видимый зарегистрировавшему риелтору, — перенесён в AuditLog.
3. Карточка объекта возвращала имя клиента из чужого подбора в JSON (маскировалось только в UI) — маскирование на сервере.
4. Не-UUID идентификатор в URL страницы давал 500 — теперь 404.
5. Риелтор мог архивировать объект через API — архив/восстановление только руководителем.
6. Проверка слабого пароля БД давала ложные срабатывания — заменена разбором пароля из URL.

## Остаточные риски и рекомендации

- Защита от перебора хранится в памяти процесса — при нескольких экземплярах приложения перенести в PostgreSQL.
- CSP с `'unsafe-inline'` для скриптов — рассмотреть nonce-CSP через `proxy.ts`.
- HTTPS в офисной сети не включён по умолчанию (`COOKIE_SECURE=auto`); при внешнем доступе — только через VPN/reverse proxy с TLS (ТЗ 17.1).
- Off-site провайдеры Yandex Cloud / Облако Mail.ru / СберДиск проверены только на уровне конфигурации; перед эксплуатацией — probe и тестовое восстановление на реальных аккаунтах.

## v2.4.1 P0 — вложенные DTO и границы доступа

Проверка 05.11.2026, ТЗ v2.4.1 §10.1. Прежние отметки OK выше не подтверждают отсутствие перечисленных ниже дефектов.

### Найденные утечки и исправления

| Путь | Дефект | Исправление |
|---|---|---|
| `getNeedCard`, `listNeeds`, `getRequestCard`, `listRequests`, `getAgreement`, `listAgreements` | `clientVisible=false` не удалял вложенный Client, его имя, контакты, ответственного и scalar `clientId` | Единые `redactClient` / `redactClientLink` в `access/application/redact-client.ts`: недоступная связь и её FK возвращаются как `null`. Разрешённые данные владельца и руководителя сохраняются |
| `getDeal` | Чужой Client в `parties` и в `commissions.payer`; дубли имени/комментария участника | Общий redactor для обеих веток; дубли имени и комментария закрытого участника удаляются. Вложенные договоры фильтруются `agreementScope` |
| Показы, КП | Вложенный `need.client` возвращался при закрытой клиентской карточке | Redactor применяется и в списках, и в карточках; документы КП дополнительно фильтруются `documentScope` |
| Карточка Property | `property.matches` дублировал исходные подборы с именем чужого клиента, несмотря на отредактированный верхний `matches` | Исходная копия очищена; остаётся уже отредактированный DTO. Клиентские FK вложенных договоров также редактируются |
| Задачи и «Сегодня» | Подпись разрешённой потребности раскрывала чужого клиента; скрытая клиентская ссылка оставляла его ID; `listTasksLinkedTo` обходил `taskScope` | Клиентская подпись проверяется отдельно; закрытые клиентские ссылки не возвращаются; открытые и завершённые задачи ограничены `taskScope`. Вложенные ссылки задач фильтруются по scope соответствующей сущности |
| Следующее действие в списках потребностей, обращений, договоров | Через связанную запись можно было получить заголовок чужой задачи | Вложенные задачи ограничены `taskScope`; недоступные need и next action обращения исключаются |
| Поисковые фильтры и global search | Совпадение по чужому имени в разрешённой родительской записи позволяло обнаружить закрытого клиента | Поиск по `client.displayName` ограничен `clientScope`; поиск по дублированному `externalPartyName` связанного клиента также проверяет его scope |
| Файлы и метаданные документов | OR между связями позволял открыть защищённый документ через дополнительную ссылку на Property/Advertisement | Каждая защищённая связь должна пройти проверку. Публичное фото не отменяет закрытую клиентскую связь. Сканы JPG/PNG проверяются по типу документа, а не MIME. Файлы без разрешённой связи недоступны. Проверка повторяется перед каждым чтением storage |

Коммуникации проверены через карточку потребности и клиентскую timeline: timeline требует доступ к Client, вложенные коммуникации используют `communicationScope`; scalar `clientId` чужого клиента исключён из DTO потребности. Собственные сведения разрешённого обращения (`summary`, `rawContact`) остаются под `leadRequestScope`, отдельно от закрытой клиентской карточки. Экспорт ZIP/CSV и отчёт руководителя сохраняют серверный отказ риелторам; drill-down использует исправленные списки. Политика owner contacts остаётся отдельной: ответственный Property или действующий индивидуальный grant, без открытия Client.

UI изменён только для обработки нового nullable Client: проверки перед ссылкой/действием, нейтральная подпись, отказ от предзаполнения закрытого клиента.

### Тесты и фактическое подтверждение

- `tests/authorization/p0-dto-contract.test.ts`: 19 тестов границы DTO с подменённым слоем БД; проверяют удаление Client/FK, сохранение прав владельца и руководителя, parties/payer, списки и карточки, исходные подборы Property, задачи, применение policy до чтения storage. PASS (19/19). Эти тесты не подтверждают выполнение SQL и чтение реального файла.
- `tests/authorization/p0-nested-dto.test.ts`: PostgreSQL-регрессии с двумя риелторами и руководителем: прямые ID, вложенные данные, контакты, поисковые фильтры/global search, ZIP/CSV, запрет отчётов, скачивание по API, дополнительная публичная связь файла, классификация фото/скана, grant/revoke, задачи/«Сегодня». Повторный запуск после подготовки схемы координатором: **12/12 PASS**, выделенная `crm_test_b`, `TEST_DATABASE_URL` задан явно. Первоначальная блокировка из-за отсутствия `dictionary_items` снята.
- `tests/authorization/p0.vitest.config.mts` наследует test env и alias основного конфига, но намеренно не запускает global setup: стандартный setup выполняет `prisma migrate deploy`, запрещённый для агента безопасности. Работать только с `TEST_DATABASE_URL`, указывающим на выделенную тестовую БД.
- Команды: `npx vitest run --config tests/authorization/p0.vitest.config.mts tests/authorization/p0-dto-contract.test.ts` и аналогично `p0-nested-dto.test.ts`; `npx tsc --noEmit`; целевой `npx eslint` для изменённых файлов.
- Целевой ESLint всех изменённых P0-файлов (включая nullable UI) — PASS, exit 0. Typecheck после DTO/UI-исправлений проходил; итоговый общий прогон выявил ошибку параллельного изменения вне зоны: `src/shared/net/ssrf.ts:53`, TS2353 (`autoSelectFamily` отсутствует в `RequestOptions`). Этот файл не изменялся агентом безопасности; общий typecheck не отмечен PASS.
- Повторный общий typecheck на меняющейся общей копии завершился exit 2: несогласованные экспорты `calendarItems`, `privateProjection`, `CalendarItem` и число аргументов в `src/modules/calendar/application/calendar-service.ts` / `src/app/api/v1/calendar/route.ts`. Ошибок P0-файлов не выведено. Calendar-файлы не изменялись агентом безопасности. Контрактный набор расширен проверками отказа экспорта/отчётов до доступа к БД и построения ограничений global search; итог 19/19 PASS.

### Повторный PostgreSQL-прогон после подготовки схемы координатором

05.11.2026, `TEST_DATABASE_URL` явно указывает на `crm_test_b`. Использован `tests/authorization/p0.vitest.config.mts`: без global setup и без запуска Prisma migrate/generate агентом безопасности. Конфигурация допускает также целевые integration-файлы, выполнение последовательное.

- `p0-nested-dto`, `p0-dto-contract`, `crm-access`, `admin-api`: **4 файла, 43/43 PASS** (9,51 с; 24 PostgreSQL-проверки и 19 контрактных).
- `deals-offers-documents`, `reports-export`, `operations-flow`, `clients-requests`: **4 файла, 26/26 PASS** (10,00 с). Проверены действующие сценарии сделок/КП/файлов, отчётов/экспорта, поиска/«Сегодня», клиентских обращений.
- Всего: **69/69 PASS**, включая **50 проверок с реальной PostgreSQL**. Падений, требующих дополнительных исправлений кода, нет.
- Повторный `npx tsc --noEmit` — **PASS, exit 0** (ранее наблюдавшиеся ошибки параллельных модулей больше не воспроизводятся). ESLint изменённой конфигурации — **PASS, exit 0**; `git diff --check` — **PASS**.
- Логи повторных запусков: `tests/authorization/p0-retest.log`, `tests/authorization/p0-integration-retest.log` (локальные, не включаются в Git).

Изменения схемы и пакеты не нужны. Prisma generate/migrate агентом безопасности не запускались. P0-исправления этой зоны подтверждены PostgreSQL-регрессиями. Новые подборки, уведомления и AI разрабатываются параллельно другими агентами; их будущие application API требуют отдельного SEC-прогона после интеграции. Общий release gate P0, включая backup/restore и прочие зоны, этим отчётом не закрывается.

## Ссылки сверки v2.4.1 для общей приёмки

Документационная сверка 05.11.2026 не заменяет независимый аудит и не меняет результаты P0 выше. Покрытие новых зон: [поиск/RBAC](integrations/property-search-application.md), [AI settings/limits и журнал](integrations/yandex-ai.md), [галерея и документы](../src/modules/properties/MEDIA.md), [календарь/уведомления](calendar-notifications.md), [Docker/restore](operations/docker-v241-verification.md). Ограничения сетевой изоляции Chromium и живых площадок сохранены в [протоколе скрапера](integrations/scraper.md).

Итоговая строка [SEC](acceptance/v241/SEC.md) пока PARTIAL: P0 и отдельные authorization-прогоны подтверждены, общий финальный протокол после объединения всех зон заполняет координатор. Старые OK не переносятся автоматически на новые API. E2E/скриншоты — в процессе; [общий протокол](vkr/test-protocol.md).
