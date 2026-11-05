# Интеграция поиска объектов: real-estate-scrapper 2.1.0

Дата проверки: 05.11.2026. Источники контракта: установленный `node_modules/real-estate-scrapper/{README.md,API.md,index.d.ts,index.js,lib/browserTransport.js,parsers/baseParser.js}`. Зависимость проекта — `file:vendor/real-estate-scrapper-2.1.0.tgz`. Локальный путь разработчика не используется. Это реализация домена/инфраструктуры; API, БД, UI, платные AI-вызовы и фактическая доступность сайтов здесь не принимаются.

## Фактический контракт

- CommonJS `export = RealEstateScraper`, работает с default import при `esModuleInterop`. Node >=20.19, целевой проект Node 24. Импорт не делает запросов.
- `RealEstateScraper.create({ browser: true })` существует. `true` ищет Chromium Playwright, **не** установленный Chrome; для Chrome нужно `{ browser: { channel: 'chrome' } }` или `executablePath`. `close()` обязателен, повторный вызов безопасен.
- `playwright-core` у пакета только devDependency, собственный браузер не скачивает. В текущем проекте он доступен транзитивно через `@playwright/test`; production-образ должен явно сохранять этот runtime-пакет. Никакие зависимости в этой задаче не устанавливались.
- `searchSite(source, query)` → `{source,query,timestamp,total,results,errors,pages,partial}`. `Listing` содержит `id,source,title,price,priceText,address,area,floor,url,images,description,city,district,propertyType,deal,sellerType,floorType,timestamp` и nullable/optional поля. Цена и площадь пакета — number; доменная цена преобразуется в decimal string, точность уже утраченных источником данных восстановить нельзя.
- `report()` → `{query,timestamp,total,results,unresolved,sources,summary}`. Его native `sourceFilter` может давать matched без независимого доказательства. Поэтому CRM использует исходные кандидаты `searchSite()` и собственный `evaluateListing()`; неизвестные данные не подтверждаются фильтром площадки.
- Назначения `types` и районы `districts` — ИЛИ, остальные группы — И. Пакет: `retail,freePurpose,office,industrial,warehouse,building,commercial`; CRM: `psn_universal` и `free_purpose` соответствуют `freePurpose`. У `commercial` нет смешивания с конкретными назначениями.
- Пакет поддерживает sale/rent, priceMin/Max, areaMin/Max, floorMode any/first/notBasement, owner all/owner, sourceOptions. Коммерческая посуточная аренда запрещена. Единого достоверного периода аренды в JSON нет: читаем явный `priceText`, иначе unknown. Конвертация периодов и цены за м² не выполняется.
- CRM не передаёт ограничения собственника, цены, этажа и районов пакету: локальные фильтры пакета неодинаковы и могут отбросить неизвестных кандидатов. Площадь/назначение/операция передаются; полный набор проверяется повторно на сервере. Покрытие ограничено двумя страницами на ветвь и 100 кандидатами на источник, это не полный рынок.
- Циан уже делит группы на строки с `parentId`, `floorRange`, URL `#part-N`. CRM сохраняет родительский ID объявления и отдельный ID помещения. Диапазон этажей остаётся unknown. Нельзя синтезировать несколько помещений из свободного текста без самостоятельных данных.
- Точная идентичность: `(source,sourceListingId,sourceUnitId)`. Отсутствующие ID → `identityNeedsReview`, без автоматического объединения. Межплощадочное совпадение города+точного адреса+площади — только `possibleDuplicateKeys`, записи не объединяются.

## Семь площадок и ограничения

| source | Транспорт и особенности |
|---|---|
| cian | HTTP/браузер, групповые коммерческие карточки раскрываются пакетом |
| mirkvartir | HTTP, отдельные ветви назначений; industrial/building отсутствуют |
| onrealt | HTTP; 404 только с точным маркером «Объявлений не найдено.» считается пустым ответом; `-1 / 6` — подвал |
| domclick | HTTP JSON, offset; возможны неверные знаки этажа; прямое указание подвала в описании учитывается |
| yandex | HTTP; CAPTCHA означает blocked |
| youla | HTTP GraphQL, курсорная последовательная пагинация, этаж/район могут отсутствовать |
| avito | HTML → API из браузерного контекста; 429/hCaptcha означает blocked; частное лицо не равно собственнику |

Автоматическая география domclick/avito/mirkvartir в пакете проверена для Москвы. Для Новосибирска и других городов нужны серверные `sourceOptions.domclick.address`, `avito.locationId`, `mirkvartir.locationIds` или проверенный URL. Пока они не настроены — `unsupported_filter`, без подмены города Москвой. ID площадок невзаимозаменяемы. Справочник CRM содержит 10 районов Новосибирска и основные районы Москвы; неизвестные/новые районы требуют проверки. Улица/метро/упоминание в описании не являются районом; адрес должен явно называть район.

Ошибки пакета: `ACCESS_BLOCKED`, `FETCH_FAILED`, `SEARCH_FAILED`, `PARSE_FAILED`, `INVALID_RESPONSE`, `API_RESPONSE_FAILED`, `UNSUPPORTED_FILTER`, `DISTRICT_RESOLUTION_REQUIRED`, `DISTRICT_NOT_FOUND`, `DISTRICT_LOOKUP_FAILED`, `LOCATION_REQUIRED`, `LOCATION_NOT_FOUND`, `CURSOR_REQUIRED`, `PAGINATION_FAILED`, `LISTING_UNAVAILABLE`, `INVALID_URL`, `NOT_APPLICABLE`, `ABORTED`. Неверный запрос → TypeError. Ошибки могут быть в `errors` при непустой выдаче.

CRM возвращает по каждому источнику `success/partial/blocked/timeout/unsupported_filter/error/disabled`, `resultCount`, `reason`. Счётчик — нормализованные кандидаты до общей дедупликации/вердикта; отклонённые кандидаты сохраняются в результате со своим вердиктом. Исправный пустой ответ — success. Пагинационное ограничение отражается в reason. Ошибки содержат только технические коды/HTTP, без полного ответа, контактов и секретов.

## Публичные интерфейсы для следующих агентов

- `domain/types.ts`: runtime Zod `SearchFilters` (`searchFiltersSchema` alias), DTO `NormalizedListing`, `ListingEvaluation`, `SourceRun`, `SearchResult`, `DescriptionAnalyzer`. Цены фильтра — decimal strings; единицы: `rub_total/rub_month/rub_year/rub_m2_month/rub_m2_year`.
- `domain/evaluation.ts`: `evaluateListing`, `evaluateFeature`, `analyzeUnresolved`. Structured → rules → очередь `aiPending`. AI не вызывается автоматически; исходный текст считается недоверенным. Контакты удаляются перед analyzer, ответы принимаются только с буквальной цитатой из переданного текста. Результат AI не подтверждает район или собственника. Human confirmation для дальнейших бизнес-действий — обязанность application/UI.
- `OwnerVerification` — отдельные `source/method/checkedAt/verifiedBy`, заполняются доверенным сервисом проверки сотрудника, не из внешнего объявления и не из произвольного API-ввода. Seller badge хранится отдельно. Сам импорт owner badge не подтверждает собственность.
- `infrastructure/scraper-adapter.ts`: `ScraperAdapter.search(unknown)`, `RealEstateScraperAdapter`, внедряемая `ScraperFactory`, `ScraperJobLimiter`. ENV: `SCRAPER_ENABLED` (по умолчанию false), `SCRAPER_BROWSER_ENABLED` (по умолчанию true), `SCRAPER_JOB_TIMEOUT_MS` (180000), `SCRAPER_MAX_CONCURRENT_JOBS` (1). Внедряемые опции предназначены для доверенной серверной конфигурации, не из запроса браузера. Общий process-local limiter ограничивает активные задания источников, включая параллельные поиски; тайм-аут действует на активный источник (ожидание очереди отдельно). В многопроцессном deployment координатор должен ограничить число worker-процессов.
- `domain/fallback.ts`: `decideFallback` — чистое решение. Автоматический переход только при полном техническом отказе + AI + webSearch + autoFallback + бюджет/лимит. Пустой исправный ответ, partial и отсутствие площадок не запускают авто. `alreadyAttempted` блокирует повторы. Атомарная резервация бюджета и однократность по job ID реализуются application/AI, функция не совершает платных вызовов.
- `src/shared/net/ssrf.ts`: `guardExternalUrl`, `safeRequest`, `fetchExternalImage`. Только http/https, без URL credentials, приватных/loopback/link-local/reserved IP, проверяются все DNS-ответы. Соединение закреплено за проверенным IP, redirects повторно проверяются. Ограничения времени/размера; HTML возвращается только байтами; SVG/HTML не принимаются как фото. Raster MIME требует последующего декодирования/перекодирования через sharp перед постоянным хранением. Compressed ответы не исполняются/не распаковываются: запрашивается identity, нарушение отклоняется.

## Chrome и Docker

Dockerfile не изменён (зона другого агента). Для production нужны Node 24, установленный Chrome с системными библиотеками/шрифтами и runtime `playwright-core` совпадающей версии. Например, сборка `npm ci` с сохранением нужного runtime, установка Chrome на build-stage, передача проверенного executablePath или channel chrome. Зафиксировать версии образа и Chrome, использовать непривилегированного пользователя, sandbox, достаточный `/dev/shm`, read-only корень и ограниченный egress. Не включать безусловно `--no-sandbox`.

Фактический `create({browser:true})` проверен по JS/типам; запуск Chrome/Docker в этой задаче **не выполнялся**. Нужен отдельный deployment smoke test с установленным браузером; unit fixtures не подтверждают живую доступность.

Production factory использует публичные `launchBrowserTransport` + `createBrowserTransport` вместо закрытого поля browser у `create`: пересоздаёт контекст с блокировкой service workers, блокирует WebSocket, перехватывает HTTP(S), получает данные через DNS-pinned `safeRequest` и передаёт браузеру. HTML/JS выполняются только внутри изолированного браузера при штатной работе площадки; ручная загрузка URL/изображения использует inert-byte helper. Браузер не следует использовать как универсальный URL-fetcher. Маршрутизация Playwright не заменяет сетевую изоляцию браузера на уровне контейнера; при запуске нужен запрет доступа к host/DB/private networks. Один отказ запуска браузера не отменяет HTTP-площадки. `close` вызывается в finally, позднее завершившийся launch после timeout тоже закрывается.

## Условия использования и CAPTCHA

MIT-лицензия пакета не предоставляет права на базы/фото площадок. Проверка публичных условий выполнена отдельно от offline-тестов. [Правила Циан](https://www.cian.ru/legal-documents/pravila_polzovaniya_sajtom_cian_0/) запрещают автоматизированный сбор без специального разрешения (7.2.3); техническая поддержка источника не означает разрешения его включить. Для Домклик найден официальный [документ условий](https://domclick.ru/fs/public/docs/terms-of-use.pdf), требуется проверка применимой редакции оператором установки.

Для Авито, Юлы, Яндекса, OnRealt и Мира Квартир применимая редакция условий автоматического сбора **не подтверждена** этой проверкой. До разрешённого производственного использования оператор должен зафиксировать соответствующие официальные условия/основание доступа и права на изображения; отсутствие подтверждения не считается разрешением. По умолчанию скрапер выключен. Здесь нет CAPTCHA-solving, смены IP по отказу, обхода аккаунтов или принудительного повторения 429. CAPTCHA/запрет доступа → blocked; доступные сохранённые данные не удаляются. Ручное добавление ссылки должно использовать тот же SSRF guard и серверную проверку.

## Испытания и отложенное подключение

`tests/fixtures/scraper/{cian,mirkvartir,onrealt,domclick,yandex,youla,avito}.json` — **синтетические** сохранённые ответы точного SearchResult/Listing контракта, не живой сбор и не доказательство текущей разметки сайтов. Дополнительно `blocked.html`, `onrealt-empty.html` проверяются настоящим парсером без сети. Пакет не содержит опубликованных исходных test fixtures.

Целевые тесты: `npx vitest run tests/unit/property-search`, lint только файлов зоны, `npx tsc --noEmit`. Тесты покрывают семь источников, ошибки, ноль, timeout, concurrency, этажи, И/ИЛИ, собственника, описание, AI evidence/redaction, дубли, fallback, SSRF/DNS pinning/redirect/size/MIME. Сетевые ответы замоканы; обращения к площадкам отсутствуют.

Фактический результат локального прогона: **76/76 unit PASS**, scoped ESLint PASS, `npx tsc --noEmit -p tests/unit/property-search/tsconfig.json` PASS. Общий `npx tsc --noEmit` запускался, но не прошёл на изменяющихся файлах других параллельных задач (nullable client, затем незавершённые calendar exports, затем отсутствующий `scripts/ai-smoke-dbg.ts`). Эти файлы не исправлялись агентом скрапера. Типы зоны дополнительно проверены отдельной конфигурацией, наследующей основной tsconfig.

Для БД нужны только согласованные DTO: внешний listing с composite identity, raw source snapshot отдельно от employee verification, criteria/evidence/verdict, источник запуска со статусом/числом/причиной, history fetchedAt. Конкретные модели и миграции делает агент БД. На данном этапе Prisma/UI/RBAC не менялись; application должен выполнять существующие проверки Actor/ClientNeed scope до сохранения и переноса результатов, и concurrency при изменениях сохранённых поисков/проверок.
