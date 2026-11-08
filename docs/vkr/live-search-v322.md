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

## Автоматическая матрица режимов (продолжение 08.11.2026)

Платные LIVE-вызовы AI не выполнялись. Все перечисленные ниже проверки используют синтетические
provider/adapter DTO или сохранённые REPLAY-фикстуры; работа с БД проверяется на PostgreSQL и SQLite.
Пути относительно корня проекта; имена тестов позволяют найти конкретное доказательство.

| Режим | Файл и проверяемое поведение |
|---|---|
| Нет ключа AI | `tests/integration/search-readiness-security-regressions.test.ts`: `rejects missing-key parse before creating any run or paid reservation` — два повтора, ноль run/reservation/usage; `tests/integration/search-runtime-backend.test.ts` — availability и ссылка настройки |
| AI выключен | `tests/unit/ai/search-ai.test.ts`: `does not call provider when disabled, or twice on retry`; `tests/unit/ai/gate.test.ts`: `denies disabled AI before any reservation` |
| Бюджет исчерпан | `tests/unit/ai/gate.test.ts`: `refuses an exhausted budget`; `tests/integration/property-search.test.ts`: `manual web is separate and requires permission; budget exhaustion never reaches provider`; `tests/integration/search-readiness-security-regressions.test.ts` — confirmation и budget |
| Провайдер недоступен | `tests/unit/ai/search-ai.test.ts`: `settles provider failure, blocks duplicate retry and allows an explicit new request` — AI_CALL_FAILED, консервативное списание резерва, отсутствие выдуманного ответа |
| Отмена | `tests/unit/property-search/v322-extraction.test.ts`: уже прерванный signal → cancelled; `tests/integration/property-search-server-v31.test.ts`: `one durable worker slot, user cancellation aborts and keeps completed sources`, queued cancellation и late cancellation |
| Частичная выдача | `tests/unit/property-search/adapter.test.ts`; `tests/integration/property-search.test.ts`: `partial source failure preserves successful results and does not auto web search`, `recorded fixtures cover success, partial, total failure and healthy empty` |
| Повтор после ошибки | `tests/unit/ai/search-ai.test.ts`: новый requestId после недоступности провайдера успешен, прежний requestId не вызывает провайдера снова; `tests/integration/property-search-server-v31.test.ts`: `retries after a source error with a new key and retains the failed run` — отдельный новый запуск, старый сохранён |
| Один источник OK + другой BLOCKED/CAPTCHA | `tests/unit/property-search/v322-extraction.test.ts`: `keeps the working source when another needs a human action`; `tests/integration/property-search-server-v31.test.ts`: `persists dates, depth and candidates before CAPTCHA, preserving previous runs and snapshots` — реальный кандидат fake-адаптера сохранён, статус второго источника needs_user_action |
| Сортировки / свежесть | `tests/unit/property-search/server-v31.test.ts` — цены и единицы, календарные периоды, unknown; `tests/integration/property-search-server-v31.test.ts`: `all server sort orders have stable pagination and require revision on subsequent pages`, `freshness keeps unknown publications separate and first_seen uses CRM observations` |
| Экспорт всех / выбранных | `tests/integration/property-search-server-v31.test.ts`: `exports all filtered and selected rows with BOM/formula protection and SearchExport journal`, `exports beyond the first server page and rejects foreign selected ids`, экспорт ссылок дублей; `tests/unit/property-search/p0c-results.test.ts` — доступность действий в обоих видах |
| Сохранённые фильтры / повтор | `tests/integration/property-search-server-v31.test.ts`: `round-trips advanced saved filters and repeats the retrieved profile without broadening`, `identical saved profile preserves novelty and flags only an observed compatible price change`; `tests/integration/property-search.test.ts` — stale update; `tests/authorization/property-search.test.ts` — повторная проверка прав после передачи потребности |
| Права поиска и подбора | `tests/authorization/property-search.test.ts`, `tests/authorization/property-search-picker.test.ts` — чужие need/run/export, личные закладки, архивные/чужие записи |

### Проверка P0-C относительно 1c2c9ec

Доработаны `search-results-v31.tsx` и `listing-photo.tsx`:

- Таблица теперь всегда показывает вердикт, подозрение дубля, неизвестные площадке поля и отдельное
  предупреждение об AI; эти признаки не зависят от пользовательского набора колонок.
- В адресной ячейке видны тип, район и этаж. Фото входят в начальный набор колонок, миниатюра CRM
  компактная (96×64). Повторное использование внешних фото не добавлено: остаётся существующая
  политика авторских прав и переход к фотографиям первоисточника.
- Общие действия строки и карточки: «В подборку», «К сравнению», «Открыть источник», «Сохранить»,
  «Экспорт». Экспорт строки открывается с одним выбранным объявлением; общий экспорт — всей выдачей,
  с сохранением выбора XLSX/CSV и всех/выбранных. Подтверждение переноса в CRM сохранено.
- Факты и AI-доказательства различаются оформлением. Неизвестная дата не подменяется fetchedAt,
  неизвестный период аренды не подставляется из запроса, предполагаемые дубли не сливаются.
- Панель площадок уплотнена до четырёх колонок на desktop, технические метрики убраны под details;
  статусы и counts всегда видны, причины и ручные действия доступны при раскрытии площадки.
  CAPTCHA needs_user_action раскрывается сразу. Массовые действия раскрываются при выделении.
  Серверные сортировки и массовые операции сохранены.

`tests/unit/property-search/p0c-results.test.ts` — 5 SSR-проверок таблицы/карточек: unknown, duplicate,
AI, частичный результат, статус заблокированной площадки, фото-ссылка и все действия; confirmed
имеет явную метку «Подходит», массовые действия раскрываются после выделения.

Синтетическая React-разметка дополнительно отрисована установленным Chromium с текущим
`globals.css` в viewport 1366×768 (без приложения, БД, сети и `.env`). Снимки:
[таблица](live-search-v322-p0c-table.png), [карточки](live-search-v322-p0c-cards.png).
Ширина документа 1366 в обоих видах: горизонтального переполнения страницы нет; таблица имеет
собственную прокрутку (ширина содержимого 1122 внутри блока 1076). После уплотнения первое
объявление в карточках начинается на y=598 вместо y=736 при двух синтетических площадках.
Стенд не включает остальную оболочку CRM; это проверка компонента, не end-to-end приложения.
Новый browser/e2e-прогон приложения не выполнялся; существующий `tests/e2e/search-v31.spec.ts` сохранён, его старые результаты здесь не переобъявляются PASS.

### История отчёта и дополнительное исправление

`docs/vkr/search-quality.md` восстановлен из `5b01326^`: базовая линия, прежний REPLAY и весь
дополнительный LIVE-срез v3.1 сохранены. Новый REPLAY v3.2.2 добавлен отдельно. Генератор
`scripts/search-quality/evaluate.ts --write` заменяет только блок v3.2.2; unit-тест проверяет
сохранность истории, идемпотентность и сохранность последующих ручных разделов.

В эвристике дублей из 5b01326 исправлен ложный флаг для одной улицы и **разных известных домов**:
уличный fallback допустим только при отсутствии номера дома у одной стороны. Тест включает
дома 58 и 59, 58 и 58/1, 58 и 58 корпус 2; D01–D03 по-прежнему покрыты. Автослияния нет.

REPLAY корпуса 49 × 4 = 196: ложные включения 1/150 (0 confirmed + 1 review), исключения 0/46,
ошибки точного вердикта 5; подозреваемые размеченные пары TP=3, FP=0, FN=0, TN=2.
Это проверка фиксированного корпуса, не оценка полноты рынка и не новая LIVE-матрица.

### Итоги проверок продолжения

- `npx tsc --noEmit` — PASS, exit 0 (`tsc-v322.log`).
- `npx eslint <11 изменённых TS/TSX-файлов инкремента> --max-warnings=0` — PASS, exit 0 (`eslint-v322.log`).
- Полный `npx vitest run --project unit` вне sandbox — **110 файлов, 1949 passed, 5 skipped**,
  251.14 с (`unit-v322-unsandboxed.log`). Прогон выполнен до последнего уплотнения UI и добавления
  пятого SSR-теста; финальное UI проверено следующим целевым прогоном.
- Финальный unit по `tests/unit/property-search`, `tests/unit/ai/search-ai.test.ts`,
  `tests/unit/ai/gate.test.ts`, `tests/unit/ux-search-workspace.test.ts` — **28 файлов, 670 passed**,
  43.71 с (`unit-search-v322.log`).
- `npx vitest run --project integration-sqlite tests/integration/property-search tests/integration/search-runtime-backend.test.ts tests/integration/search-readiness-security-regressions.test.ts tests/authorization/property-search`
  — **8 файлов, 75 passed**, 73.32 с (`sqlite-search-v322.log`).
- Те же фильтры с `--project integration --project authorization` — PostgreSQL 127.0.0.1:55432,
  **8 файлов, 75 passed**, 95.05 с (`pg-search-v322.log`).
- `npx tsx scripts/search-quality/evaluate.ts --write` — PASS, история сохранена, 196 REPLAY-проверок
  (`replay-v322.log`); baseline/fixture fingerprint не менялись.
- Chromium, синтетический HTML компонента, 1366×768 — снимки выше; ширина страницы 1366 в обоих видах
  (`visual-v322.log`). Приложение, сетевые площадки и платный AI при этой проверке не запускались.
- `git diff --check` и staged confidential guard — PASS перед коммитами.

Логи локальные, игнорируются Git. Первый полный unit внутри sandbox дал 1930 passed / 15 failed /
5 skipped: все 15 ошибок — EPERM при создании синтетических Windows junction. Полный повтор вне
sandbox прошёл, защитные проверки не ослаблялись. Первый PG-запуск был закрыт sandbox (EACCES),
повтор с доступом к авторизованной тестовой БД прошёл. Синтетическая workbook-фикстура, которую
перегенерирует общий unit-набор, возвращена к HEAD; в коммиты не включалась.

Ограничения остаются прежними: внешние CAPTCHA/блокировки не обходятся; часть жилых фильтров
unsupported; неизвестные периоды аренды/даты требуют проверки. Платный LIVE AI и полноценный e2e
приложения в этом продолжении не запускались. Новые запросы на площадки не отправлялись: LIVE-итоги
выше относятся к ранее сохранённой матрице 08.11.2026.
