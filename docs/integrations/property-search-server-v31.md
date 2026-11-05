# Сервер поиска v3.1

Продолжение существующего search-модуля; схема и миграции не изменены. UI v2.4.1 необходимо перевести с синхронного ответа на очередь. Платные вызовы и LIVE-площадки при этой работе не использовались.

## Контракты API

Все пути ниже начинаются с `/api/v1/property-search`. Требуются активная сессия и обычные Origin/standby guards. Запуски личные, включая manager; доступ к связанной потребности перепроверяется. `ids` — идентификаторы объявлений (`listingId`), не строк выдачи.

| Метод / путь | Ввод и результат |
|---|---|
| GET `/filter-catalog` | version, AND/OR, типы элементов формы, поля границ диапазонов, единицы и применимость признаков |
| POST `/runs` | `{filters,sources,idempotencyKey,needId?,savedSearchId?,depth?,sourceDepth?,deadlineMs?,sort?,confirmedPaid?,demoScenario?}` → SearchRun в очереди; повтор того же ключа/запроса возвращает тот же id, иной запрос → 409 |
| GET `/runs/{id}/progress` | состояние запуска/источников, heartbeat, deadline, received/accepted, depthReached, duration, причина, действие браузерной сессии |
| POST `/runs/{id}/cancel` | отмена, AbortSignal до адаптера; частичные снимки сохраняются |
| GET `/runs/{id}/results` | `sort,direction,page,pageSize,revision,verdict,source,priceUnit,freshness,unknownDates` → rows,total,counts,revision,incomplete,sources,unknownDateCount |
| POST `/runs/{id}/export` | `{format:csv|xlsx,ids?,columns?,query?}` → файл, `x-search-export-id`; до 10000 строк |
| GET `/runs/{id}/export` | совместимый CSV по умолчанию, `format=xlsx` допустим; сложные условия передавать POST |
| POST `/runs/{id}/bulk` | `{ids,action,data}`; до 100 строк; action=`bookmark|collection|clarify|catalog|propose|offer`; результаты/ошибки каждого элемента |
| POST `/listings/from-url` | `{url,filters,manual?}` → кандидат или manual_required; HTTPS allowlist + DNS/IP guard |
| POST `/imports` | multipart `file,format,source,filters` (JSON), `commit=true|false`; CSV/XLSX/XML до 10 МБ и 1000 строк; dry-run без записи CRM |

Добавление в подборку использует `collections.addItems(actor, collectionId, [{externalListingId}])`; UUID уже выбирает UI через пикер. Экспорт выделенных выполняется через `/export` с `ids`, сравнение — чтением выбранных строк. Bookmark требует `data.status`, collection — `data.collectionId`, clarify — `data.dueAt`; catalog/propose/offer используют существующие схемы подтверждения listing-service и need RBAC. Частичные успехи массовой операции явно возвращаются.

## Фильтры, даты и стабильная выдача

`FEATURE_DEFINITIONS` — единый типизированный реестр метаданных и допустимых ключей. Диапазон признака: `{min?,max?}`, логический признак: boolean. Базовая форма может строиться по каталогу; свободные условия остаются в requiredFeatures/preferredFeatures. Сервер проверяет поля → правила → платный AI только для неразрешённых публичных текстовых условий, при включённых настройках и `confirmedPaid=true`, через существующий бюджет/ledger. AI не подтверждает собственника и не выдумывает числовые измерения. Сбой/лимит оставляет unknown. Метод ручной проверки `employee_check`, автор и время сохраняются записью проверки и аудитом; метка площадки отбрасывается.

Свежесть: `{mode:published|first_seen,period:24h|3|7|30|90|custom,from?,to?,includeUnknown?}`. Собственный диапазон включителен по календарным дням Asia/Novosibirsk, 24h — скользящий интервал. Относительное окно фиксируется временем создания запуска для воспроизводимой пагинации/экспорта. Неизвестная публикация остаётся NULL независимо от sourceUpdatedAt. Основная выдача по публикации её исключает; отдельный блок запрашивается с `unknownDates=true`, `unknownDateCount` помогает отобразить переключатель. includeUnknown используется UI как начальное состояние переключателя; строки блоков сервер не смешивает.

Сортировки: publication,first_seen,source_updated,price,price_per_m2,area,match,last_checked,price_change; direction=asc|desc, NULLS LAST, вторичный ключ r.id. Разные единицы цены/периоды группируются отдельно; `priceUnit` позволяет выбрать одну группу. Годовая/месячная аренда и ставки за м² пересчитываются доменными правилами только при достаточных данных, с основанием расчёта.

На страницах после первой обязателен `revision`. Он учитывает все результаты, выбранные снимки и даты проверок, сортировку и условия, а не только максимальный timestamp. Изменение выдачи → 409 SEARCH_RESULTS_CHANGED, UI должен вернуться на первую страницу. Каждое чтение идёт в REPEATABLE READ. Экспорт начинает собственную версию выдачи и проверяет её до последней страницы; он не ограничен видимой страницей. JSON query.freshness в GET передаётся URL-encoded. counts считаются до ограничения вкладкой verdict. sortScope=`saved_selection`, incomplete и фактическая глубина не означают полноту рынка.

## Очередь и эксплуатация

Локально: `npx tsx src/worker/property-search-worker.ts` с конфигурацией приложения. Контейнер: `docker compose -f compose.yaml -f compose.property-search.yaml up -d --build search-worker`. Overlay использует текущий образ, env, PID healthcheck, миграции и public network; основной notification worker не изменён. Overlay нужно включить в эксплуатационные команды развёртывания. Проверена конфигурация Compose; production build/запуск контейнера в этой задаче не выполнялся.

Один durable слот PostgreSQL на все процессы; источники обрабатываются последовательно. Без Redis. По умолчанию две страницы/100 строк; серверные source-specific потолки `SOURCE_LIMITS` ограничивают depth/sourceDepth. Дедлайн 1–600 секунд (по умолчанию 180), время ожидания очереди включено. Heartbeat каждые 500 мс, stale lease через 60 с. Восстановление возвращает незавершённые источники в queued, завершённые не запрашивает повторно; истёкший дедлайн/отмена завершаются partial. Каждая запись защищена уникальным lease. Снимки одного наблюдения и SearchRunResult не дублируются. Прежние запуски не удаляются при 429/CAPTCHA. Новизна/цена сравниваются с прошлым запуском и более ранними результатами того же поиска при пропущенном источнике. Standby worker не обрабатывает очередь.

AbortSignal доходит до скрапера. Даже игнорирующий его адаптер освобождает слот через 2 секунды после отмены; штатный адаптер дополнительно ограничивает cleanup. Запросы браузерных ресурсов ограничены оставшимся абсолютным бюджетом, SSRF/redirect guards сохранены. XLSX ZIP, XML глубина ≤32 и ≤50000 элементов, размер файла/строки ограничены до обработки. Формульные префиксы импортированных строк экранируются в обоих форматах экспорта.

## CAPTCHA: точка подключения

Межплощадочные группы: после commit вызывается `regroupForListings` (батчи ≤500), для выдачи/экспорта — `getGroupsForListings(actor, ids)` из публичного контракта listing-duplicates. Группы содержат все ссылки за пределами страницы/выделения, освобождённые memberships исключены из экспорта. Ошибка группировки сохраняется отдельно в progress.duplicateGroupingError и возвращается выдачей; принятые объявления сохраняются. Hook подключён к очереди, прежнему синхронному сервису, импорту и продолжению браузерной сессии.

`attachInteractiveSearchAdapter(adapter)` регистрирует готовый SearchContinuationPort в модуле browser-sessions. Он проверяет run/need, повторно валидирует кандидатов, сохраняет их транзакционно, использует именно переданные page/context и закрывает статус при повторной блокировке. prepare/collect конкретного источника обязаны соблюдать его разрешённые условия доступа. Создание сессии выполняется сотрудником через POST `/api/v1/browser-sessions` с `{searchRunId,source}`; это действие возвращается progress/results API.

Production continuation подключён лениво в `browser-sessions/application/dependencies.ts`: `ProductionInteractiveSearchAdapter` строит URL из сохранённого задания, использует текущий page/context и штатный parsePage площадки. Источники включаются оператором через BROWSER_SESSION_ALLOWED_SOURCES после проверки права доступа; отсутствие разрешения — blocked + ручной путь. При повторной блокировке ранее прочитанные карточки сохраняются в исходном запуске. Отмена SearchRun закрывает его интерактивную сессию; progress возвращает её статус только владельцу. Полная цепочка, Docker runtime/sandbox и границы LIVE подтверждены в [CAPTCHA HITL](captcha-hitl.md) и [протоколе](captcha-hitl-production.json).

## Проверки и ограничения приёмки

Целевые тесты: `tests/unit/property-search`, `tests/integration/property-search-server-v31.test.ts`, прежние property-search integration/authorization и коллекции. Сценарии покрывают AT-01/02/03/06/09 на серверном уровне: даты, сортировки, идемпотентность, restart, отмена/дедлайн, CAPTCHA/429, экспорт >200 и selected, API RBAC, переход в подборку и continuation port. UI и реальные площадки требуют общего release gate.

REPLAY `npx tsx scripts/search-quality/evaluate.ts`: 49 зафиксированных LIVE-фрагментов × 4 запроса = 196 случаев. Базовая линия не менялась: falseInclusions 21→12 (14%→8%), falseConfirmed 1→0, falseExclusions 1→1, exactVerdictErrors 27→18. Качество не доказывает полноту новых LIVE-запросов.

Фактический прогон 05.11.2026: unit property-search **445/445**, integration + authorization поиска и подборок **57/57** (6 файлов), ESLint изменённых TS/MJS без предупреждений, Compose overlay config и `node --check` — PASS. Тесты использовали отдельную `crm_test_e`, синтетические данные. Полный tsc проходил на промежуточном срезе; последний запуск сообщил только 4 ошибки параллельного `src/modules/ai/application/listing-analysis-service.ts` (68/83/84/95), в зоне поиска ошибок не было. Нужен общий финальный прогон координатора. Зависимости не устанавливались; Git-операции и schema/migrations не выполнялись.
