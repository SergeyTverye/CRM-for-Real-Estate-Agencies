# Трассировка требований ТЗ v1.6.1

`требование → реализация (модуль/файлы) → автоматический тест → приёмочный сценарий → статус`

Статусы: **PASS** — реализовано и проверено автоматическим тестом и/или фактическим прогоном; **PARTIAL** — реализовано частично (см. пояснение); **BLOCKED** — нужен внешний ресурс. Пути модулей — относительно `src/modules/`.

## Функциональные требования

| Требование | Реализация | Автоматический тест | Сценарий | Статус |
|---|---|---|---|---|
| FR-01 карточка клиента, архивирование | clients/application/client-service.ts, client-queries.ts; UI `(crm)/clients` | integration/clients-requests.test.ts; authorization/crm-access.test.ts | T02 | PASS |
| FR-02 поиск клиента по ФИО/телефону | client-queries.ts `clientSearchWhere`; search/search-service.ts | integration/operations-flow.test.ts (поиск) | T02 | PASS |
| FR-03 дубли без утечки чужого Client | clients/application/client-service.ts `checkDuplicates/assertNoDuplicates` | integration/clients-requests.test.ts | T02 | PASS |
| FR-04 несколько потребностей, финансирование/ипотека | needs/application/need-service.ts | integration/need-lifecycle.test.ts | T03 | PASS |
| FR-05 объект, собственники, source_type | properties/application/*; import профили | authorization/crm-access.test.ts; integration/import.test.ts | T04/T05 | PASS |
| FR-06 обращение, источник, правило ответственного | requests/application/request-service.ts | integration/clients-requests.test.ts | T02 | PASS |
| FR-07 история коммуникаций | communications/application/communication-service.ts; клиентская лента `getClientTimeline` | integration (через need-lifecycle/operations-flow) | T04 | PASS |
| FR-08 показы и результаты | showings/application/showing-service.ts | integration/operations-flow.test.ts | T04 | PASS |
| FR-09 задачи | tasks/application/task-service.ts | integration/need-lifecycle.test.ts | T03/T04 | PASS |
| FR-10 просроченные задачи | tasks/application/task-queries.ts | integration/operations-flow.test.ts | T04 | PASS |
| FR-11 напоминания договоров/рекламы/постсделки, ежегодная задача | task-queries.ts `getTodayView` (контрольные даты), agreements (reminderDaysBefore), deals (postdeal) | integration/operations-flow.test.ts; deals-offers-documents.test.ts; unit/task-rules.test.ts | T06 | PASS |
| FR-12 карточка сделки | deals/application/deal-service.ts | integration/deals-offers-documents.test.ts | T06 | PASS |
| FR-13 ИП/ООО для сделки/договора/КП/документа | deals, agreements, commercial-offers, documents (наследование legal_entity_id) | integration/deals-offers-documents.test.ts; operations-flow.test.ts | T06/T10 | PASS |
| FR-14 файлы и фото | documents/application/document-service.ts; shared/storage | integration/deals-offers-documents.test.ts; unit/file-policy.test.ts | T05/T06 | PASS |
| FR-15 свободные комментарии | notes/comment во всех карточках | — (UI-формы) | T02–T06 | PASS |
| FR-16 реклама: площадка, URL, статус, сроки | advertisements/application/advertisement-service.ts | integration/operations-flow.test.ts | — | PASS |
| FR-17 разграничение доступа | access/domain/scopes.ts; server/api-handler.ts | authorization/*.test.ts | T01/T05 | PASS |
| FR-18 архив только руководителю | archive/application/archive-service.ts | integration/reports-export.test.ts | T05 | PASS |
| FR-19 журналирование | audit/application/audit.ts; Администрирование → Журнал | integration/admin-users.test.ts; deals-offers-documents.test.ts; crm-access.test.ts | шаг 12 | PASS |
| FR-20 импорт Excel | import/* | integration/import.test.ts; unit/import-parser.test.ts | T07 | PASS |
| FR-21 экспорт ZIP/CSV + manifest | export/application/export-service.ts | integration/reports-export.test.ts | — | PASS |
| FR-22 базовые отчёты | reports/application/report-service.ts | integration/reports-export.test.ts | T09 | PASS |
| FR-23 инварианты ClientNeed | needs/domain/need-invariant.ts + CHECK в БД | integration/need-lifecycle.test.ts; operations-flow.test.ts | T03 | PASS |
| FR-24 история этапов и причины закрытия | need_stage_history (from/to stage+status, reason) | integration/need-lifecycle.test.ts; operations-flow.test.ts | T04 | PASS |
| FR-25 «Сегодня» с группами | task-queries.ts `getTodayView`; UI `(crm)/today` | integration/operations-flow.test.ts | T04 | PASS |
| FR-26 повторяющиеся задачи | tasks/domain/task-rules.ts; completeTask | unit/task-rules.test.ts; integration/need-lifecycle.test.ts | — | PASS |
| FR-27 риелтор — свои клиенты, каталог всем, контакты по правилу | access/domain/scopes.ts | authorization/crm-access.test.ts | T05 | PASS |
| FR-28 управленческая аналитика (воронка, без движения) | report-service.ts | integration/reports-export.test.ts | T09 | PASS |
| FR-29 администрирование учётных записей | users/application/users-service.ts | integration/admin-users.test.ts; auth.test.ts; authorization/admin-api.test.ts | T01 | PASS |
| FR-30 grant/revoke контактов собственника | properties/application/property-service.ts | authorization/crm-access.test.ts | T05 | PASS |
| FR-31 глобальный поиск с RBAC | search/application/search-service.ts; ui/shell/global-search.tsx | integration/operations-flow.test.ts; e2e/smoke.spec.ts | T02–T06 | PASS |
| FR-32 договоры: срок, эксклюзив, причина отсутствия, действие | agreements/application/agreement-service.ts | integration/operations-flow.test.ts | — | PASS |
| FR-33 статус backup в UI, ручной запуск | operations/application/operations-service.ts; UI `(crm)/operations` | Docker-прогон (docs/acceptance/T08.md) | T08 | PASS |
| FR-34, FR-36 off-site multi-target, независимые статусы, повтор ошибочных | ops/backup/scripts/replicate.sh, probe.sh; scripts/backup-remote-*.sh | Docker-прогон с filesystem target (docs/acceptance/T08.md) | T08 | PARTIAL — провайдер filesystem проверен; Yandex Cloud/Облако Mail.ru/СберДиск — BLOCKED до получения учётных данных заказчика (шаблоны и probe готовы) |
| FR-35 профиль Excel, секции, mapping, dry-run, отчёт | import/domain/*, import-profiles/*.json; UI `(crm)/import` | unit/import-parser.test.ts; integration/import.test.ts | T07 | PARTIAL — профили построены по описанию ТЗ 38 на синтетическом образце; подтверждение mapping на фактическом файле предприятия выполняется на пробном импорте |
| FR-37, FR-38 server/portable | compose.yaml, scripts/bootstrap-portable.sh, promote/demote, standby guard | authorization/admin-api.test.ts (standby) | T11 | PARTIAL — standby/promote и bootstrap реализованы; полный T11 на Windows-хосте не проверялся |
| FR-39 коммерческое предложение со snapshot и Document | commercial-offers/application/* | integration/deals-offers-documents.test.ts | T10 | PASS |
| FR-40–FR-42 AI | — | — | T12 | Вне core MVP (P3, `AI_ENABLED=false`); таблица `ai_runs` создана, адаптер не реализован |

## Нефункциональные требования

| Требование | Реализация | Проверка | Статус |
|---|---|---|---|
| NFR-01 минимум действий | быстрая форма обращения, «Сегодня», быстрые действия | e2e/smoke.spec.ts; UAT — у заказчика | PARTIAL (UAT впереди) |
| NFR-02 современные браузеры | Next.js 16, desktop-first | Playwright Chromium | PASS |
| NFR-03–06 локальное развёртывание, PostgreSQL, без лицензий | Docker Compose, PostgreSQL 18 | bootstrap+deploy на чистой копии | PASS |
| NFR-07/08 backup и проверяемое восстановление | ops/backup, scripts/backup.sh, restore.sh, restore-test.sh | T08 в изолированном контуре | PASS |
| NFR-09 пароли Argon2id | auth/infrastructure/password-hasher.ts | unit/auth-rules.test.ts | PASS |
| NFR-10 проверка прав на сервере | scopes + api-handler | authorization/* | PASS |
| NFR-11 журналирование | AuditLog | integration/* | PASS |
| NFR-12 минимизация ПДн | исключение паспортных полей при импорте, нет даты рождения | unit/import-parser.test.ts; integration/import.test.ts; unit/codebook-migration.test.ts | PASS |
| NFR-13 расширяемость (телефония, площадки) | LeadRequest/Communication/Advertisement без привязки к поставщику | архитектурный review | PASS |
| NFR-14 производительность | индексы ТЗ 29.12, серверная пагинация | замер на целевом сервере — до M6 | PARTIAL (замер на сервере предприятия) |
| NFR-15 данные переживают перезапуск | volume + bind mounts | down/up на чистой копии | PASS |
| NFR-16 структурированные логи | pino, correlation id, redact | просмотр логов | PASS |
| NFR-17 ежедневный backup, хранение 14 копий | backup.sh (ротация), cron в инструкции | Docker-прогон | PASS |
| NFR-18 лимит/allowlist файлов | documents/domain/file-policy.ts | unit/file-policy.test.ts; integration/deals-offers-documents.test.ts | PASS |
| NFR-19/20/25 client-side encryption, независимость targets | replicate.sh (rclone crypt) | Docker-прогон (filesystem) | PARTIAL — облачные провайдеры BLOCKED (нет учётных данных) |
| NFR-21 серверная пагинация (50/200) | shared/validation.ts zPagination | все списки | PASS |
| NFR-22 только Docker на хосте | Dockerfile, compose.yaml, scripts | чистая копия | PASS |
| NFR-23/24/26/27 portable, single-writer | standby guard, promote/demote, config bundle без ключей | authorization/admin-api.test.ts | PARTIAL |
| NFR-28–31 AI | — | — | Вне scope (P3) |


## P1-А v2.4.1 — рабочий контур, 05.11.2026

| Требование | Модуль | Проверка | Статус |
|---|---|---|---|
| §2 перспективные обращения, причины завершения, запрет закрытия no_match | requests, needs | p1a-workflow | PASS |
| §2 очереди контактов today/overview | requests/contact-control | p1a-workflow (выборка); браузерная приёмка не выполнялась | PARTIAL |
| §10.2 pause_return, атомарное продолжение, перенос/повтор | needs, tasks | p1a-workflow | PASS |
| §10.2 метрики, одинаковые cohorts детализации, границы времени/источник/сотрудник | reports | p1a-workflow | PASS |
| §2 постсделочный набор, связи Task | deals | p1a-workflow | PASS |
| §7 редакции КП и снимки | commercial-offers | p1a-workflow, p1a-access | PASS |
| §7 DOCX фото/ссылки/реквизиты, печатные HTML | commercial-offers, export | DOCX ZIP проверен; визуальная печать не проверена | PARTIAL |
| §7 чек-лист, файл сделки, RBAC/OCC | deals/checklist | p1a-workflow, p1a-access | PASS |
| §7 реестры CSV с фильтрами и RBAC | export/register-export | p1a-workflow, p1a-access | PASS |

Подробности и ограничения: [p1a-working-contour.md](p1a-working-contour.md). Целевой набор — 11/11 PASS; общий typecheck не PASS из-за ошибок параллельного demo seed. Общая готовность релиза здесь не утверждается.

<a id="v241"></a>
## Дополнение v2.4.1: разделы 2–11

Срез 05.11.2026, feature/tz-v2.4.1 от ba7e6fa. Новое ТЗ имеет приоритет в явно изменённых требованиях; прежние PASS относятся к baseline и не заменяют приёмку расширения. Пути модулей ниже относительно src/modules, если не указано иначе. PASS — конкретные автотесты/протоколы, PARTIAL — указанная незакрытая часть. Общая готовность P1 пока PARTIAL.

| Требование | Модуль / файлы | Тесты / свидетельства | Статус |
|---|---|---|---|
| §10.1 SEC | `access/application/redact-client.ts; access/domain/scopes.ts; documents` | [тесты и фактический протокол](acceptance/v241/SEC.md) | PARTIAL |
| §2 LEAD | `requests/application/request-service.ts; tasks; requests/contact-control` | [тесты и фактический протокол](acceptance/v241/LEAD.md) | PASS |
| §3, §3.1 SEARCH | `property-search/domain; property-search/application; ai/domain/provider-parse.ts` | [тесты и фактический протокол](acceptance/v241/SEARCH.md) | PARTIAL |
| §4 SCRAPER | `property-search/infrastructure/scraper-adapter.ts; shared/net/ssrf.ts` | [тесты и фактический протокол](acceptance/v241/SCRAPER.md) | PARTIAL |
| §4 WEB | `property-search/domain/fallback.ts; application/search-service.ts; ai/domain/gate.ts` | [тесты и фактический протокол](acceptance/v241/WEB.md) | PASS |
| §5 AI | `ai/application/settings-service.ts; ai/infrastructure; API settings/ai` | [тесты и фактический протокол](acceptance/v241/AI.md) | PASS |
| §3.2 LINK | `property-search/application/listing-service.ts; matching/application` | [тесты и фактический протокол](acceptance/v241/LINK.md) | PASS |
| §6 MEDIA | `properties/application/property-media-service.ts; documents/application/property-media-response.ts` | [тесты и фактический протокол](acceptance/v241/MEDIA.md) | PASS |
| §7 OFFER-DOC | `commercial-offers/application; deals/application/checklist-service.ts; export/application/register-export.ts` | [тесты и фактический протокол](acceptance/v241/OFFER-DOC.md) | PARTIAL |
| §8 CAL-NOTIF | `calendar/application; notifications/application; src/worker; compose.yaml` | [тесты и фактический протокол](acceptance/v241/CAL-NOTIF.md) | PARTIAL |
| §10.2 REPORT-PAUSE | `reports/application/report-service.ts; needs/domain; tasks/application` | [тесты и фактический протокол](acceptance/v241/REPORT-PAUSE.md) | PASS |
| §11 IMPORT | `import/domain/workbook-parser.ts; import/application` | [тесты и фактический протокол](acceptance/v241/IMPORT.md) | PARTIAL |
| §9, §11 VKR | `docs/vkr; docs/acceptance/v241; scripts/demo; tests/e2e` | [тесты и фактический протокол](acceptance/v241/VKR.md) | PARTIAL |
| §2 постсделочный набор с выбранными исполнителями/сроками и связями Task | `deals/application`, `tasks/application` | [p1a-workflow](../tests/integration/p1a-workflow.test.ts), [протокол](p1a-working-contour.md) | PASS |
| §3.1 признаки: structured → rules → AI, отрицания и цитаты | `property-search/domain/evaluation.ts`, `ai/infrastructure/search-ai.ts` | [domain](../tests/unit/property-search/domain.test.ts), [search-ai](../tests/unit/ai/search-ai.test.ts), [скрапер](integrations/scraper.md) | PASS |
| §3.2 история цены/новизны, сохранённые поиски и версия формы | `property-search/application/search-service.ts`, `listing-service.ts` | [integration](../tests/integration/property-search.test.ts), [протокол](integrations/property-search-application.md) | PASS |
| §3.2 факты площадки отдельно от проверки сотрудника | `ExternalListingSnapshot`, `ExternalListingVerification`, `listing-service.ts` | [integration](../tests/integration/property-search.test.ts), [протокол](integrations/property-search-application.md) | PASS |
| §4 семь источников, лимиты географии/пагинации, отсутствие обхода CAPTCHA | `property-search/infrastructure`, `vendor/real-estate-scrapper-2.1.0.tgz` | [adapter unit](../tests/unit/property-search/adapter.test.ts), [ограничения](integrations/scraper.md); live не подтверждён | PARTIAL |
| §4–5 очищенный AI-ввод, sourceMethod, evidence, без слепого доверия описанию | `property-search/domain/evaluation.ts`, `ai/domain`, `ai/infrastructure` | [search-ai unit](../tests/unit/ai/search-ai.test.ts), [network](../tests/unit/property-search/network.test.ts), [AI-протокол](integrations/yandex-ai.md) | PASS |
| §5 таймзона, отчётные границы, повторы | `shared/time.ts`, `calendar`, `reports`, `notifications` | [time unit](../tests/unit/time.test.ts), [p1a-workflow](../tests/integration/p1a-workflow.test.ts), [calendar integration](../tests/integration/calendar-notifications.test.ts); итоговый браузерный прогон в процессе | PARTIAL |
| §6 очередь/повтор файлов, обложка, EXIF, thumbnail и права | `properties/application/property-media-service.ts`, `documents` | [MEDIA](acceptance/v241/MEDIA.md), [restore](operations/docker-v241-verification.md) | PASS |
| §7 исходные snapshot КП и новая редакция draft, явная отправка | `commercial-offers/application/offer-service.ts` | [p1a-workflow](../tests/integration/p1a-workflow.test.ts), [протокол](p1a-working-contour.md) | PASS |
| §7 нейтральный HTML/DOCX, реестры CSV и чек-лист | `commercial-offers/application`, `deals/application/checklist-service.ts`, `export/application` | [OFFER-DOC](acceptance/v241/OFFER-DOC.md); визуальная печать/PDF не приняты | PARTIAL |
| §8 приватность, сроки без фиктивной длительности, отдельные встречи | `calendar/application`, `calendar/domain`, `notifications/application` | [calendar authorization](../tests/authorization/calendar-notifications.test.ts), [unit](../tests/unit/calendar-notifications.test.ts), [протокол](calendar-notifications.md); общий UI в процессе | PARTIAL |
| §11 обновление документации и материалы защиты | README, IMPLEMENTATION_REPORT, docs/api, docs/vkr, docs/acceptance/v241 | [протокол испытаний](vkr/test-protocol.md), [методика экономики](vkr/economics.md); финальные числа/E2E/скриншоты заполняет координатор | PARTIAL |
| §9 визуальные токены, 360 px, фокус, работа сотрудников | `src/ui`, `(crm)/layout`, новые страницы | Код; итоговые E2E/скриншоты в процессе, пользовательская проверка не оформлена | PARTIAL |
| §11 Docker, миграция, backup/restore и worker restart | `compose.yaml`, `Dockerfile`, `scripts/restore-test.sh` | [Docker-протокол](operations/docker-v241-verification.md), вход/файл/галерея восстановлены | PASS |
| §11 чистая установка именно v2.4.1 | bootstrap/deploy | Docker-протокол проверяет обновление существующего стека; отдельного clean-install протокола нет | PARTIAL |
| §11 NFR-14 | Индексы, пагинация | Не измерено на согласованном оборудовании | PARTIAL |
| §11 три одновременных пользователя | app/worker/db | Не измерено; три роли в последовательных тестах не являются нагрузкой | PARTIAL |
| §11 Playwright и скриншоты | `tests/e2e`, `docs/vkr/screenshots` | В процессе, обновляет координатор | PARTIAL |
| §11 повтор T01–T10 на финальном SHA | `docs/acceptance/T01.md`–`T10.md` | Модульные регрессии есть; финальная общая сверка в [протоколе](vkr/test-protocol.md) ещё не заполнена | PARTIAL |

Координатор сообщил unit **301/301**, integration+authorization **152/152**; итоговые логи/SHA добавляются в [протокол](vkr/test-protocol.md). Модульные числа не суммируются. Live-площадки SCRAPER — PARTIAL: записанные синтетические ответы и запуск Chromium не доказывают живой сбор. Реальный Excel — PARTIAL по прямому требованию ТЗ. Материалы ВКР и расчёт измеренного/прогнозного эффекта — [docs/vkr](vkr).
