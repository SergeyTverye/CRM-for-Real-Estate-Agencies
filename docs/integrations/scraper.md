# Интеграция поиска объектов: real-estate-scrapper 2.1.0

Актуальные уточнения v3.1 (даты, глубина, статусы, обычный Playwright, ручной ввод/фиды и новый LIVE smoke): [scraper-sources-v31.md](scraper-sources-v31.md). Приведённые ниже ранние результаты и ограничения относятся к своим датированным срезам.

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

Пакет автоматически знает Москву для domclick/avito/mirkvartir; CRM теперь добавляет Новосибирск и явные настройки Москвы через `infrastructure/source-filters.ts` (таблица ниже). Для неизвестного города без серверных `sourceOptions.domclick.address`, `avito.locationId`, `mirkvartir.locationIds` или URL возвращается `unsupported_filter` с названием недостающего фильтра, без подмены города Москвой. ID площадок невзаимозаменяемы. Справочник CRM содержит 10 районов Новосибирска и основные районы Москвы; неизвестные/новые районы требуют проверки. Улица/метро/упоминание в описании не являются районом; адрес должен явно называть район.

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

## Уточнение подключения площадок — 05.11.2026

Проверены установленные README.md, API.md, index.d.ts, lib/query.js, lib/sourceParser.js, lib/commercialFilters.js, lib/youla.js и все семь parsers/*.js пакета 2.1.0. Маппинг CRM находится в `infrastructure/source-filters.ts`; `buildScraperQuery` также реэкспортируется прежним `scraper-adapter.ts`. Изменения не требуют БД, новых зависимостей или миграций.

| Источник | Новосибирск | Москва | Коммерческие назначения и операция |
|---|---|---|---|
| cian | regionId=4897 | regionId=1 | offer_type=offices; office_type[]=office:1, retail:2, warehouse:3, freePurpose:5, industrial:7; deal_type=sale/rent |
| avito | locationId=641780 | locationId=637640 | categoryId=42; params[110799][]=office:472642, retail:472644, warehouse:472645, freePurpose:472643, industrial:472646; params[536]=5545/5546 |
| domclick | address=8dea00e3-9aab-4d8e-887c-ef2aaa546456 | address=1d1463ae-c80f-4d19-9331-a1b68a85b553 | category=commercial; offer_type=office/retail/warehouse/free_purpose/manufacturing; deal_type=sale/rent |
| mirkvartir | locationIds=MK_Town\|106136 | locationIds=MK_Region\|77 | types=office:101, warehouse:102, retail:103, freePurpose:104; cre/arendacre; production отсутствует |
| onrealt | citySlug=novosibirsk | citySlug=moskva | kypit-ofis/sklad/torgovuyu-ploshchad/pomeshchenie-svobodnogo-naznacheniya/proizvodstvo; аренда arenda-ofisa/sklada/torgovoj-ploshchadi/pomeshcheniya-svobodnogo-naznacheniya/proizvodstva |
| yandex | citySlug=novosibirsk | citySlug=moskva | kupit/snyat/kommercheskaya-nedvizhimost/; commercialType=OFFICE/RETAIL/WAREHOUSE/FREE_PURPOSE/MANUFACTURING |
| youla | citySlug=novosibirsk | citySlug=moskva | nedvijimost/kommercheskaya-nedvijimost; kommer_realty_tip_stroeniya=office:165972, retail:165971, warehouse:165974, freePurpose:165970, industrial:165973; tip_sdelki=10807/10806 |

`psn_universal` и `free_purpose` оба становятся `freePurpose`, дубли удаляются. ИЛИ реализуется нативно либо ветвлением `searchSite`: Мир Квартир, OnRealt и Домклик разбиваются пакетом на назначения. Пустой список назначений OnRealt разворачивается CRM в пять поддержанных типов, поскольку единой коммерческой категории у парсера нет. Остальные площадки получают `commercial`. Модель CRM не предлагает building; парсер Мира Квартир также не предлагает industrial. Для запроса только production возвращается `unsupported_filter` с `NOT_APPLICABLE; назначения: industrial`; при ИЛИ с поддержанными назначениями успешные ветви сохраняются, источник — partial.

География Мира Квартир подтверждена HTML городской коммерческой страницы: `MK_Town|106136` отдельно от области `MK_Region|54`. GUID Новосибирска соответствует [официальному справочнику ФИАС](https://fias.nalog-udc.ru/Home/Index/932757). Avito ID 641780 подтверждается историческим [исходным клиентским примером](https://github.com/viktor-gorinskiy/avito/blob/main/main.py) с `luri=novosibirsk`; текущее применение ID площадкой в этом срезе не подтверждено: городской каталог вернул 403, повтор не выполнялся. Cookie и заголовки из примера не копировались. Остальные числовые категории взяты из установленного пакета, не угаданы и не перенесены между площадками. Настройки `sourceOptions` доверенного сервера имеют приоритет над CRM defaults.

Площадь передаётся пакету, остальные неопределённые условия (цена с единицей, этаж, собственник, район, признаки) проверяются существующим серверным evaluation. Отсутствие нативного фильтра не должно отбрасывать кандидатов с неизвестными данными. Неподдержанные география/тип/параметры дают конкретную техническую причину; произвольные тексты upstream ошибок в UI и лог не передаются.

### Диагностика Cian

Первый HTTP-поиск Новосибирск/office/sale воспроизвёл `PARSE_FAILED`, results=0, pages[0].page=1, hasNext=null, partial=false. URL содержит `engine_version=2`, `offer_type=offices`, `region=4897`, `office_type[0]=1`, `p=1`: категория и регион совпадают с установленным контрактом, до второй страницы выполнение не дошло. Старый smoke ошибочно переводил любой непустой errors в partial. Теперь без успешной страницы такой результат — error. При ошибке распознавания пакет не подтверждает корректный пустой рынок. Различить изменение разметки, требование JavaScript и другую нераспознанную страницу по сохранённым техническим метаданным нельзя; HTML не сохранялся. Воспроизведение browser-режима не выполнялось, повтор после ошибки запрещён лимитами этой задачи.

### Безопасный live smoke

`npx tsx scripts/perf/scraper-live-smoke.ts` — один HTTP-поиск office/sale на источник, maxPages=1, maxRetries=0, общий AbortController 60 с на источник, максимум два HTTP-вызова (Юла использует HTML для cityId и GraphQL для выдачи). `--exclude=cian,avito` исключает уже проверенные источники; `--request-budget=1` уменьшает остаток бюджета. Не перезапускать после ошибок. Редиректы сознательно не выполняются и отражаются как FETCH_FAILED/SMOKE_REDIRECT_STOPPED с исходным HTTP-кодом в httpStatuses, даже если оставался бюджет: такие результаты не доказывают отказ парсера. Сохраняются только дата, статус, счётчик, длительность, количество HTTP-вызовов, HTTP-коды и метаданные страниц. Тексты объявлений, изображения и продавцы остаются только во временной памяти парсера; запись в CRM/файлы отсутствует. Текущая измеренная доступность и ограничения приведены в `scraper-live-smoke.md`.

Новые offline-тесты проверяют настоящим планировщиком пакета оба города, все шесть назначений, sale/rent, нативные параметры, ИЛИ, отсутствие назначения, переопределение настроек и причины отказа. Они не подтверждают доступность площадок. Node host этого прогона: 22.23.4; baseline Node 24/Docker и browser transport здесь не проверены.
Проверка после правок 05.11.2026: `npx vitest run tests/unit/property-search` — **273/273 PASS, 7 файлов**; `npx tsc --noEmit` — **PASS** по всему проекту; ESLint пяти изменённых TS-файлов с `--max-warnings=0` — **PASS**; scoped `git diff --check` — **PASS**. Это актуализирует исторический результат 76/76 выше. Схема БД, миграции и файлы вне согласованной зоны не менялись.
### Исправление редиректов — 05.11.2026, 05:23 МСК

Предыдущее описание остановки любых 301 относится к исторической версии smoke. Текущий HTTP-адаптер и smoke используют `infrastructure/scraper-http.ts`: до трёх переходов, только HTTPS внутри того же регистрируемого домена из явного списка семи площадок, повторная SSRF/DNS-проверка и DNS pinning каждого hop. Для другого origin удаляются Cookie/Authorization. Тайм-аут охватывает всю цепочку. `--request-budget=1..4` считает физические HTTP-попытки, включая переходы; default=2. Повторы после ошибки отсутствуют.

Канонический адрес строится перед первым HTTP-вызовом: Яндекс одиночный commercialType → соответствующий путь (office → ofis); Мир Квартир для подтверждённого scope MK_Town|106136 и types=101 → `/Новосибирская+область/Новосибирск/Офисы/`. Остальные ограничения сохраняются; неизвестные scopes/типы не угадываются и используют исходный URL с разрешёнными редиректами. Это канонизация транспорта, выходной контракт планировщика пакета сохранён.

Дополнительный live срез подтвердил **Яндекс success/23, 301→200**, то есть прежний отказ был внесён политикой smoke. Мир Квартир подтвердил канонический Location, но целевой HTTP-запрос завершился FETCH_FAILED; успешная выдача не подтверждена, повтор не делался. Канонизация добавлена после этого среза и проверена offline, без ещё одного сетевого вызова. Подробности, даты и число HTTP-попыток — в scraper-live-smoke.md. HTTP 401/403/429 всегда классифицируются blocked с HTTP-кодом, обхода нет.

Актуальная проверка: **284/284 unit PASS**, общий tsc PASS, scoped ESLint PASS. Тесты редиректов полностью offline и не являются дополнительными запросами к площадкам.
