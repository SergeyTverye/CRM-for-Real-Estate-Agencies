# LIVE-поиск v3.2.3: география и типы

Дата: 9 ноября 2026. Ветка feature/search-v3.2.3-geo. AI: 0 вызовов.

Проверка — ограниченная выборка по 5 карточек/страницу; числа не являются общим количеством объявлений рынка. Сетевые блокировки, неподдержанные фильтры и пустая выдача разделены. Полного декартова произведения локация × тип × операция × площадка нет: оно превышает бюджет.

Основная матрица: 79 ячеек, 95 HTTP-запросов. Повторная: 5 ячеек, 7 HTTP-запросов. Три публичных географических GET — в v323-geo-discovery.json. Первый sandbox-прогон прерван из-за ENOTFOUND и не подтверждает доступность площадок. Дополнительный HTTPS GET OnRealt вернул 200. Интервал измеряемых запросов >=1,1 с; maxPages=1, limit=5, обогащение карточек выключено.

## LIVE-матрица

| Площадка | Локация | Тип | Операция | Статус | Карточек | Локация: да/нет/? |
|---|---|---|---|---|---:|---|
| mirkvartir | novosibirsk | office | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | office | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | office | rent | success | 4 | 4/0/0 |
| cian | novosibirsk | office | rent | needs_user_action | 0 | 0/0/0 |
| yandex | novosibirsk | office | rent | needs_user_action | 0 | 0/0/0 |
| avito | novosibirsk | office | rent | blocked | 0 | 0/0/0 |
| domclick | novosibirsk | office | rent | blocked | 0 | 0/0/0 |
| mirkvartir | novosibirsk | office | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | office | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | office | rent | success | 4 | 4/0/0 |
| mirkvartir | akademgorodok | office | rent | success | 5 | 0/0/5 |
| onrealt | akademgorodok | office | rent | success | 5 | 0/5/0 |
| youla | akademgorodok | office | rent | success | 4 | 0/0/4 |
| mirkvartir | berdsk | office | rent | success | 5 | 5/0/0 |
| onrealt | berdsk | office | rent | success | 5 | 5/0/0 |
| youla | berdsk | office | rent | success | 0 | 0/0/0 |
| mirkvartir | ob | office | rent | success | 5 | 5/0/0 |
| onrealt | ob | office | rent | success | 1 | 1/0/0 |
| youla | ob | office | rent | success | 0 | 0/0/0 |
| mirkvartir | koltsovo | office | rent | error | 0 | 0/0/0 |
| onrealt | koltsovo | office | rent | error | 0 | 0/0/0 |
| youla | koltsovo | office | rent | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | krasnoobsk | office | rent | error | 0 | 0/0/0 |
| onrealt | krasnoobsk | office | rent | success | 0 | 0/0/0 |
| youla | krasnoobsk | office | rent | success | 0 | 0/0/0 |
| mirkvartir | iskitim | office | rent | success | 5 | 5/0/0 |
| onrealt | iskitim | office | rent | success | 0 | 0/0/0 |
| youla | iskitim | office | rent | success | 0 | 0/0/0 |
| mirkvartir | novosibirsk-region | office | rent | success | 5 | 4/1/0 |
| onrealt | novosibirsk-region | office | rent | success | 5 | 0/5/0 |
| youla | novosibirsk-region | office | rent | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | novosibirsk | office | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | office | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | office | rent | success | 0 | 0/0/0 |
| mirkvartir | novosibirsk | warehouse | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | warehouse | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | warehouse | rent | success | 0 | 0/0/0 |
| mirkvartir | novosibirsk | retail | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | retail | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | retail | rent | success | 1 | 1/0/0 |
| mirkvartir | novosibirsk | psn | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | psn | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | psn | rent | success | 1 | 1/0/0 |
| mirkvartir | novosibirsk | apartments | rent | unsupported_filter | 0 | 0/0/0 |
| onrealt | novosibirsk | apartments | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | apartments | rent | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | novosibirsk | flat | rent | unsupported_filter | 0 | 0/0/0 |
| onrealt | novosibirsk | flat | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | flat | rent | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | novosibirsk | house | rent | unsupported_filter | 0 | 0/0/0 |
| onrealt | novosibirsk | house | rent | success | 3 | 3/0/0 |
| youla | novosibirsk | house | rent | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | novosibirsk | non_residential | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | non_residential | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | non_residential | rent | success | 2 | 2/0/0 |
| mirkvartir | novosibirsk | office | sale | success | 5 | 5/0/0 |
| onrealt | novosibirsk | office | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | office | sale | success | 0 | 0/0/0 |
| mirkvartir | novosibirsk | warehouse | sale | success | 3 | 3/0/0 |
| onrealt | novosibirsk | warehouse | sale | success | 3 | 2/0/1 |
| youla | novosibirsk | warehouse | sale | success | 0 | 0/0/0 |
| mirkvartir | novosibirsk | retail | sale | success | 5 | 5/0/0 |
| onrealt | novosibirsk | retail | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | retail | sale | success | 0 | 0/0/0 |
| mirkvartir | novosibirsk | psn | sale | success | 5 | 5/0/0 |
| onrealt | novosibirsk | psn | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | psn | sale | success | 1 | 1/0/0 |
| mirkvartir | novosibirsk | apartments | sale | unsupported_filter | 0 | 0/0/0 |
| onrealt | novosibirsk | apartments | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | apartments | sale | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | novosibirsk | flat | sale | unsupported_filter | 0 | 0/0/0 |
| onrealt | novosibirsk | flat | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | flat | sale | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | novosibirsk | house | sale | unsupported_filter | 0 | 0/0/0 |
| onrealt | novosibirsk | house | sale | partial | 3 | 3/0/0 |
| youla | novosibirsk | house | sale | unsupported_filter | 0 | 0/0/0 |
| mirkvartir | novosibirsk | non_residential | sale | success | 5 | 5/0/0 |
| onrealt | novosibirsk | non_residential | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | non_residential | sale | success | 1 | 1/0/0 |

## Повтор после исправлений

| Площадка | Локация | Тип | Статус | Карточек | Локация: да/нет/? |
|---|---|---|---|---:|---|
| mirkvartir | akademgorodok | office | success | 5 | 0/0/5 |
| onrealt | akademgorodok | office | error | 0 | 0/0/0 |
| mirkvartir | koltsovo | office | success | 5 | 5/0/0 |
| mirkvartir | krasnoobsk | office | success | 5 | 5/0/0 |
| mirkvartir | berdsk | flat | success | 5 | 5/0/0 |

## Исправления и ограничения

- Стабильные locations в существующем JSON фильтров; несколько локаций объединяются по ИЛИ, пригороды раскрываются в пять городов/посёлков. Сохранение условий не требует миграций.
- Для каждого запроса передаются собственные slug/URL площадки. Адрес населённого пункта имеет приоритет перед широким полем city; улица Обь не означает город Обь. Чужая локация исключается, неизвестная требует проверки.
- Мир Квартир: исправлены публичные пути Кольцово и Краснообска; по 5/5 проверенных адресов соответствуют локации. Квартиры в Бердске после исправления — 5/5. Фильтр площади жилых объектов проверяется локально, поскольку нативная передача не поддержана.
- Академгородок означает Советский район; район передаётся в Мир Квартир и OnRealt. В LIVE Мир Квартир не дал район в адресе (5 unknown), OnRealt вернул DISTRICT_LOOKUP_FAILED. Соответствие без фактов не утверждается; UI советует расширить поиск или сменить площадку.
- Циан/Яндекс: needs_user_action. Авито: HTTP 439. Домклик: HTTP 401. Обход защиты не выполнялся. Для новых локаций без проверенного ID Циан/Авито/Домклик — unsupported_filter.
- Юла: существующий разбор не изменён; для ряда посёлков получено 0 карточек, область LOCATION_NOT_FOUND; жилая категория в этой ветке неподдержана. Это не доказательство отсутствия предложений на площадке.
- Апартаменты отделены от жилой квартиры, обозначены как обычно нежилые с обязательной проверкой документов. Любое нежилое включает коммерческие категории и поиск апартаментов в квартирной категории; фактические поля остаются основанием оценки. Отдельный тип отсутствует у ряда площадок, полнота не гарантируется.
- Цена/площадь/этаж/фото/свежесть проверяются детерминированно. Отсутствие даты или единицы цены означает needs_review, а не выдуманное соответствие. Большое число исключённых в filtered-ячейках ожидаемо при совместных ограничениях; JSON содержит verdicts и полноту полей.

## Проверки

- Unit поиска: 650 PASS (29 файлов), затем актуальные geography/source-filters/residential/UX: 265 PASS (4 файла).
- PostgreSQL crm_test_c + SQLite + authorization: 70 PASS (6 файлов). Новый round-trip locations/propertyKinds: повтор 52 PASS (2 файла).
- Финальные адресные/adapter/URL/residential/UX регрессии: 304 PASS (5 файлов). Отдельная policy-проверка запрета AI-подтверждения неизвестной локации: 12 PASS. Это повторные пересекающиеся прогоны, их числа не суммируются.
- npx tsc --noEmit: PASS, exit 0 (geo-typecheck-release.log). ESLint изменённых файлов --max-warnings=0: PASS, exit 0.
- Production build: PASS, npm run build -- --webpack, NEXT_DIST_DIR=.next-v323-geo. Turbopack в worktree отказался разрешать junction node_modules; штатный webpack прошёл. CRM_DOCKER_BUILD=1 отключил только дублирующий TypeScript внутри build; самостоятельный полный tsc прошёл. Host runner: Node 22.23.4, baseline приложения Node 24 этим прогоном не подтверждается.
- Next start 127.0.0.1:3381 + отдельный поисковый worker: PASS. Manager login: HTTP 200; секреты брались из .env только в окружение процесса.
- Playwright Chromium 1366×768: три сценария поиска и три проверки сохранения условий PASS; 6 PNG в docs/screenshots/vkr/v323-search/. Без AI; browser egress ограничен loopback. Живые поиски получили по 5 карточек Мир Квартир. Значимые ограничения приведены ниже.

## Browser QA (LIVE и последующий REPLAY)

| Сценарий | Условия | Запуск | Получено / принято | Сохранение |
|---|---|---|---|---|
| Офис 50–100 м², Академгородок | Советский район, аренда, офис, 1 страница/5 карточек | completed | 5 / 0 | locations=[akademgorodok], areaFrom=50, areaTo=100 подтверждены |
| Склад у Оби | город Обь, аренда, склад, 1 страница/5 карточек | partial (TIMEOUT 20 с) | 5 / 0 | locations=[ob] подтверждён |
| Квартира в Бердске | продажа, flat, 1 страница/5 карточек | completed | 5 / 5 | locations=[berdsk], propertyKinds=[flat] подтверждены |

«Принято» не равно «все условия подтверждены»: в сохранённой бердской выдаче 1 совпадение и 4 требуют проверки. Академгородок и склад у Оби не объявляются успешным подбором: получены реальные карточки, показаны ограничения/исключения. Все три формы позволили установить условия, запустить поиск, увидеть статус и сохранить условия; сохранённые профили QA удалены через API.

Подробные статусы/ID запусков: v323-geo-ui.json. Шесть снимков: *office-akademgorodok*, *warehouse-ob*, *flat-berdsk* (форма и результаты). Кадры результатов пересняты чтением уже сохранённых LIVE-запусков, без worker и внешних запросов; на них UI честно показывает REPLAY. Это не дополнительная LIVE-проверка.

Первые два прохода harness исправляли timing запуска страницы и неверный Playwright exact-label selector операции; они не подтверждали сценарии и не выполняли поиски на площадках. Третий проход прошёл три сценария; только его результаты находятся в итоговом JSON. Процессы next/worker/browser завершены в finally. Recapture-сервер также остановлен.

Измеряемая adapter-матрица и retest: 102 upstream HTTP. Публичная географическая диагностика: 3 GET, отдельная проверка DNS вне sandbox: 1 GET. Сетевые попытки первого sandbox-прогона завершались ENOTFOUND до HTTP и не входят в LIVE-выдачу. UI дополнительно выполнил три ограниченных поиска (1 страница/5 карточек на одном источнике, deadline 20 с; 3 detail GET зафиксированы у квартир). Общий точный wire-счётчик UI не снимался; не выдаём оценку за измеренное число. Не было новых запросов при recapture. Ни контакты, ни тела страниц в JSON/отчёт не сохранены.

## Результат

Функциональность географии/типов/сохранения/русского UI реализована и проверена. Полная доступность каждого типа и каждой локации на каждой площадке — PARTIAL: защита/неподдержанная категория/геосправочник/неполные адресные данные перечислены выше. Миграций и изменений бизнес-правил CRM нет. Разбор Юлы и browser-continuation/CAPTCHA не изменялись.


## После исправлений (geo2)

Проверка: 9 ноября 2026 (локальное время). Ветка `feature/search-v3.2.3-geo2`. LIVE, AI=0; browser-continuation/CAPTCHA не изменялись.

Исправленные причины:

- Кольцово OnRealt: публичный slug `rabochij-poselok-koltcovo` подтверждён HTTP 200, квартиры и офисы доступны. Пути Мир Квартир для Кольцово и Краснообска из предыдущей правки перепроверены: ошибок URL нет.
- OnRealt: публичный autocomplete возвращает Советский район как группу **3**, ID **112**, при `type_region=1` и выбранном городе `14898`. Пакет запрашивал `type_region=2`, не выбирал город и искал группу 4: ответ содержал только ЖК. Передаётся проверенный native `location={"3":["112"]}`.
- В областных карточках OnRealt поле `address-city` содержит область, город и район. Пакет сохранял только первый компонент («Новосибирская область») и терял населённый пункт. Теперь сохраняются полный адрес, город и район из самой карточки; элементы навигации исключаются.
- Мир Квартир: Советский район передаётся SEO-путём `/Новосибирск/Советский/`, включая жилые категории. Факт района из запроса не присваивается объявлению. Юла получает текстовый запрос «Академгородок»; он сужает выборку, но не доказывает адрес. При недостатке фактов UI показывает «Локация требует проверки», явное несовпадение остаётся `rejected`. Координатное подтверждение без исходных координат/границ района не заявляется.
- Жилая аренда Мир Квартир использует реальные хосты `arenda`/`arendadoma`, как продажа — `www`/`dom`; операция читается из URL самого объявления. Перепроверены квартиры/дома обеих операций, `unsupported_filter` не воспроизводится. Юла после интеграции поддерживает квартиры/дома; для выбранного типа «дом» нет дублирующего запроса коттеджей по тому же URL.
- Юла: URL области перенаправляется на `/cities`; отдельная область не поддержана публичным маршрутом. Реализован **частичный** поиск по Новосибирску, Бердску, Оби, Кольцово, Краснообску и Искитиму с `partial/incomplete` и явным предупреждением. Это не полный охват области. Кольцово в справочнике Юлы недоступно: `unsupported_filter` с текстом «Локация не поддерживается площадкой» и подсказкой расширить поиск, а не generic error.
- Обь, склад: необязательный detail GET для даты мог исчерпать срок задания после получения SERP. DateEnrichment теперь оставляет резерв на публикацию и ограничивает один detail GET 3 секундами. LIVE с включёнными details: Мир Квартир 5 карточек, 5/5 по городу, success за 14,2 с при deadline 20 с; одна неудача уточнения даты не стирает SERP. Это подтверждает устранение воспроизводимого риска; прежний TIMEOUT не доказывает отсутствие складов.
- Аналогичный риск обнаружен на деталях Юлы: запросы деталей ограничены 3 секундами, ошибка необязательного уточнения сохраняет SERP. После правки Академгородок/квартира: success, 5 карточек за 19,1 с, все 5 требуют проверки локации.

### LIVE после правок

Основной прогон: 45 ячеек, 90 сетевых попыток, 1 страница/до 5 карточек, details выключены. Контроль с details: 3 ячейки/8 попыток, затем 1 ячейка/5 попыток после ограничения деталей Юлы. HTTP-навигация/диагностика: 13 попыток плюс прерванный начальный прогон (1 завершённый GET, консервативно зарезервированы 3 попытки). Общий верхний бюджет **119/120**, новых LIVE-запросов не выполнялось. В сетевых прогонах попытки считаются перед DNS/HTTP и включают редиректы, обрывы и отмены; 119 — верхняя оценка upstream HTTP, не число успешных ответов. Заданный интервал начала запросов 1,1 с, retries выключены. Ещё пять первоначальных sandbox-попыток завершились ENOTFOUND до HTTP: в upstream-бюджет не включены и доступность не подтверждают.

Таблица: по 5 карточек — ограниченная выборка, не полнота рынка. «да/нет/?» относится к локации, а не ко всем условиям подбора; полный verdict и причины есть в JSON.

| Площадка | Локация | Тип | Операция | Статус | Карточек | да/нет/? |
|---|---|---|---|---|---:|---|
| mirkvartir | novosibirsk | office | rent | success | 5 | 5/0/0 |
| mirkvartir | akademgorodok | office | rent | success | 5 | 0/0/5 |
| mirkvartir | koltsovo | office | rent | success | 5 | 5/0/0 |
| mirkvartir | krasnoobsk | office | rent | success | 5 | 5/0/0 |
| mirkvartir | novosibirsk-region | office | rent | success | 5 | 4/0/1 |
| mirkvartir | novosibirsk | warehouse | rent | success | 5 | 5/0/0 |
| mirkvartir | novosibirsk | flat | rent | success | 5 | 5/0/0 |
| mirkvartir | novosibirsk | house | rent | success | 5 | 5/0/0 |
| mirkvartir | novosibirsk | flat | sale | success | 5 | 5/0/0 |
| mirkvartir | novosibirsk | house | sale | success | 4 | 4/0/0 |
| mirkvartir | berdsk | flat | sale | success | 5 | 5/0/0 |
| mirkvartir | akademgorodok | flat | sale | success | 5 | 0/0/5 |
| mirkvartir | koltsovo | flat | sale | success | 5 | 5/0/0 |
| mirkvartir | ob | warehouse | rent | success | 5 | 5/0/0 |
| mirkvartir | novosibirsk-region | house | sale | success | 5 | 3/0/2 |
| onrealt | novosibirsk | office | rent | success | 5 | 5/0/0 |
| onrealt | akademgorodok | office | rent | success | 5 | 5/0/0 |
| onrealt | koltsovo | office | rent | success | 5 | 3/0/2 |
| onrealt | krasnoobsk | office | rent | success | 0 | 0/0/0 |
| onrealt | novosibirsk-region | office | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | warehouse | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | flat | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | house | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk | flat | sale | success | 5 | 5/0/0 |
| onrealt | novosibirsk | house | sale | partial | 3 | 3/0/0 |
| onrealt | berdsk | flat | sale | error | 0 | 0/0/0 |
| onrealt | akademgorodok | flat | sale | success | 5 | 5/0/0 |
| onrealt | koltsovo | flat | sale | success | 5 | 5/0/0 |
| onrealt | ob | warehouse | rent | success | 5 | 5/0/0 |
| onrealt | novosibirsk-region | house | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | office | rent | success | 4 | 4/0/0 |
| youla | akademgorodok | office | rent | success | 4 | 0/0/4 |
| youla | koltsovo | office | rent | unsupported_filter | 0 | 0/0/0 |
| youla | krasnoobsk | office | rent | success | 0 | 0/0/0 |
| youla | novosibirsk-region | office | rent | partial | 1 | 1/0/0 |
| youla | novosibirsk | warehouse | rent | success | 0 | 0/0/0 |
| youla | novosibirsk | flat | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | house | rent | success | 5 | 5/0/0 |
| youla | novosibirsk | flat | sale | success | 5 | 5/0/0 |
| youla | novosibirsk | house | sale | success | 5 | 5/0/0 |
| youla | berdsk | flat | sale | success | 5 | 5/0/0 |
| youla | akademgorodok | flat | sale | success | 5 | 0/0/5 |
| youla | koltsovo | flat | sale | unsupported_filter | 0 | 0/0/0 |
| youla | ob | warehouse | rent | success | 0 | 0/0/0 |
| youla | novosibirsk-region | house | sale | partial | 3 | 3/0/0 |

Последний контроль Юлы заменяет первоначальный широкий поиск Академгородка: офис — 0 карточек; квартира — 5, локация 0/0/5. Не выдаём текст запроса за районное доказательство. Мир Квартир Академгородок — 0/0/5 и для офиса, и для квартиры; подтверждение района остаётся ограничением площадки. OnRealt — 5/0/0 в обоих случаях.

Артефакты: `live-search-v323-geo2.json`, `live-search-v323-geo2-final.json`, `live-search-v323-geo2-detail-final.json`; публичная диагностика — `geo2-discovery.json`, `geo2-discovery-extra.json`, `geo2-district.json`. Основной `live-search-v323-geo.json` дополнен ключом `afterFixesGeo2`, прежняя матрица сохранена. Контакты и тела страниц не сохранены. Сервер/worker/браузер в этом прогоне не запускались; повторный browser QA не заявляется.

### Проверки geo2 (REPLAY)

- Unit property-search: **692/692 PASS**, 31 файл (`geo2-unit-final.log`). После добавления дополнительной регрессии timeout Юлы: **42/42 PASS**, два изменённых файла (`geo2-unit-detail-final.log`); числа пересекаются и не суммируются.
- PostgreSQL `crm_test_e` + SQLite: **103/104 PASS** в совместном прогоне, один PG export-тест превысил стандартные 30 с (`geo2-integration-final.log`). Он отдельно прошёл с лимитом 90 с (`geo2-pg-export-recheck.log`, 1 PASS/24 skipped). Этот повтор не объявляется полным зелёным прогоном со штатными timeout; ограничение производительности экспорта остаётся вне geo2.
- `npx tsc --noEmit`: PASS после генерации PG/SQLite клиентов (`geo2-typecheck-release.log`). Первоначальный запуск без generated clients падал; код схемы и миграции не менялись.
- ESLint всех изменённых TS/TSX `--max-warnings=0`: PASS (`geo2-lint-release.log`). `git diff --check`: PASS. Production build и browser QA в этой итерации не выполнялись.
- В основной LIVE-матрице: 39 success, 3 partial, 2 unsupported_filter, 1 error. Единственный error — OnRealt/Бердск/квартира: FETCH_FAILED без HTTP-статуса, сетевой отказ; отдельный повтор не делался из-за общего бюджета. OnRealt/Новосибирск/дом sale — partial из-за одной сетевой ветви. Юла/область остаётся partial по контракту охвата.
- Проверки geo2 не используют AI, seller contacts, реальные CRM ПДн, browser-continuation или CAPTCHA. Все запущенные CLI-прогоны завершены.
