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

