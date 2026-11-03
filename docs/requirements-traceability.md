# Трассировка требований ТЗ v1.6.1

`требование → реализация (модуль/файлы) → автоматический тест → приёмочный сценарий → статус`

Статусы: **PASS** — реализовано и проверено; **PARTIAL** — реализовано частично (см. пояснение); **BLOCKED** — нужен внешний ресурс; **TODO** — запланировано.
Документ обновляется после каждого инкремента.

## Функциональные требования

| Требование | Реализация | Тест | Сценарий | Статус |
|---|---|---|---|---|
| FR-01 карточка клиента, архивирование | modules/clients | — | T02 | TODO (I2) |
| FR-02 поиск клиента | modules/clients, modules/search | — | T02 | TODO (I2/I3) |
| FR-03 защита от дублей без утечки | modules/clients/domain | — | T02 | TODO (I2) |
| FR-04 несколько потребностей, финансирование/ипотека | modules/needs | — | T03 | TODO (I2) |
| FR-05 объект, собственники, source_type | modules/properties | — | T04/T05 | TODO (I2) |
| FR-06 регистрация обращения, правило ответственного | modules/requests | — | T02 | TODO (I2) |
| FR-07 история коммуникаций | modules/communications | — | T04 | TODO (I3) |
| FR-08 показы и результаты | modules/showings | — | T04 | TODO (I3) |
| FR-09 задачи | modules/tasks/application/task-service.ts | — | T03/T04 | PARTIAL (сервис есть, UI — I2) |
| FR-10 просроченные задачи | modules/tasks/application/task-queries.ts | — | T04 | PARTIAL |
| FR-11 напоминания (договоры, реклама, постсделка) | modules/tasks (getTodayView) | — | T06 | PARTIAL |
| FR-12 карточка сделки | modules/deals | — | T06 | TODO (I4) |
| FR-13 ИП/ООО | legal_entities, modules/deals, agreements, commercial-offers | — | T06/T10 | TODO (I4) |
| FR-14 файлы и фото | modules/documents | — | T05/T06 | TODO (I4) |
| FR-15 комментарии | поля notes/comment | — | T02–T06 | TODO |
| FR-16 реклама | modules/advertisements | — | — | TODO (I3) |
| FR-17 разграничение доступа | modules/access/domain/scopes.ts, server/api-handler.ts | tests/integration/auth.test.ts, tests/authorization/* | T01/T05 | PARTIAL (I1 — роли/админка) |
| FR-18 архив только руководителю | modules/archive | — | T05 | TODO (I5) |
| FR-19 журналирование | modules/audit | tests/integration/admin-users.test.ts | шаг 12 | PARTIAL |
| FR-20 импорт Excel/CSV | modules/import | — | T07 | TODO (I5) |
| FR-21 экспорт ZIP/CSV | modules/export | — | — | TODO (I5) |
| FR-22 базовые отчёты | modules/reports | — | T09 | TODO (I5) |
| FR-23 инварианты ClientNeed | modules/needs/domain/need-invariant.ts | — | T03 | PARTIAL |
| FR-24 история этапов | need_stage_history | — | T04 | TODO (I2) |
| FR-25 экран «Сегодня» | modules/tasks (getTodayView) | — | T04 | PARTIAL (запрос есть, UI — I3) |
| FR-26 повторяющиеся задачи | modules/tasks/domain/task-rules.ts | tests/unit/task-rules.test.ts | — | PARTIAL |
| FR-27 видимость клиентов/каталога/контактов | modules/access | — | T05 | PARTIAL |
| FR-28 управленческая аналитика | modules/reports | — | T09 | TODO (I5) |
| FR-29 администрирование учётных записей | modules/users, api/v1/admin/users | tests/integration/admin-users.test.ts, auth.test.ts | T01 | PASS (API; UI — I2) |
| FR-30 grant на контакты собственника | modules/properties | — | T05 | TODO (I3) |
| FR-31 глобальный поиск с RBAC | modules/search, ui/shell/global-search.tsx | — | T02–T06 | TODO (I3) |
| FR-32 договоры | modules/agreements | — | T04/T06 | TODO (I3) |
| FR-33 статус backup в UI | modules/operations | — | T08 | TODO (I5) |
| FR-34/36 off-site multi-target | ops/backup/scripts/replicate.sh | — | T08 | TODO (I5, P2) |
| FR-35 профиль Excel с секциями | modules/import, import-profiles | — | T07 | TODO (I5) |
| FR-37/38 server/portable | compose.yaml, scripts | — | T11 | TODO (расширение) |
| FR-39 коммерческое предложение | modules/commercial-offers | — | T10 | TODO (I3/I4) |
| FR-40–42 AI | — | — | T12 | вне core MVP (P3) |

## Нефункциональные требования

| Требование | Реализация | Проверка | Статус |
|---|---|---|---|
| NFR-06 PostgreSQL | postgres:18.6, Prisma 7 | deploy на чистой копии | PASS |
| NFR-07/08 backup и восстановление | ops/backup/scripts, scripts/backup.sh, restore.sh, restore-test.sh | T08 на чистой копии (I0) | PARTIAL (без документов до I4) |
| NFR-09 пароли не в открытом виде | Argon2id | tests/unit/auth-rules.test.ts | PASS |
| NFR-10 проверка на сервере | api-handler + scopes | tests/authorization | PARTIAL |
| NFR-11 журналирование | AuditLog | tests/integration/admin-users.test.ts | PARTIAL |
| NFR-15 данные переживают перезапуск | named volume + bind mounts | ручная проверка down/up (I0) | PASS |
| NFR-16 структурированные логи | pino, correlation id, redact | ручная проверка логов | PASS |
| NFR-18 лимит/allowlist файлов | config MAX_UPLOAD_MB, UPLOAD_ALLOWED_EXTENSIONS | — | TODO (I4) |
| NFR-21 серверная пагинация | shared/validation zPagination | — | PARTIAL |
| NFR-22 только Docker на хосте | Dockerfile, compose.yaml, scripts/ | bootstrap+deploy на чистой копии | PASS |
