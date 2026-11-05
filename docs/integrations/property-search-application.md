# Поиск объектов: прикладной слой и UI

Реализация ТЗ v2.4.1 §3–4. Вход: `/property-search`, из потребности — `/property-search?needId=<uuid>`.

## Контракты

- `application/search-service.ts`: `runSearch`, `parseQuery`, `manualWebSearch`, `getSearchRun`, `exportSearchCsv`.
- `application/listing-service.ts`: личные закладки, кандидаты, явный перенос, предложение через matching, КП через commercial-offers, уточнение через tasks, отдельная проверка сотрудника, SavedSearch CRUD, предзаполнение потребности.
- `application/dependencies.ts`: фабрика persistent SearchAi. Все вызовы модели идут через SearchAi/AiGate. При `AI_ENABLED=false` модель не создаётся. `configureSearchAi` — серверная точка внедрения для тестов.
- `/api/v1/property-search/runs` POST; `/runs/{id}` GET; `/runs/{id}/web-search` POST; `/runs/{id}/export` GET.
- `/parse` POST `{text,currentFilters}`; `/bookmarks` GET; `/bookmarks/{id}` DELETE; `/selections?needId=...` GET.
- `/saved-searches` GET/POST; `/saved-searches/{id}` PATCH/DELETE. PATCH требует `expectedUpdatedAt`.
- `/listings/{id}/{bookmark,selection,transfer,propose,offer,clarify,verification}` POST.

Поиск синхронный, общий предел ожидания — `SCRAPER_JOB_TIMEOUT_MS`; адаптер также ограничивает каждый источник и конкуренцию. После истечения срока адаптер может завершать cleanup; его поздний результат не записывается. Частичный отказ сохраняет выдачу. Автоматический веб-резерв только по `decideFallback`; окончательное решение о бюджете принимает AiGate. `webSearchUsed` резервируется атомарно ДО вызова провайдера, включая ошибки, поэтому повторной оплаты при повторе команды нет. Состояние web_search хранится отдельным источником с объяснением ошибки/лимита.

Цена сравнивается по snapshot предыдущего полностью успешного прогона SavedSearch. Просмотр старого прогона использует его snapshot. Частичный прогон не заменяет lastSuccessfulRunId. Идентичность `(source,sourceListingId,sourceUnitId)` сериализуется advisory lock; NULL unit означает одиночное помещение. Строки без listing ID не объединяются автоматически. Перенос защищён блокировкой строки ExternalListing, повтор возвращает существующий Property. Повтор не перезаписывает ручные изменения Property. Matching и КП вызываются через существующие сервисы; команда кандидата не создаёт Property/Match. Повторные предложения этого интерфейса возвращают существующий Match.

Проверка сотрудника сохраняется исключительно в ExternalListingVerification и не перезаписывает факты площадки. При новом поиске последнее подтверждение собственника добавляется к доверенным данным оценки. Неизвестная единица цены сохраняется в normalized snapshot; сравнение всегда использует исходную единицу. Для Property копируется только полная цена продажи либо месячная аренда объекта, без неявного пересчёта.

Все операции с needId проверяют `loadAccessibleNeed`, включая запуск сохранённого поиска и чтение старого запуска. Запуски, закладки и сохранённые поиски личные, в том числе для руководителя. При потере доступа к потребности сохранённый поиск скрывается. Внешние URL проверяются SSRF guard при переносе и принятии web-кандидата. Изображения площадок не загружаются и не показываются. Веб-цитата не доказывает характеристики; без проверки сотрудника и явного переноса создать предложение/КП нельзя.

## Записанные ответы для ВКР

`SCRAPER_DEMO_FIXTURES=true` включает `tests/fixtures/scraper/*.json`, отключает сетевой scraper и явно показывает плашку. В панели доступны сценарии success / partial / failure / empty. Фикстуры сохраняют исходную синтетическую географию (большинство — Москва): для совпадений выберите соответствующий город. Частичный сценарий требует двух включённых площадок.

Демо уважает ENV и AiSetting: включите `SCRAPER_ENABLED` и scraperEnabled, выберите enabledSources. Для демонстрации веб-резерва нужны `AI_ENABLED`, `YANDEX_WEB_SEARCH_ENABLED`, `YANDEX_WEB_SEARCH_AUTO_FALLBACK`, соответствующие разрешения AiSetting и действующий тариф. В этом режиме модель — явный FakeResponsesProvider с mode=test; вызов проходит persistent AiGate и учитывается в лимитах, но не обращается к платному провайдеру. Без ИИ все ручные действия поиска и сохранённые кандидаты доступны.

## Проверки

Выделенная БД: `crm_test_c`, конфигурация `tests/property-search.vitest.config.mts`. Она намеренно НЕ применяет миграции и НЕ генерирует Prisma.

```powershell
$env:TEST_DATABASE_URL='postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_c'
npx vitest run --config tests/property-search.vitest.config.mts
```

Фактически пройдено 25 проверок integration/authorization/domain regression. Дополнительно проходят существующие unit-тесты домена/адаптера (отдельный запуск). E2E и screenshot QA переданы отдельному агенту. Живая доступность площадок и платный Yandex smoke этим прогоном не подтверждаются.

Известные ограничения: списки сохранённых записей ограничены 200, интерактивные уточнения действий реализованы простыми диалогами браузера; фотографии площадок не используются. Полный общий typecheck может зависеть от параллельно изменяемых файлов, его результат фиксируется отдельно в отчёте агента.
