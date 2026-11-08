# LIVE v3.2.3 — браузерные проверки (Циан/Яндекс/Авито/Домклик) — 09.11.2026

Режим: **LIVE** — только этот раздел; **REPLAY** — ссылки на прошлые доказательства;
**DEMO** — только синтетический стенд; **BLOCKED** — зафиксированные отказы.
Машиночитаемый протокол: [live-search-v323-captcha-browser.json](live-search-v323-captcha-browser.json).
Скрипты: `scripts/live/v323-captcha-browser-probe.ts`, `scripts/live/v323-capture-blocked.ts`.
Скриншоты страниц блокировок без персональных данных: `docs/screenshots/vkr/v323-captcha/`.

Параметры: 1 поисковый URL на площадку (аренда офиса, Новосибирск, `maxPages=1/limit=5`),
последовательно с паузой ≥2 с между площадками (разные хосты), ожидание JS 6–7 с,
обычный Playwright Chromium без stealth (без подмены отпечатков/automation-флагов,
без авторешения, без прокси). Детали объявлений не открывались, тела/контакты/URL
карточек не сохранялись — только статусы/байты/заголовки/маркеры.

## Итоги LIVE (обычный Chromium, без stealth)

| Площадка | Headed (с дисплеем) | Headless | Вывод |
|---|---|---|---|
| Циан | HTTP 200, 1 346 043 байт, `Снять офис… — 1 042 объявления`, challenge=false, listingMarker=true, **autoPassed=true** | HTTP 403, 15 969 байт, `Ошибка - Циан`, listing=false | JS-check проходит сам в headed; в headless — BLOCKED. Скриншот успеха не сохраняем (возможны контакты). Блок-страница headless: `v323-captcha/cian-blocked.png` |
| Яндекс | HTTP 200, 1 261 838 байт, `727 объявлений`, challenge=false, vendor-парсер 22 результата | HTTP 200, 1 261 246 байт, vendor-парсер 22 результата | Выдача отдаётся автоматически и в headless, и в headed. Скриншот не сохраняем (выдача). |
| Авито | HTTP 403, 293 байта | HTTP 403, 293 байта | BLOCKED в обоих режимах. `v323-captcha/avito-blocked.png` |
| Домклик | HTTP 401, 26 627 байт, `403 | Домклик` | HTTP 401 | BLOCKED в обоих режимах. `v323-captcha/domclick-blocked.png` |

Дополнительно (очередь CRM, перехват через `safeRequest`):
- Циан plain HTTP → `needs_user_action` / `NEEDS_USER_ACTION` (Servicepipe, 2 249–2 293 байта).
- Циан с `browserEnabled` (исправленный запуск без `channel:chrome`) → `blocked` / `ACCESS_BLOCKED HTTP 403`.
- Яндекс plain HTTP → `needs_user_action`.
- Вывод: перехваченный браузерный транспорт CRM (через `safeRequest`) не повторяет
  успех реального headed-браузера для Циана; ручной HITL-путь для Циана сохраняется.
  Для Яндекса реальный браузер (даже headless) отдаёт выдачу — кандидат на автоматический
  браузерный режим в будущем, в этом инкременте меняется только честность статусов/UI,
  без включения нового автоматического чтения.

## Разделение режимов

- **LIVE (этот прогон):** 4 браузерных проверки выше + 1 headless-перепроверка Циан/Яндекс
  (22 результата Яндекс vendor-парсером в обоих режимах). AI, БД, `.env`, private-data,
  Excel не использовались. Сырые тела, тексты, контакты и URL карточек не сохранялись.
- **REPLAY:** LIVE-матрица v3.2.2 (`live-search-v322.md`, 28 заданий, без браузера);
  Servicepipe-фикстура `tests/fixtures/scraper/v322/cian-servicepipe-check.html`;
  smoke-фикстуры `tests/fixtures/scraper/v31/*/live.json`.
- **DEMO:** CAPTCHA-стенд `tests/fixtures/captcha-stand/`; новый Playwright e2e
  `tests/e2e/captcha-stand-demo.spec.ts` (проверка → выдача в той же сессии/cookies,
  повторный визит без повторной проверки; вторая страница `blockNextPage` честно
  остаётся недоступной). Механика продолжения в исходный `SearchRun` покрыта
  `browser-cycle.test.ts` (6/6) и `captcha-hitl-production.test.ts`.
- **BLOCKED:** Циан headless, Авито 439/403, Домклик 401 — в обоих браузерных режимах.
  Ручные пути: «Добавить объявление по ссылке», «Импорт выгрузки» (Autoload/Яндекс XML
  уже распознаются в `official-feed.ts`); для заблокированных — кнопка
  «Пройти проверку в браузере CRM» с честным конфликтом при отсутствии разрешения
  и переводом `blocked → needs_user_action` при разрешённой площадке.

## Найденные дефекты и исправления (этот инкремент)

1. `defaultScraperFactory` требовал `channel:"chrome"` и игнорировал `SCRAPER_CHROME_PATH`
   в очереди (в HITL используется `SCRAPER_CHROME_PATH`). На хостах без Chrome запуск
   падал до сети. Исправление: канал только при явной настройке, иначе встроенный
   Chromium; путь берётся из `SCRAPER_BROWSER_EXECUTABLE_PATH` или `SCRAPER_CHROME_PATH`.
2. Заблокированные Авито/Домклик показывали голое «Заблокирован» без браузерного пути.
   Исправление: объяснение + «Пройти проверку в браузере CRM» + «Добавить объявление
   по ссылке» + «Импорт выгрузки». Бэкенд `browser-continuation.prepare` при разрешённой
   площадке переоткрывает `blocked → needs_user_action` в той же сессии/запуске;
   без разрешения — понятный конфликт, статус не меняется. Повторные поиски в течение
   жизни сессии используют её (cookies живут в изолированном профиле, что проверено
   DEMO e2e на стенде).
3. Текст кнопки HITL унифицирован: «Пройти проверку в браузере CRM» (содержит оба
   требуемых смысла п.2/п.3), для `needs_user_action` — тот же компонент.

## Проверки (этот инкремент)

- `npx eslint <7 изменённых/новых TS-файлов> --max-warnings=0` — PASS.
- `npx vitest run --project unit tests/unit/property-search tests/unit/browser-sessions` — **30 файлов, 683 passed** (после `prisma generate`; до генерации 2 файла падали по отсутствию generated-клиента, не по коду).
- `integration-sqlite captcha-hitl-production + browser-sessions-pg` — **2 файла, 7 passed**.
- `TEST_DATABASE_URL=.../crm_test_b integration captcha-hitl-production + browser-sessions-pg` — **2 файла, 7 passed**.
- `browser-cycle` — **1 файл, 6 passed**.
- Новый `tests/e2e/captcha-stand-demo.spec.ts` — Playwright DEMO (стенд only); полный
  `playwright test` требует `next build` (не запускался здесь,逻辑 проверена стендом
  и `browser-cycle`). ESLint этого файла — PASS.
- Исторический результат `tsc` был ошибочно назван «предсуществующими ошибками».
  При повторной проверке найдена собственная ошибка в `v323-capture-blocked.ts`:
  `buildSearchUrl(q: typeof q)` ссылался на тип самого параметра. Исправлено имя параметра.
  Рабочая копия использует junction `node_modules` и требует локальной генерации обоих
  Prisma clients и типов Next.js. После этого полный `npx tsc --noEmit` — **PASS, exit 0**
  (без фильтрации ошибок); production `next build --webpack` с проверкой типов — PASS.
- `node scripts/security/confidential-guard.mjs --staged` — PASS перед коммитами.
- LIVE-запросы: 4 headed + 3 headless-блок + 2 headless-перепроверки + 3 queue-пробы,
  интервал ≥2 с, без контактов/тел/документов в evidence.

Ограничения: Циан headless (продакшн Docker без дисплея) остаётся BLOCKED — автоматический
браузерный режим без участия пользователя для Циана в headless не включён; headed-успех
зафиксирован честно, но не выдаётся за серверное поведение. Авито/Домклик BLOCKED даже
в реальном браузере — обход не реализовывался. Платный LIVE AI и полный e2e приложения
не запускались.

## v3.2.3 — native navigation через очередь CRM (09.11.2026, LIVE)

Это новый сквозной прогон, заменяющий прежний вывод «кандидат на будущий режим».
Обычный Chromium выполняет настоящий `page.goto` и JavaScript, затем HTML читает
существующий парсер. Циан — видимое окно 1100×760, Яндекс — headless. Ни ввода,
ни решения CAPTCHA, ни stealth/прокси/подмены automation flags нет.

Стенд: production build `NEXT_DIST_DIR=.next-v323-captcha`, `next start` на
`127.0.0.1:3383`, PostgreSQL `crm_demo`, отдельный production search worker,
`SCRAPER_ENABLED=true`, `SCRAPER_BROWSER_ENABLED=true`, AI выключен, fixtures выключены.
Создана временная серверная сессия существующего синтетического manager через штатный
session service, отозвана после проверки; пароль пользователя не менялся.
Задания созданы через аутентифицированный `POST /api/v1/property-search/runs`,
прогресс получен HTTP API, количества проверены в `search_run_results` и source rows.
Страница `/settings/sources` HTTP 200, новый переключатель присутствует в HTML.

Запрос: **«аренда офиса Новосибирск»**, depth=1, limit=5 на источник,
общий deadline=180 с. Источники последовательны, между заданиями ≥2 с,
между native навигациями ≥1,5 с. На native-площадках четыре запланированных
поисковых навигации (Циан дважды, Яндекс дважды); у mirkvartir/onrealt по одному
SERP HTTP-запросу и до трёх запросов дат карточек. Отдельных LIVE-проб/пагинации
сверх этого прогона не выполнялось; лимит 60 навигаций не исчерпан.

| Поиск | Сохранено в запуске | Время запуска | Источники | Итог |
|---|---:|---:|---|---|
| Циан | 5 | 16,016 с | cian: success, 11,473 с | completed; needsUserAction=false |
| Яндекс | 5 | 23,501 с | yandex: success, 22,895 с | completed; needsUserAction=false |
| Циан + Яндекс + Мир Квартир + OnRealt | 20 | 48,012 с | cian: 5 / success / 8,192 с; yandex: 5 / success / 15,668 с; mirkvartir: 5 / success / 7,053 с; onrealt: 5 / success / 15,148 с | completed; needsUserAction=false у всех |

Всего 30 связей результатов в трёх запусках; это не утверждение о 30 уникальных
объектах рынка. Ограничение глубины явно сохранено в reason. У OnRealt одна ошибка
дополнительного запроса даты (2 даты обогащены, 1 ошибка), пять объявлений сохранены.
Cookies persistent-профилей использовались повторно между отдельным и совместным
заданиями; оба источника снова дали выдачу без участия человека.

Машинный протокол: [live-search-v323-browser-queue.json](live-search-v323-browser-queue.json).
Воспроизводимый скрипт: `scripts/live/v323-browser-queue.ts`. В evidence только
агрегаты/служебные run ID/причины статусов; HTML, тексты объявлений, контакты и URL
карточек не выгружались в Git. Настройки ai_settings восстановлены, тестовая сессия
отозвана, дерево worker/Chromium и server остановлены. Повторный запрос к порту 3383
подтвердил закрытие (`OWN_STAND_STOPPED`). Рабочая установленная программа не затронута.

### REPLAY / DEMO и проверки

- Финальная Unit/REPLAY регрессия поиска/browser sessions/composition/migration:
  **33 файла, 697 passed**, включая Docker без дисплея и отключение native-режима.
- Native fake browser: результат / оставшаяся проверка / JS wait / один context
  для пагинации и деталей / повторный профиль / CDP redirect и private-DNS отказ.
- Интеграция: **26 passed, 6 файлов/проектов** (PG `crm_test_b` и SQLite):
  `property-search-browser-navigation`, `property-search-real-queue`,
  `captcha-hitl-production`. Настоящий парсер, очередь, транзакции, сохранение,
  чужой run ID, существующее HITL-продолжение; native browser заменён fake.
- SQLite populated upgrade проверен внутри и вне внешней транзакции. PG миграция
  успешно применена к заполненной `crm_demo`; чистые PG/SQLite миграции — integration.
- Полный `npx tsc --noEmit`, ESLint изменённых TS/TSX, production build, diff check — PASS.
- Docker Cian без дисплея: **REPLAY**, `needs_user_action`, Chromium не запускается;
  новый LIVE Docker запуск не заявляется. Детали/пагинация native-площадок — fake/REPLAY,
  не новый многостраничный LIVE. Авито/Домклик в новом прогоне не опрашивались.

Настройки `/settings/sources`: «Автоматическая проверка в браузере» отдельно для
Циана/Яндекса; nullable значение означает desktop/display default (Циан) либо ON
(Яндекс). Для Циана без дисплея переключатель недоступен с объяснением и HITL-путём.
При сохранившейся проверке source становится `needs_user_action`, доступна прежняя
кнопка «Пройти проверку в браузере CRM». Архитектура и сетевая граница —
[ADR 0034](../adr/0034-source-native-browser-navigation.md).
