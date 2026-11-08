# LIVE-матрица поиска v3.2.2 — 08.11.2026

Режим: **LIVE** для 28 зондовых заданий (4 запроса × 7 площадок), **REPLAY** — ссылки на прошлые доказательства,
**DEMO** — только помеченные стенды, **BLOCKED** — зафиксированные отказы. Машиночитаемая матрица:
[live-search-v322-matrix.json](live-search-v322-matrix.json). Скрипт: `scripts/perf/search-live-v322-probe.ts`.

Параметры: глубина maxPages=1/limit=5 на источник, дедлайн задания 25 с, без браузера, без AI (aiCalls=0),
без БД (адаптер напрямую, in-memory), транспорт с подсчётом запросов, жёсткий лимит 40 запросов на площадку
за весь прогон. Фактический расход: cian 6, mirkvartir 12, onrealt 12, domclick 3, yandex 9, youla 6, avito 3.
Пауза 2 с между запросами; 7 источников опрашивались параллельно (разные хосты). Повторов и retry не было:
один HTTP 429 без Retry-After сразу даёт rate_limited, блокировка останавливает ветви источника.

Запросы (Новосибирск): аренда офиса (rub_month), продажа торгового помещения, аренда склада (rub_month),
продажа квартиры — жилая (sale + residential, 6 ветвей типов). Аренда без `priceUnit` отклоняется схемой
SearchFilters («Укажите единицу цены аренды») — первый прогон это подтвердил локально, без единого запроса.

## Итоги по запросам

| Запрос | mirkvartir | onrealt | yandex | youla | cian | domclick | avito |
|---|---|---|---|---|---|---|---|
| Аренда офиса | success 5 (0/0/5) | success 5 (0/0/5) | needs_user_action | success 4 (0/0/4) | parse_failed | blocked 401 | blocked 439 |
| Продажа торгового | success 5 (5/0/0) | success 5 (0/0/5) | needs_user_action | success 2 (0/0/2) | parse_failed | blocked 401 | blocked 439 |
| Аренда склада | success 5 (0/0/5) | success 5 (0/0/5) | needs_user_action | success 0 (пусто) | parse_failed | blocked 401 | blocked 439 |
| Продажа квартиры | partial 3 (TIMEOUT) | partial 1 (TIMEOUT) | needs_user_action | unsupported_filter | parse_failed | unsupported_filter | unsupported_filter |

В скобках confirmed/needs_review/rejected. Все комбинации partial=true: полного охвата рынка нет нигде,
сортировка площадки по дате не гарантирована.

Комбинации (агрегация однопоточных запусков, выполнены в пределах минут; межисточниковых точных дублей
и подозреваемых пар в этих малых выборках нет — 0/0 везде):

| Запрос | пара onrealt+yandex | трио +mirkvartir | все 7 |
|---|---|---|---|
| Аренда офиса | 5 (partial, yandex ручная проверка) | 10 (partial) | 14 (partial; blocked: domclick, yandex, avito) |
| Продажа торгового | 5 (partial) | 10 (partial) | 12 (partial; blocked: domclick, yandex, avito) |
| Аренда склада | 5 (partial) | 10 (partial) | 10 (partial; blocked: domclick, yandex, avito) |
| Продажа квартиры | 1 (partial) | 4 (partial) | 4 (partial; yandex ручная проверка, остальные unsupported) |

## Полнота полей полученных объявлений

| Запрос · источник (n) | цена | ед. цены | площадь | этаж | фото | район | дата публикации |
|---|---|---|---|---|---|---|---|
| Офис аренда · mirkvartir (5) | 5 | 0 | 5 | 5 | 1 | 0 | 0 |
| Офис аренда · onrealt (5) | 5 | 0 | 5 | 5 | 5 | 5 | 0 |
| Офис аренда · youla (4) | 4 | 0 | 4 | 0 | 4 | 0 | 0 |
| Торговля продажа · mirkvartir (5) | 5 | 5 | 5 | 5 | 1 | 0 | 0 |
| Торговля продажа · onrealt (5) | 5 | 5 | 5 | 5 | 5 | 5 | 0 |
| Торговля продажа · youla (2) | 2 | 0 | 2 | 0 | 2 | 0 | 0 |
| Склад аренда · mirkvartir (5) | 5 | 0 | 5 | 5 | 1 | 0 | 0 |
| Склад аренда · onrealt (5) | 5 | 0 | 5 | 5 | 5 | 5 | 3 |
| Склад аренда · youla (0) | — | — | — | — | — | — | — |
| Квартира продажа · mirkvartir (3) | 3 | 0 | 3 | 3 | 3 | 0 | 0 |
| Квартира продажа · onrealt (1) | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

Выводы: цена/площадь есть почти везде; единица цены аренды неизвестна (период ставки не указан) —
такие карточки честно уходят в «требуют проверки», период не выдумывается. Даты публикации известны
единично (склад onrealt 3/5, квартира onrealt 1/1); unknown никогда не подменяется fetchedAt.
Этаж/район у youla отсутствуют; фото есть везде, кроме части mirkvartir. Дубли: точных межисточниковых
совпадений нет; подозреваемых пар в этих выборках нет (алгоритм подозрений покрыт unit-тестами
на парах D01–D03 корпуса 49).

## Статусы площадок и причины

- **mirkvartir — LIVE success/partial.** Реальные объявления получены во всех 4 запросах. Жилая: partial
  с TIMEOUT (6 ветвей типов упираются в дедлайн 25 с) — старые FETCH_FAILED (см. REPLAY ниже) не
  повторились, но охват жилой выборки неполный.
- **onrealt — LIVE success/partial.** Реальные объявления во всех 4 запросах. Торговля идёт через
  категорию ПСН (назначение проверяется CRM, охват неполный — честное предупреждение в причине).
  Жилая: partial с TIMEOUT. Даты карточек: detail-запросы 0–1 по лимиту N=3.
- **yandex — BLOCKED (needs_user_action, HTTP 200).** Площадка отдаёт страницу проверки; карточек нет.
  Ручное прохождение — только через браузерную сессию CRM (см. integrations/captcha-hitl.md).
  Автоматический обход не реализован и не планируется.
- **youla — LIVE success (включая корректный ноль).** Офис 4, торговля 2, склад 0 (пустая выдача —
  корректный пустой ответ, а не ошибка), жилая — unsupported_filter (контракт парсера жилой категории
  не верифицирован; срабатывает локально, без сетевых запросов).
- **cian — BLOCKED (parse_failed).** HTTP-ответы приходят, разбор не удался (SSR-контракт изменился
  или challenge-формат). Официальные пути — в integrations/property-search-sources-v322.md.
- **domclick — BLOCKED (HTTP 401 ACCESS_BLOCKED).** Жилая — unsupported_filter (локально).
- **avito — BLOCKED (HTTP 439 ACCESS_BLOCKED).** Жилая — unsupported_filter (локально).

## Разделение режимов

- **LIVE (этот прогон, 08.11.2026, ~61 с, UTC 16:03–16:04):** 28 заданий выше, `mode:"LIVE"`, `aiCalls:0`.
  Сырые тела, тексты, контакты и URL в матрице не сохраняются — только counts/коды/времена.
- **REPLAY:** корпус 49 (`tests/fixtures/search-quality/live-2026-11-05.json`, отчёт
  [search-quality.md](search-quality.md)); prior smoke-фикстуры `tests/fixtures/scraper/v31/*/live.json`
  (05.11: onrealt/yandex PASS, youla PASS-пусто, cian PARSE_FAILED, avito/domclick BLOCKED,
  mirkvartir FETCH_FAILED); полные запуски [live-search-v31.md](live-search-v31.md) (второй запуск:
  onrealt 31/25, yandex 20/20).
- **DEMO:** CAPTCHA-стенд `tests/fixtures/captcha-stand/` и [live-search-v31-captcha.json](live-search-v31-captcha.json)
  — синтетический стенд, не внешние площадки.
- **BLOCKED:** cian/avito/domclick/yandex в этом прогоне; ручные пути (добавление по ссылке,
  импорт официальной выгрузки CSV/XLSX/XML) покрыты REPLAY-тестами (`v31-manual-feed.test.ts`).

## Найденные дефекты и исправления (этот инкремент)

1. Страницы выдачи (контроли L45–L47 корпуса) оценивались как needs_review вместо rejected.
   Исправление: `isCataloguePage` в `domain/evaluation.ts` — нет ID площадки, цены, площади, заголовка
   и города → критерий `listing:contradicted` → rejected. Проверено только на 3 контролях из 49;
   неполные реальные карточки остаются needs_review (unit-тест).
2. Подозреваемые дубли пропускались при разных написаниях адреса (D01–D03): префикс города,
   сокращения ул./просп., отсутствие номера дома у одной стороны. Исправление:
   `normalizeAddressKey` + уличный fallback в `infrastructure/normalization.ts`. Без автослияния —
   только флаг «требует проверки». Unit-тесты на D01–D03-стиле данных; distinct-пары (Сухарная/Большая)
   и один источник не флагуются.
3. Жилая выборка avito/youla/domclick честно даёт unsupported_filter до сети (контракт не верифицирован,
   `residential-parsers.ts`); UI-причина «площадка не предлагает типы …; остальные варианты сохранены».
   Дефектом не является, задокументировано как ограничение.

AI-режимы (с ключом) здесь не запускались. Кодом/тестами проверены: отсутствие ключа/выключение
(`AI_DISABLED`, `search-ai.test.ts`, `gate.test.ts`), исчерпанный бюджет (`AI_BUDGET_EXHAUSTED`,
`gate.test.ts`), отмена (`cancelled` без выдуманных результатов, `v322-extraction.test.ts`),
частичная выдача (partial при живых карточках + ошибке, `adapter.test.ts`), повтор после ошибки
(без дубля запроса, `search-ai.test.ts`), один источник ok + другой BLOCKED/CAPTCHA
(`v322-extraction.test.ts`: success + needs_user_action → bridge blocked), сортировки/свежесть
(`server-v31.test.ts`), экспорт всех/выбранных (UI + API контракт `export`, покрыт e2e/integration
экспорта v31). Полный финансовый прогон с ключом — за координатором.
