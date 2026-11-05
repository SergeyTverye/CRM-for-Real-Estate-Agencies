# API v1: дополнение v2.4.1

Сверено по фактическим `src/app/api/v1/**/route.ts` на 05.11.2026. Это новые маршруты и прежний экспорт, не полная спецификация baseline. Итоговый SHA добавляет координатор. Р — realtor, М — manager. Все маршруты требуют активную cookie-сессию; api({}) означает authenticated. Ролевая доступность не отменяет scope записи в application-сервисе.

Изменения требуют совпадающий Origin и active instance. JSON body — application/json, upload — multipart/form-data. Ответ — DTO непосредственно, без оболочки data; файлы/CSV/ZIP идут потоком. Ошибка: `{error:{code,message,correlationId,...}}`. 401 — сессия, 403 — запрещённая функция/изменение, 404 — недоступная запись/неверный UUID, 409 — STALE_UPDATE или предметный конфликт, 503 — standby. Общие правила: [api-handler](../src/server/api-handler.ts).

| Метод | Путь / route.ts | Роли и граница | Назначение |
|---|---|---|---|
| POST | [`/api/v1/property-search/parse`](../src/app/api/v1/property-search/parse/route.ts) | Р, М | Разбор {text,currentFilters} → фильтры/вопрос, через AiGate |
| POST | [`/api/v1/property-search/runs`](../src/app/api/v1/property-search/runs/route.ts) | Р, М | Запуск {filters,sources,needId?,savedSearchId?,confirmedPaid?,demoScenario?}; синхронный; при AI подтвердить confirmedPaid=true |
| GET | [`/api/v1/property-search/runs/{id}`](../src/app/api/v1/property-search/runs/%5Bid%5D/route.ts) | Р, М; только свой запуск | Снимки выдачи, источники, критерии; linked needId перепроверяется |
| POST | [`/api/v1/property-search/runs/{id}/web-search`](../src/app/api/v1/property-search/runs/%5Bid%5D/web-search/route.ts) | Р, М; свой запуск | Ручной web без тела, разрешение и бюджет; webSearchUsed блокирует повтор |
| GET | [`/api/v1/property-search/runs/{id}/export`](../src/app/api/v1/property-search/runs/%5Bid%5D/export/route.ts) | Р, М; свой запуск | CSV UTF-8 BOM со ссылками и источниками; повторная проверка доступа к needId |
| GET | [`/api/v1/property-search/bookmarks`](../src/app/api/v1/property-search/bookmarks/route.ts) | Р, М; только свои | Список личных закладок, включая для manager |
| DELETE | [`/api/v1/property-search/bookmarks/{id}`](../src/app/api/v1/property-search/bookmarks/%5Bid%5D/route.ts) | Р, М; только свои | Удаление закладки |
| GET | [`/api/v1/property-search/selections`](../src/app/api/v1/property-search/selections/route.ts) | Р, М; доступная потребность | Кандидаты по ?needId=UUID |
| GET, POST | [`/api/v1/property-search/saved-searches`](../src/app/api/v1/property-search/saved-searches/route.ts) | Р, М; только свои | GET список, POST {name,filters,sources,needId?} |
| PATCH, DELETE | [`/api/v1/property-search/saved-searches/{id}`](../src/app/api/v1/property-search/saved-searches/%5Bid%5D/route.ts) | Р, М; только свои | PATCH поля сохранения и expectedUpdatedAt; DELETE; linked needId перепроверяется |
| POST | [`/api/v1/property-search/listings/{id}/bookmark`](../src/app/api/v1/property-search/listings/%5Bid%5D/bookmark/route.ts) | Р, М | Upsert {status:study/clarify/exclude,note?} |
| POST | [`/api/v1/property-search/listings/{id}/selection`](../src/app/api/v1/property-search/listings/%5Bid%5D/selection/route.ts) | Р, М; доступная потребность | {needId,comment?,reviewStatus?}: candidate/shortlisted/rejected; без Property/Match |
| POST | [`/api/v1/property-search/listings/{id}/transfer`](../src/app/api/v1/property-search/listings/%5Bid%5D/transfer/route.ts) | Р, М | Явный перенос {confirmed:true,identityConfirmed?,...}; повтор возвращает Property; неполные ключи требуют ручного подтверждения |
| POST | [`/api/v1/property-search/listings/{id}/propose`](../src/app/api/v1/property-search/listings/%5Bid%5D/propose/route.ts) | Р, М; доступная потребность | {needId,comment?}: отдельный NeedPropertyMatch после переноса, повтор без дублей |
| POST | [`/api/v1/property-search/listings/{id}/offer`](../src/app/api/v1/property-search/listings/%5Bid%5D/offer/route.ts) | Р, М; доступная потребность | {needId,comment?}: Property в свой draft или новый КП; нужен подтверждённый перенос |
| POST | [`/api/v1/property-search/listings/{id}/clarify`](../src/app/api/v1/property-search/listings/%5Bid%5D/clarify/route.ts) | Р, М; доступ к needId | {needId?,title?,dueAt}: Task уточнения со связями |
| POST | [`/api/v1/property-search/listings/{id}/verification`](../src/app/api/v1/property-search/listings/%5Bid%5D/verification/route.ts) | Р, М | {availability,priceConfirmed?,ownerConfirmed?,note?,nextCheckAt?}: отдельный факт проверки сотрудника |
| GET, POST | [`/api/v1/calendar`](../src/app/api/v1/calendar/route.ts) | Р, М; scope источников | GET from/to/employee?/type?/status?, до 100 дней → items; POST {type,data} через Task/Showing/CalendarEvent |
| POST | [`/api/v1/calendar/move`](../src/app/api/v1/calendar/move/route.ts) | Р, М; право изменения источника | {type,id,startAt,endAt?,expectedUpdatedAt}: перенос исходной записи с инвариантами |
| POST | [`/api/v1/calendar/events`](../src/app/api/v1/calendar/events/route.ts) | Р, М | Создание встречи; 201 с id и warning о пересечении |
| GET, PATCH, DELETE | [`/api/v1/calendar/events/{id}`](../src/app/api/v1/calendar/events/%5Bid%5D/route.ts) | Р, М; изменение только владельцем | GET полная запись или «Занято»; PATCH поля и expectedUpdatedAt; DELETE архив с JSON {expectedUpdatedAt} |
| GET | [`/api/v1/notifications`](../src/app/api/v1/notifications/route.ts) | Р, М; только получатель | Свои доступные уведомления: page/pageSize/state=delivered/read |
| GET | [`/api/v1/notifications/unread-count`](../src/app/api/v1/notifications/unread-count/route.ts) | Р, М; только получатель | {count} для колокольчика |
| POST | [`/api/v1/notifications/read-all`](../src/app/api/v1/notifications/read-all/route.ts) | Р, М; только получатель | Прочитать все доступные уведомления |
| PATCH | [`/api/v1/notifications/{id}`](../src/app/api/v1/notifications/%5Bid%5D/route.ts) | Р, М; только получатель | {action:read} или {action:snooze,until:ISO} |
| POST | [`/api/v1/notifications/{id}/read`](../src/app/api/v1/notifications/%5Bid%5D/read/route.ts) | Р, М; только получатель | Прочитать одно |
| POST | [`/api/v1/notifications/{id}/snooze`](../src/app/api/v1/notifications/%5Bid%5D/snooze/route.ts) | Р, М; только получатель | {until:ISO}, будущее время до года; dueAt исходной задачи не меняется |
| GET, PUT | [`/api/v1/notifications/preferences`](../src/app/api/v1/notifications/preferences/route.ts) | Р, М; только свои | GET настройки, PUT {leadMinutes}: 0–525600 минут |
| GET, PUT | [`/api/v1/settings/ai`](../src/app/api/v1/settings/ai/route.ts) | Только М | GET настройки/тарифы/ENV; PUT с expectedUpdatedAt, аудитом и новыми версиями tariffs |
| GET | [`/api/v1/ai/usage`](../src/app/api/v1/ai/usage/route.ts) | Только М | month=YYYY-MM&page=1: 50 строк/страница, итоги всего месяца |
| GET | [`/api/v1/ai/limits`](../src/app/api/v1/ai/limits/route.ts) | Р, М; только свой остаток | Разрешённые режимы и личные квоты, общий бюджетный остаток без индивидуальных расходов других пользователей |
| GET, POST | [`/api/v1/properties/{id}/media`](../src/app/api/v1/properties/%5Bid%5D/media/route.ts) | Р, М; запись — ответственный Property или М | GET archived=true для архива; POST multipart file,kind=photo/document,documentTypeCode? → 201 |
| PATCH | [`/api/v1/properties/{id}/media/{documentId}`](../src/app/api/v1/properties/%5Bid%5D/media/%5BdocumentId%5D/route.ts) | Ответственный Property или М | PATCH caption,sortOrder,move=up/down,isCover,archived; false восстанавливает связь; глобальный архив требует дополнительных прав |
| GET | [`/api/v1/properties/{id}/media/{documentId}/file`](../src/app/api/v1/properties/%5Bid%5D/media/%5BdocumentId%5D/file/route.ts) | Р, М; documentScope | Авторизованный поток; no-store/nosniff, закрытый документ attachment; без storage keys |
| GET | [`/api/v1/properties/{id}/media/{documentId}/thumbnail`](../src/app/api/v1/properties/%5Bid%5D/media/%5BdocumentId%5D/thumbnail/route.ts) | Р, М; documentScope | Миниатюра с теми же правами |
| GET, POST | [`/api/v1/deals/{id}/checklist`](../src/app/api/v1/deals/%5Bid%5D/checklist/route.ts) | Р, М; GET dealScope, POST ответственный Deal или М | GET пункты и доступные документы; POST идемпотентная инициализация шаблона |
| PATCH | [`/api/v1/deals/{id}/checklist/{itemId}`](../src/app/api/v1/deals/%5Bid%5D/checklist/%5BitemId%5D/route.ts) | Ответственный Deal или М | PATCH {expectedUpdatedAt,status,responsibleUserId?,checkedAt?,documentId?}; none/review/verified/not_required; файл доступен и связан с Deal |
| POST | [`/api/v1/offers/{id}/revision`](../src/app/api/v1/offers/%5Bid%5D/revision/route.ts) | Р, М; loadOffer проверяет доступ | POST {expectedUpdatedAt}: новая draft-редакция с историческими snapshots и аудитом |
| GET | [`/api/v1/reports/detail`](../src/app/api/v1/reports/detail/route.ts) | Только М | metric и фильтры отчёта; по умолчанию newRequests; те же cohorts/временные границы, что KPI |
| GET | [`/api/v1/export/{kind}`](../src/app/api/v1/export/%5Bkind%5D/route.ts) | Р, М; scope реестра | kind=deals/commissions/tasks: CSV UTF-8 BOM, действующие фильтры/RBAC, не manager-only ZIP |
| GET | [`/api/v1/export`](../src/app/api/v1/export/route.ts) | Только М | Сохранённый общий ZIP CSV + manifest |
| GET | [`/api/v1/offers/{id}/pdf`](../src/app/api/v1/offers/%5Bid%5D/pdf/route.ts) | Р, М; offerScope и права файлов | Серверный PDF, application/pdf; attachment offer-{id}.pdf; private, no-store; скачивание не отправляет КП |
| POST | [`/api/v1/ai/call-note`](../src/app/api/v1/ai/call-note/route.ts) | Р, М; доступ к контексту и клиенту | {context:{kind:client/request/need,id},note}: note 1–4000; очищенный AI-предпросмотр, expectedUpdatedAt или null; без записи потребности/задачи |
| POST | [`/api/v1/ai/call-note/confirm`](../src/app/api/v1/ai/call-note/confirm/route.ts) | Р, М; повторная проверка контекста | {context,confirmed:true,filters,task,expectedUpdatedAt}: создание потребности или обновление связанной вместе со следующей задачей |
| POST | [`/api/v1/ai/offer-text`](../src/app/api/v1/ai/offer-text/route.ts) | Р, М; доступ к КП/потребности/клиенту | {offerId,kind:intro/comparison}: текст по snapshots, expectedUpdatedAt; только draft, без сохранения |
| POST | [`/api/v1/ai/offer-text/confirm`](../src/app/api/v1/ai/offer-text/confirm/route.ts) | Р, М; те же права, только draft | {offerId,confirmed:true,text,expectedUpdatedAt}: text 1–8000, проверка чисел; заменяет introText, статус не меняет |
| GET | [`/api/v1/property-search/pick-needs`](../src/app/api/v1/property-search/pick-needs/route.ts) | Р, М; needScope, имя клиента через clientScope | q ≤120, clientId?/needId? UUID; до 20 items {id,label,status,client}; при needId также filters; недоступный needId → 404 |
| GET | [`/api/v1/calendar/links`](../src/app/api/v1/calendar/links/route.ts) | Р, М; scope связи и клиента | type=clientId/needId/propertyId/dealId, q ≤200; {items:[{id,label}]} до 20; имена/адреса вместо UUID |
| GET | [`/api/v1/clients/pick`](../src/app/api/v1/clients/pick/route.ts) | Р, М; clientScope, без archived | q ≤120; {items} до 20: id, displayName, contacts (до одного доступного контакта); API не принимает увеличение take |

## Поля и ограничения

SearchFilters, floor/price/source enums — [runtime schema](../src/modules/property-search/domain/types.ts). Источники: cian/mirkvartir/onrealt/domclick/yandex/youla/avito. Verdict: confirmed/needs_review/rejected. Состояние источника: success/partial/blocked/timeout/unsupported_filter/error/disabled.

CalendarEvent: title, description?, startAt, endAt, allDay?, visibility?, ownerUserId?, recurrenceRule?, clientId?/needId?/propertyId?/dealId?. End позже start. PATCH/DELETE/move требуют expectedUpdatedAt. Редактировать чужую личную встречу manager автоматически не может; GET скрывает данные как «Занято».

Полный transferSchema и действия listing — [listing-service](../src/modules/property-search/application/listing-service.ts). Web-кандидат требует проверяемый первоисточник и проверку сотрудника до предложения/КП. Закладки и SavedSearch личные даже для manager. Запуск и экспорт перепроверяют доступ к связанной потребности.

Печатный HTML — страницы `/offers/{id}/print`, `/properties/{id}/print`, `/deals/{id}/checklist/print`, не дополнительные API. PDF КП выдаётся отдельным авторизованным API выше; HTML и PDF используют общий макет A4. DOCX формируется существующим `POST /api/v1/offers/{id}/document` и сохраняется как Document.

Подтверждения: [приёмка](acceptance/v241), [поиск](integrations/property-search-application.md), [AI](integrations/yandex-ai.md), [календарь](calendar-notifications.md), [галерея](../src/modules/properties/MEDIA.md). Проверки этапа 2 и их ограничения — [протокол](acceptance/stage2-live-ai-ux.md).

### Уточнения контрактов этапа 2

Пикер потребностей возвращает `client:null`, когда имя клиента недоступно; доступ к потребности сам по себе не открывает карточку клиента. Фильтр clientId дополнительно проверяет clientScope. Пикер календаря для потребностей требует и needScope, и clientScope; для сделки проверяет клиентов участников. Неархивный каталог объектов общий.

Для подтверждения заметки task={taskType:call_or_contact/other,title,description:null|string,dueAt:ISO|null}; title 1–300, description ≤4000. При подтверждении dueAt обязателен (`TASK_DUE_REQUIRED`). Для существующей потребности обязательна версия (`VERSION_REQUIRED`); бюджет аренды сохраняется только в rub_month (`BUDGET_UNIT_REQUIRED`). Новая потребность создаётся через действующий сервис со следующей задачей. Предпросмотр не сохраняет исходную заметку в поисковые задания или журнал usage.

AI-команды проходят общий бюджет и ledger. Подтверждающие маршруты не вызывают провайдера повторно. Изменённая версия даёт STALE_UPDATE; неизвестные числа, синтезированные диапазоны и сокращения сумм в тексте КП — AI_UNSUPPORTED_NUMBERS; изменение недрафтового КП — OFFER_FROZEN. Подтверждение comparative-текста также записывает introText.

PDF: Node runtime, route maxDuration=60; Chromium работает offline без JavaScript, service workers и сетевых запросов. Внутренний рендер ограничен 30 секундами и двумя одновременными заданиями на процесс. Тайм-аут закрывает браузер и освобождает слот; изображения берутся только из разрешённых файлов, исходные snapshots не подменяются текущей Property. [Проверка КП](../src/modules/commercial-offers/qa/results.md), [QA](acceptance/qa-stage2.md).
