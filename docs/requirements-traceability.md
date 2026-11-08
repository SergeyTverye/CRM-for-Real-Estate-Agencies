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
| FR-40–FR-42 AI | `ai/application`, `ai/infrastructure`, `property-search` | [этап 2](acceptance/stage2-live-ai-ux.md), [LIVE](vkr/live-ai-trials.md) | AI v2.4.1 | PARTIAL: Yandex AI/бюджет/P2 реализованы; WEB без пригодных карточек; исходный T12 не заменяется этой проверкой |

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
| NFR-14 производительность | индексы ТЗ 29.12, серверная пагинация | [локальные 3 пользователя, p95 ≤259 мс](operations/perf-v241.md) | PARTIAL: оборудование предприятия не проверено |
| NFR-15 данные переживают перезапуск | volume + bind mounts | down/up на чистой копии | PASS |
| NFR-16 структурированные логи | pino, correlation id, redact | просмотр логов | PASS |
| NFR-17 ежедневный backup, хранение 14 копий | backup.sh (ротация), cron в инструкции | Docker-прогон | PASS |
| NFR-18 лимит/allowlist файлов | documents/domain/file-policy.ts | unit/file-policy.test.ts; integration/deals-offers-documents.test.ts | PASS |
| NFR-19/20/25 client-side encryption, независимость targets | replicate.sh (rclone crypt) | Docker-прогон (filesystem) | PARTIAL — облачные провайдеры BLOCKED (нет учётных данных) |
| NFR-21 серверная пагинация (50/200) | shared/validation.ts zPagination | все списки | PASS |
| NFR-22 только Docker на хосте | Dockerfile, compose.yaml, scripts | чистая копия | PASS |
| NFR-23/24/26/27 portable, single-writer | standby guard, promote/demote, config bundle без ключей | authorization/admin-api.test.ts | PARTIAL |
| NFR-28–31 AI | Серверный Yandex adapter, AiGate, обезличивание, подтверждение | [AI](integrations/yandex-ai.md), [этап 2](acceptance/stage2-live-ai-ux.md) | PARTIAL: расширение v2.4.1 реализовано; границы живой проверки отражены отдельно |


## P1-А v2.4.1 — рабочий контур, 05.11.2026

| Требование | Модуль | Проверка | Статус |
|---|---|---|---|
| §2 перспективные обращения, причины завершения, запрет закрытия no_match | requests, needs | p1a-workflow | PASS |
| §2 очереди контактов today/overview | requests/contact-control | p1a-workflow; [браузерная приёмка этапа 2](acceptance/calendar-ux-p1.md) | PASS |
| §10.2 pause_return, атомарное продолжение, перенос/повтор | needs, tasks | p1a-workflow | PASS |
| §10.2 метрики, одинаковые cohorts детализации, границы времени/источник/сотрудник | reports | p1a-workflow | PASS |
| §2 постсделочный набор, связи Task | deals | p1a-workflow | PASS |
| §7 редакции КП и снимки | commercial-offers | p1a-workflow, p1a-access | PASS |
| §7 DOCX фото/ссылки/реквизиты, печатные HTML | commercial-offers, export | [экспорт: PDF/DOCX и просмотр страниц](../src/modules/commercial-offers/qa/results.md), `e48ea2a` | PASS |
| §7 чек-лист, файл сделки, RBAC/OCC | deals/checklist | p1a-workflow, p1a-access | PASS |
| §7 реестры CSV с фильтрами и RBAC | export/register-export | p1a-workflow, p1a-access | PASS |

Подробности и ограничения: [p1a-working-contour.md](p1a-working-contour.md). Первоначальный целевой набор PASS; промежуточная ошибка typecheck demo seed устранена последующими изменениями. Актуальные результаты и ограничения — [единая сводка](vkr/test-protocol.md).

<a id="v241"></a>
## Дополнение v2.4.1: разделы 2–11

Срез 05.11.2026, feature/tz-v2.4.1 от ba7e6fa. Новое ТЗ имеет приоритет в явно изменённых требованиях; прежние PASS относятся к baseline и не заменяют приёмку расширения. Пути модулей ниже относительно src/modules, если не указано иначе. PASS — конкретные автотесты/протоколы, PARTIAL — указанная незакрытая часть. Общая готовность внешних интеграций и UAT остаётся PARTIAL; актуальные доказательства этапа 2 приведены ниже.

| Требование | Модуль / файлы | Тесты / свидетельства | Статус |
|---|---|---|---|
| §10.1 SEC | `access/application/redact-client.ts; access/domain/scopes.ts; documents` | [тесты и фактический протокол](acceptance/v241/SEC.md) | PASS |
| §2 LEAD | `requests/application/request-service.ts; tasks; requests/contact-control` | [тесты и фактический протокол](acceptance/v241/LEAD.md) | PASS |
| §3, §3.1 SEARCH | `property-search/domain; property-search/application; ai/domain/provider-parse.ts` | [тесты и фактический протокол](acceptance/v241/SEARCH.md) | PARTIAL |
| §4 SCRAPER | `property-search/infrastructure/scraper-adapter.ts; shared/net/ssrf.ts` | [тесты и фактический протокол](acceptance/v241/SCRAPER.md) | PARTIAL |
| §4 WEB | `property-search/domain/fallback.ts; application/search-service.ts; ai/domain/gate.ts` | [протокол](acceptance/v241/WEB.md), [LIVE](vkr/live-ai-trials.md) | PARTIAL результата, механизм PASS |
| §5 AI | `ai/application/settings-service.ts; ai/infrastructure; API settings/ai` | [тесты и фактический протокол](acceptance/v241/AI.md) | PASS |
| §3.2 LINK | `property-search/application/listing-service.ts; matching/application` | [тесты и фактический протокол](acceptance/v241/LINK.md) | PASS |
| §6 MEDIA | `properties/application/property-media-service.ts; documents/application/property-media-response.ts` | [тесты и фактический протокол](acceptance/v241/MEDIA.md) | PASS |
| §7 OFFER-DOC | `commercial-offers/application; deals/application/checklist-service.ts; export/application/register-export.ts` | [тесты и фактический протокол](acceptance/v241/OFFER-DOC.md), [этап 2](acceptance/stage2-live-ai-ux.md) | PASS проверенных нейтральных выгрузок |
| §8 CAL-NOTIF | `calendar/application; notifications/application; src/worker; compose.yaml` | [протокол](acceptance/v241/CAL-NOTIF.md), [UX этапа 2](acceptance/calendar-ux-p1.md) | PASS проверенных сценариев |
| §10.2 REPORT-PAUSE | `reports/application/report-service.ts; needs/domain; tasks/application` | [тесты и фактический протокол](acceptance/v241/REPORT-PAUSE.md) | PASS |
| §11 IMPORT | `import/domain/workbook-parser.ts; import/application` | [тесты и фактический протокол](acceptance/v241/IMPORT.md) | PARTIAL |
| §9, §11 VKR | `docs/vkr; docs/acceptance/v241; scripts/demo; tests/e2e` | [тесты и фактический протокол](acceptance/v241/VKR.md) | PARTIAL |
| §2 постсделочный набор с выбранными исполнителями/сроками и связями Task | `deals/application`, `tasks/application` | [p1a-workflow](../tests/integration/p1a-workflow.test.ts), [протокол](p1a-working-contour.md) | PASS |
| §3.1 признаки: structured → rules → AI, отрицания и цитаты | `property-search/domain/evaluation.ts`, `ai/infrastructure/search-ai.ts` | [domain](../tests/unit/property-search/domain.test.ts), [search-ai](../tests/unit/ai/search-ai.test.ts), [скрапер](integrations/scraper.md) | PASS |
| §3.2 история цены/новизны, сохранённые поиски и версия формы | `property-search/application/search-service.ts`, `listing-service.ts` | [integration](../tests/integration/property-search.test.ts), [протокол](integrations/property-search-application.md) | PASS |
| §3.2 факты площадки отдельно от проверки сотрудника | `ExternalListingSnapshot`, `ExternalListingVerification`, `listing-service.ts` | [integration](../tests/integration/property-search.test.ts), [протокол](integrations/property-search-application.md) | PASS |
| §4 семь источников, лимиты географии/пагинации, отсутствие обхода CAPTCHA | `property-search/infrastructure`, `vendor/real-estate-scrapper-2.1.0.tgz` | [adapter unit](../tests/unit/property-search/adapter.test.ts), [ограничения](integrations/scraper.md); [живые испытания](vkr/live-ai-trials.md): частичный сбор, Циан CAPTCHA/Авито/Домклик blocked | PARTIAL |
| §4–5 очищенный AI-ввод, sourceMethod, evidence, без слепого доверия описанию | `property-search/domain/evaluation.ts`, `ai/domain`, `ai/infrastructure` | [search-ai unit](../tests/unit/ai/search-ai.test.ts), [network](../tests/unit/property-search/network.test.ts), [AI-протокол](integrations/yandex-ai.md) | PASS |
| §5 таймзона, отчётные границы, повторы | `shared/time.ts`, `calendar`, `reports`, `notifications` | [time unit](../tests/unit/time.test.ts), [p1a-workflow](../tests/integration/p1a-workflow.test.ts), [calendar integration](../tests/integration/calendar-notifications.test.ts); [календарный UX и E2E](acceptance/calendar-ux-p1.md) | PASS |
| §6 очередь/повтор файлов, обложка, EXIF, thumbnail и права | `properties/application/property-media-service.ts`, `documents` | [MEDIA](acceptance/v241/MEDIA.md), [restore](operations/docker-v241-verification.md) | PASS |
| §7 исходные snapshot КП и новая редакция draft, явная отправка | `commercial-offers/application/offer-service.ts` | [p1a-workflow](../tests/integration/p1a-workflow.test.ts), [протокол](p1a-working-contour.md) | PASS |
| §7 нейтральный HTML/DOCX, реестры CSV и чек-лист | `commercial-offers/application`, `deals/application/checklist-service.ts`, `export/application` | [OFFER-DOC](acceptance/v241/OFFER-DOC.md); [экспорт/просмотр PDF и DOCX](../src/modules/commercial-offers/qa/results.md), `e48ea2a` | PASS |
| §8 приватность, сроки без фиктивной длительности, отдельные встречи | `calendar/application`, `calendar/domain`, `notifications/application` | [calendar authorization](../tests/authorization/calendar-notifications.test.ts), [unit](../tests/unit/calendar-notifications.test.ts), [протокол](calendar-notifications.md); [этап 2: повторы/пикеры/приватность](acceptance/calendar-ux-p1.md) | PASS |
| §11 обновление документации и материалы защиты | README, IMPLEMENTATION_REPORT, docs/api, docs/vkr, docs/acceptance/v241 | [протокол испытаний](vkr/test-protocol.md), [приёмка этапа 2](acceptance/stage2-live-ai-ux.md), реестр DEMO/LIVE | PASS |
| §9 визуальные токены, 360 px, фокус, работа сотрудников | `src/ui`, `(crm)/layout`, новые страницы | [Мобильные 360/430 px](acceptance/P1-reports-ai-mobile.md), [QA](acceptance/qa-stage2.md); пользовательская приёмка отдельно не оформлена | PARTIAL |
| §11 Docker, миграция, backup/restore и worker restart | `compose.yaml`, `Dockerfile`, `scripts/restore-test.sh` | [Docker-протокол](operations/docker-v241-verification.md), вход/файл/галерея восстановлены | PASS |
| §11 чистая установка именно v2.4.1 | bootstrap/deploy | [изолированный clone d69a3fb](operations/clean-deploy-v241.md): build/migrate/seed/login/PDF/restore/restart; поздний HEAD отдельно не проверен | PASS на указанном SHA |
| §11 NFR-14 | Индексы, пагинация | Локально 3 пользователя/3 мин, 0 ошибок 5xx/409, p95 ≤259 мс; целевое согласованное оборудование не подтверждено ([замер](operations/perf-v241.md)) | PARTIAL |
| §11 три одновременных пользователя | app/worker/db | Локальный прогон: три одновременных пользователя в течение 3 минут; 0 ошибок 5xx/409 | PASS (локальный замер) |
| §11 Playwright и скриншоты | `tests/e2e`, `docs/screenshots/vkr` | [QA этапа 2](acceptance/qa-stage2.md), подлинные DEMO/LIVE PNG ([реестр](vkr/screenshots.md)); итоговый пересчёт у координатора | PASS |
| §11 повтор T01–T10 на финальном SHA | `docs/acceptance/T01.md`–`T10.md` | Модульные регрессии есть; результаты отдельных прогонов сохранены, окончательный SHA и общую сводку заполняет координатор в [протоколе](vkr/test-protocol.md) | PARTIAL |

Первоначальные проверки на `8d30d92` — исторический этап 1. Актуальная сводка этапа 2 находится в [test-protocol](vkr/test-protocol.md); числа финального прогона заполняет координатор. Реальный Excel и NFR-14 на согласованном оборудовании остаются PARTIAL.

## Этап 2 — живой AI и UI/UX

Срез `29273a9..e48ea2a`, 05.11.2026. Доказательства не заменяются утверждением общей готовности.

| Требование | Реализация / доказательство | Статус |
|---|---|---|
| Полный LIVE путь до КП, частичный отказ, повтор, ноль, restart | [LIVE-журнал](vkr/live-ai-trials.md), [JSON](vkr/live-ai-evidence.json) | PASS ограниченных сценариев |
| Автоматический и ручной web | Реальные tool calls, строгие URL, 0 пригодных карточек; [матрица](acceptance/stage2-live-ai-ux.md) | PARTIAL результативности, механизм PASS |
| Доступность площадок | Циан CAPTCHA, Авито/Домклик blocked; другие источники сохранили выдачу | BLOCKED перечисленных площадок, общий сбор PARTIAL |
| Расходы, ENV/эффективные лимиты и бюджет | [AI](integrations/yandex-ai.md), [UX бюджета](acceptance/P1-reports-ai-mobile.md), usage JSON | PASS контроля CRM; Cloud billing не сверялся |
| КП A4/PDF/DOCX, snapshots и AI-текст | [экспорт](../src/modules/commercial-offers/qa/results.md), `91c6fc4`, `e48ea2a`, [P2 JSON](vkr/p2-live-ai-evidence.json) | PASS проверенных макетов/черновиков |
| Именные пикеры, районы, состояния, диалоги, сравнение | `18c88d9`, `f15adc8`, picker tests, [экраны](vkr/screenshots.md) | PASS проверенных сценариев, UAT отдельно |
| Повторения/связи, Сегодня, уведомления, клиент | `3396fe3`, `9e2b71b`, [протокол](acceptance/calendar-ux-p1.md) | PASS |
| Отчёты, эффективные квоты, mobile 360/430 и диалоги | `de1b6d2`, [протокол](acceptance/P1-reports-ai-mobile.md), [QA](acceptance/qa-stage2.md) | PASS проверенных экранов, UAT отдельно |
| P2 разбор заметки с подтверждением потребности/Task | `0df8a35`, `9e2b71b`, [JSON](vkr/p2-live-ai-evidence.json), p2-ai-drafts tests | PASS ограниченного сценария |
| Независимые Iceman/Beam и исправления | `9e2b71b`, `f15adc8`, [приёмка этапа 2](acceptance/stage2-live-ai-ux.md) | PASS исправлений по сохранённым свидетельствам |
| Тесты/скриншоты/чистая установка | [единая сводка](vkr/test-protocol.md), [clean d69a3fb](operations/clean-deploy-v241.md) | PASS зафиксированных проверок; общий production QA PARTIAL из-за ACL |
| NFR-14 | [локальный замер](operations/perf-v241.md) | PARTIAL, не целевой сервер |

Полная матрица с расходами, SHA, ограничениями P2 и условиями PASS — [stage2-live-ai-ux](acceptance/stage2-live-ai-ux.md).

## v3.2.1 SQLite backend, этап 2 — 06.11.2026

| Требование | Модуль / исполняемое доказательство | Статус |
|---|---|---|
| DT-05 / §4.1 все повседневные модули SQLite | shared/db facade/dialect, search results/export, AI independentCommitScope; integration-sqlite 360/360 | PASS backend |
| DT-06 / §4.2 PG → SQLite | scripts/desktop/migrate-pg-to-sqlite.ts; desktop-transfer 2/2; реальный HTTP login/list/file/page | PASS синтетического переноса |
| §4.2 пустая база/демо, собственный руководитель, случайные секреты, update snapshot | scripts/desktop/init-db.ts, database-lifecycle.ts, sqlite/lifecycle | PASS |
| DT-17 двойная backend regression | PG 342/342, SQLite общий набор 342/342 +18 desktop, npm test 1438/1438 | PASS backend; installer/OS отдельный gate |

Отчёт расхождений, файлы, ограничения и команды: [SQLite этап 2](desktop/sqlite-stage2.md).

## v3.2.1 — опубликованный срез b4a9e27, 07.11.2026

Дополнение, не переписывающее исторические результаты выше. Источники: публичные отчёты и обезличенные подтверждения координатора из задания. Автор документации не запускал проверки и не читал закрытые материалы. Последний опубликованный срез `b4a9e27` не равен проверенному production APP_COMMIT `11a2778`. **Полный выпуск не готов к объявлению PASS.**

| Требование | Реализация / проверка / доказательство | Приёмка | Статус и недостающая часть |
|---|---|---|---|
| §3/5/13 Windows offline installer и lifecycle | Подтверждение координатора: CI `7e7e47e`, run `42293184755`, Node 24.15.0 — unit/SQLite/desktop bundle-artifact guard прошли, NSIS компилируется; следующий b4a9e27 run queued. Native cap=4/shared lock опубликованы в b4a9e27; dead-PID recovery (отдельный набор 44 теста) и autocleanup ещё реализуются, не закоммичены | DT-01–04/15–20 | PARTIAL; EXE/checksum и installed lifecycle не подтверждены, незавершённые изменения не объявлены готовыми. Чистые Win10/11 BLOCKED по решению пользователя; текущий ПК/Actions Windows Server не замена |
| §4 два backend, точность/RBAC | [Итоговая QA](acceptance/desktop-v32/regression-final.md): unit/browser 1514 PASS / 5 skip; исходно PG 362 PASS / 1 harness FAIL, SQLite 384 PASS / 1 такой же harness FAIL / 1 skip. Прямой повтор координатора 4/4 PASS, PG+SQLite, 33.32 s снял оба отказа обвязки: покрытие PG 363/363, SQLite 385 PASS / 1 skip по full-run плюс repeat, не новый чистый full-run. [SQLite production](acceptance/desktop-v32/sqlite-production.md): 22 PASS / 0 FAIL, actual restore, clean image 11a2778 | DT-05/06/17 | PARTIAL полного production/installer gate. QA host Node 22.23.4, production Node 24.22.2, Windows CI Node 24.15.0 — разные окружения; установленная CRM не проверена |
| §6–8 локальный/USB backup | [DT-08](acceptance/desktop-v32/DT-08.md): физический E:, Disk 2 BusType USB, copy/decrypt/restore и SHA 7 MiB файла PASS | DT-07/08 | PASS модуля; полный DT PARTIAL: unplug только injected, installed picker/restore не проверены |
| §7 два независимых облака, очередь/retry | [LIVE модуль](acceptance/desktop-v32/cloud-module-live.md): архив 7 354 253 байта, два cloud restore с контролем БД/файла, 2 S3 parts / 8 Mail.ru chunks, 2 fault injections, queue reload/failed-only retry/cleanup PASS | DT-09–12/25/26 | PASS модуля; полные DT PARTIAL: нет installed restore, физического network disconnect и IAM least-privilege proof; anonymous GET/LIST 403 не заменяет последнее |
| §10 настройки руководителя | [UI/API](desktop/backup-settings-api.md): manager-only в server/desktop, фактические realtor API/page 403; отдельные UI read/list probes 2/2 | DT-09/10/27 | PASS ограниченного UI/RBAC; полный installed backup/restore PARTIAL |
| §9 single-writer handoff и конфликт | Модульный restore не является тестом двух установок | DT-13/14 | PARTIAL; требуется фактический перенос и конфликт двух установленных CRM, без обещания offline fencing/multi-writer |
| §2/13 сохранение server PostgreSQL | [Server production](acceptance/desktop-v32/server-production.md), актуальный clean-image rerun: миграции/seed, 3 concurrent sessions, RBAC/документы, импорт/экспорт, restart, pg_dump/files/verify, изолированный pg_restore/3 fresh login/control rows/file SHA PASS. APP_COMMIT `11a27784bdead108483ca058bfa72179597fb8fe`, image `sha256:965356828d986cddf1f61ffd175e4629b124b0f4e31d9dad2502cbadd2e60d8e`, production Node 24.22.2/PG 18.6. Образ уже существовал, runner не пересобирал; dirty run сохранён только как исторический | DT-21 | PASS ограниченного clean-image server gate; полный DT PARTIAL: не весь production/release gate b4a9e27 и не upgrade v3.1 |
| §12.1 локальный real-workbook import | [Excel](acceptance/desktop-v32/excel-local-verification.md): PG+SQLite, 24 boolean checks = 1 на каждом, errors={}, 359 строк = 122 imported +128 hidden excluded +106 rejected +3 probable dupes; unresolved 0; rollback/idempotency/retry/reimport zero/RBAC/SHA/cleanup PASS | DT-22 | PASS verifier; DT PARTIAL: неоднозначные rejected и неподдерживаемая контрольная таблица; профиль исправлен координатором, не опубликован |
| §12.1 обратный Excel, precision/geometry | [Excel](acceptance/desktop-v32/excel-local-verification.md): 0 mismatches для 122 keys/186 fields/32 money/90 contacts/90 dates/6 sheets geometry/4640 numformats/90 headers, names/sections/order. Parser 64 PASS /5 optional skip, export 14 PASS суммарно (7 PostgreSQL + 7 SQLite) | DT-23 | PARTIAL: 41 UNSUPPORTED_COLUMN, 32 HYPERLINK_CLEARED, 90 UNSUPPORTED_FIELD, 15 images. FORMULA_CLEARED=0 при отсутствии формул — не proof formula preservation |
| §11/12 конфиденциальность | [Security review](acceptance/desktop-v32/security-review.md): подтверждённых P0/P1 (CRITICAL/HIGH) в проверенной области нет; статическое ревью не является Windows lifecycle evidence. Предыдущий аудит в [DT-24](acceptance/desktop-v32/DT-24.md); verifier source SHA/cleanup/RBAC PASS, реальные строки не передавались делегатам | DT-24 | PARTIAL: artifact/security gate установленного EXE отсутствует; новый аудит всей истории не выполнялся |
| §13/15 общий offline/online release gate | [Матрица](acceptance/desktop-v32/README.md), [QA](acceptance/desktop-v32/regression-final.md): desktop backup 46 PASS / 2 MinIO skip, cloud synthetic 10 PASS, USB synthetic 4 PASS, backup UI 3 server + 3 desktop PASS. Targeted export 14 всего (7 PG + 7 SQLite). Три DEMO screenshot не доказательство установки | DT-27 | PARTIAL; полные PG/SQLite production DT, Windows/installer evidence остаются открытыми, clean Win10/11 BLOCKED; synthetic suites не подменяют LIVE/installed restore |

## Поиск v3.2.2: исправления по результатам LIVE AI (2026-11-08)

| Требование / дефект | Реализация | Проверка | Статус |
|---|---|---|---|
| AI-01: явная цена, площадь, этаж, операция не теряются | ai/domain/listing-analysis.ts, preview/confirm | REPLAY SearchAi + preservation; точный запрос и подтверждение; уточнение бюджета аренды | PASS |
| AI-02: неизвестный период не становится total | nullable ExternalListing.priceUnit, PG/SQLite migrations; snapshot priority; UI и сравнение | persistence, неизвестный период в AI DTO, несовместимость цен, populated SQLite upgrade/FK/index checks | PASS |
| Пункт 13: отдельное AI-ранжирование 2–10 выбранных | listing-analysis-service, SearchAi.rankListings, analysis/rank API, ListingAnalysisPanel | fake, cache/concurrency/invalidation, budget, provider failure, ID/criterion validation, API auth/disabled, UI границы | PASS |
| sort=match: объяснимый score | Только preferredFeatures, обозначен в UI как сортировка без ИИ | Без предпочтений 0, подтверждённая парковка 100 | PASS |
| AI-03: сетевая ошибка официального Yandex не ломает core | Контролируемая AI_CALL_FAILED, независимая readiness | injected fetch reject/abort на официальном URL, успешный ручной поиск и ready 200 на PG/SQLite | PASS |

Область доказательства — автоматические REPLAY/fake проверки; новый платный LIVE прогон не проводился. Команды и итоговые результаты: [v322-ai-fixes.md](vkr/v322-ai-fixes.md).
