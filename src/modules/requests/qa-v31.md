# LE-01 / LE-02 / CL-01 — приёмка v3.1

Рабочая копия `feature/tz-v3.1`, 05.11.2026. Протокол относится к зоне звонков/таймлайна; не подтверждает незавершённую серверную часть поиска.

| Требование | Реализация | Проверка | Результат |
|---|---|---|---|
| LE-01 / AT-13 | Кнопка «Записать звонок» в шапке; существующая RequestForm, время/источник/реклама/объект/внешнее объявление/итог/ответственный; стабильные callOutcome | integration + crm_demo | PASS |
| Перспективный звонок | registerRequest: Client/ClientNeed/Task/LeadRequest и аудит в одной транзакции; обязательная следующая задача; дубли и правило объекта из существующих сервисов | rollback, дубли, новый/существующий клиент, перенесённое внешнее объявление | PASS |
| Неперспективный звонок | spam / wrong / one_time без Client; старый resultCode сохранён | integration, браузерный разовый звонок | PASS |
| LE-02 | /reports/sources; источник/сотрудник/реклама/даты/результат; отдельные звонки и distinct доступных клиентов; числитель/знаменатель; drill-down | SQL на PostgreSQL и браузер | PASS |
| CL-01 / AT-14 | getClientTimelinePage: ограниченные запросы к первичным таблицам с объединением в application; без таблицы-копии истории; каждый источник применяет scope, фильтры и keyset до LIMIT | равновременные записи, создание/выполнение Task, фильтры, документы, PropertyCollectionNeed, сделки | PASS |
| Текущий этап каждой потребности | Отдельный блок всех доступных потребностей независимо от фильтра истории | две потребности + фильтр одной; браузер | PASS |
| RBAC | чужой Client → 404; taskScope + safeTaskTextScope, documentScope; личные подборки только владельцу, командные — по visibility; статистика по leadRequestScope | authorization, прямые API URL, смешанные document/task links, переданный клиент | PASS |

## Контракты и принятые решения

- `POST /api/v1/requests`: обратно совместимый ввод; дополнительные `callAt?`, `externalListingId?`, `outcomeCode?`. Для phone callAt автоматически равен occurredAt; разные моменты отклоняются. Результат звонка проверяется на соответствие outcome.resultCode. Коды: prospective, spam, wrong, one_time; старый no_followup соответствует one_time.
- `GET /api/v1/requests/form-options`: безопасные параметры формы текущего сотрудника, справочники, timezone, доступные назначения.
- `GET /api/v1/requests/pick-context?kind=advertisement|external&q=…`: до 20 публичных подписей за запрос; реклама также поддерживает id для восстановления выбранного фильтра. Нет owner contacts/полных снимков.
- `GET /api/v1/reports/call-sources`: from/to (календарные даты Asia/Novosibirsk), sourceCode, employeeId, advertisementId, outcomeCode; total/sources/conversions.
- `GET /api/v1/reports/call-sources/detail`: те же фильтры + metric=calls/clients/needs/showings/deals, page/pageSize; items/hasNext/page. Метрика clients показывает **звонки доступных клиентов**, а distinct clients остаётся отдельным агрегатом.
- Знаменатель каждой конверсии — все отфильтрованные звонки, включая спам/ошибки/разовые. Числитель — звонки, достигшие этапа, поэтому несколько звонков одного клиента могут попасть в числитель. Потребность — явная связь. Показ — completed после звонка. Сделка — completed после звонка с тем же клиентом и объектом, связанным с потребностью через показ/предложение/КП. Последующие события не ограничиваются периодом звонков. Нулевой знаменатель → percent:null / «—».
- Права статистики совпадают с LeadRequest: свой ответственный / автор / свой клиент. Фильтр чужого сотрудника только сужает этот scope. Доступ к собственному зарегистрированному обращению не раскрывает переданного клиента через unique-clients или конверсии закрытой потребности.
- `GET /api/v1/clients/{id}/timeline`: needId, kind, employeeId, from/to, cursor, pageSize (1–100), eventId? → items/needs/nextCursor. Сортировка: время DESC, тип источника DESC, UUID DESC. Task.creation и Task.completed — разные события с разными sortKind. eventId позволяет открыть конкретную старую коммуникацию по ссылке вне первой страницы.
- Для КП используется sentAt или createdAt, для показа occurredAt или scheduledAt. Автор — creator/author/changer/linker/uploader первичной записи. Этапы потребностей и текущие статусы не копируются в отдельную таблицу.
- Deal не имеет прямого FK к ClientNeed. В фильтре потребности применяется явная связь через TaskNeed + TaskDeal либо тот же клиент и Property из показа/предложения/КП. Через такой же контекст включаются документы и постсделочные задачи сделки. Нельзя восстановить более точную историческую атрибуцию без дополнительной предметной связи.
- Архивные подборки исключаются согласно текущему collection-service; личные не открываются руководителю автоматически. Документы проходят повторную проверку доступа в существующем download API; storageKey и пути не возвращаются.

## Проверки

Отдельная БД `crm_test_g`; global-setup пересоздаёт схему и применяет существующие миграции. Все данные синтетические.

- `vitest run --project integration tests/integration/calls-timeline-v31.test.ts tests/integration/clients-requests.test.ts`: **25 PASS**.
- `vitest run --project authorization tests/authorization/calls-timeline-v31.test.ts tests/authorization/p0-nested-dto.test.ts`: **16 PASS**.
- `tsc --noEmit`: **PASS** на финальном прогоне. В предыдущих прогонах были ошибки незавершённых параллельных правок collections/property-search; чужие файлы не исправлялись.
- Целевой ESLint изменённых TS/TSX/MJS: **PASS**, max-warnings=0.
- `node tests/e2e/calls-timeline-demo.mjs`: **PASS** на crm_demo, порт 3407, webpack и отдельный NEXT_DIST_DIR. Проверены login, модальная форма, разовый звонок без Client, статистика/drill-down, история и фильтр задач, API таймлайна; ошибок JS в финальном прогоне нет. Тест читает SEED_* из .env только в память, не сохраняет cookies/trace/video.
- Скриншоты `data/calls-sources-demo.png`, `data/calls-timeline-demo.png` просмотрены: таблицы/фильтры/этапы читаемы, UUID в UI не показаны. Эти локальные синтетические артефакты и логи в data не предназначены для Git.
- Первый холодный dev-прогон и прогон во время HMR имели ошибки внутреннего роутера Next/оборванного потока; финальный повтор на прогретом сервере прошёл. Это не производственный build/performance gate.

Схема, миграции и зависимости не менялись; npm install не выполнялся. Платные AI/живые площадки не вызывались. Коммиты не создавались. Сервер 3407 после проверки остановлен; из tsconfig удалены только добавленные им include .next-3407, чужие параллельные записи сохранены.
