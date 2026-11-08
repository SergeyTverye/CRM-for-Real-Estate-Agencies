# CAPTCHA с участием сотрудника — SR-06 / AT-05 / AT-06

Обновлено 06.11.2026. Основа: ТЗ v3.1 SR-06, AT-05/06. Данные проверок **DEMO**: собственный HTTP-стенд, настоящие PostgreSQL, Chromium и маршруты API CRM. Реальные ограничения площадок не снимаются технической работоспособностью браузера.

## Производственная цепочка

1. Durable очередь создаёт `SearchRun` и `SearchRunSource`; адаптер распознаёт проверку как `needs_user_action`. Сохранённые результаты других источников остаются доступны.
2. На источнике отображается `StartBrowserSession`. POST `/api/v1/browser-sessions` принимает только `{searchRunId,source}`; URL, cookies, flags, profile path и JS от клиента не принимаются.
3. Production composition root лениво подключает `ProductionInteractiveSearchAdapter` через `attachInteractiveSearchAdapter`. Проверяются владелец SearchRun, доступ к need и статус источника. URL выдачи строится штатным парсером **из сохранённых filters/depthParams задания**, с исходным городом, операцией, назначениями и ограничениями глубины; главная страница площадки не используется. URL/параметры остаются в памяти, в InteractiveBrowserSession записывается только hostname.
4. Оператор включает разрешённые источники через `BROWSER_SESSION_ALLOWED_SOURCES=cian,...` **после проверки основания доступа**. По умолчанию список пуст. При отсутствии разрешения источник становится `blocked`, API возвращает понятный конфликт и предлагает ссылку/официальный импорт. Включение ENV само по себе не предоставляет разрешение площадки.
5. Сессия связана с SearchRun FK и с его единственным `(runId,source)`; миграций не понадобилось. `/progress` возвращает последнюю сессию этого источника (id/status/closeReason/expiresAt) только владельцу. Активную проверку можно открыть повторно кнопкой «Вернуться к проверке площадки».
6. Отдельный Chromium получает временный профиль. CDP отдаёт только последний JPEG; `/frame?after=N` — no-store long-poll до 5 с, 5 запросов/с. Ввод через API: клик/прокрутка, ограниченные клавиши, текст ≤128 символов, 20 команд/с. DOM, cookies, полный URL, CDP endpoint и storage path не выдаются UI.
7. Пользователь проходит проверку. `isReady` подтверждает распознаваемые карточки/явный нулевой итог конкретным парсером, а не отсутствием слова CAPTCHA. Проверка навигации ограничена 5 с; transient navigation не выдаётся наружу как Playwright exception.
8. `collect` использует **переданные page/context**: читает текущую выдачу через `real-estate-scrapper.parsers[source].parsePage`, извлекает даты, нормализует карточки. Разрешены следующие страницы в том же контексте, в пределах исходного source-depth и лимита. Второй браузер/HTTP-сеанс не создаётся, CAPTCHA автоматически не решается. JSON/API-only страницы без поддержанного HTML-парсинга безопасно требуют ручного пути.
9. Application повторно проверяет пользователя/run/need/отмену, URL и фильтры. Транзакционный fence блокирует конкурирующую запись/отмену; результаты и snapshots сохраняются **в исходный SearchRun**. Обновляются result/accepted/received counts, глубина, status, progress; группировка дублей вызывается после commit. Повторное complete не создаёт дублей.
10. Повторная блокировка прекращает сбор: уже прочитанные валидные страницы сохраняются, источник `blocked`, запуск `partial`, сессия `failed/blocked_again`. Старые snapshots не стираются; UI предлагает добавление по ссылке/официальную выгрузку.
11. Успех → `completed/search_resumed`, idle 10 минут или общий срок 20 минут → `expired` и источник `blocked`. Отмена задания закрывает его сессии как `cancelled/search_cancelled`, источник `cancelled`. Watchdog видит отмену/деактивацию из другого процесса. При потере процесса GET **и frame polling** закрывают потерянную сессию как `failed/process_lost`. Cookies не восстанавливаются.
12. Chromium закрывается до I/O БД, профиль удаляется, последний кадр очищается. После аварийного SIGKILL собственные профили старше 21 минуты удаляются reaper при следующем открытии. Возврат из viewer ведёт на `/property-search?runId=...`; штатный опрос progress/results обновляет выдачу после продолжения.

## Изоляция и сетевые ограничения

Только владелец сессии; руководитель также получает 404 на чужую metadata/frame/input/complete/cancel. Все запросы проверяют активную CRM-сессию, POST — same-origin и active instance. Скрытие кнопки не заменяет серверные проверки.

Service workers, WebSocket, popups, downloads, file chooser и dialogs блокируются. Нет разрешений камеры/микрофона/геолокации, экспорта cookies, HAR/trace/video, автоматического распознавания CAPTCHA и подмены fingerprint. CDN разрешены только для ограниченных GET ресурсов; навигация — на HTTPS:443 домены источника. Каждый HTTP-ресурс проходит hostname policy и DNS-pinned `safeRequest`, включая iframe.

**HTTP redirect:** Chromium может следовать перенаправлению перехваченного ответа без повторного route-interception. Поэтому браузер никогда не получает 3xx: допустимая навигация сначала получает инертный 200 с browser-managed Set-Cookie, после commit выполняется отдельный защищённый GET. Не более пяти переходов; чужой домен и redirect ресурса запрещены, POST 307/308 безопасно отклоняется. Это проверено отдельной browser-регрессией. В стендовом browser DI внешний DNS дополнительно запрещён; production SSRF allowlist не расширен.

В БД/аудите — только статусы, фиксированные причины, run/source/owner и времена. Пароли, auth cookies, введённый текст, HTML, JPEG и Playwright exceptions не журналируются. Cookies существуют только в изолированном Chromium и OS temp-профиле.

## Docker и лимиты

`docker compose build app` собирает один production image для app/search-worker. Chromium, chromium-common и **chromium-sandbox** закреплены одной версией; пользователь node, `chromiumSandbox:true`. Официальный [seccomp-профиль Playwright v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json) сохранён в `ops/chrome/seccomp.json`; используется в app/search-worker. Нет `--no-sandbox`, privileged, SYS_ADMIN или seccomp=unconfined. Основание: [Playwright Docker / crawling](https://playwright.dev/docs/docker#crawling-and-scraping).

Для app/search-worker: память 2 GiB, pids 256, shm 256 MiB, `/tmp` — ephemeral tmpfs 512 MiB (nosuid/nodev). Профили `/tmp/crm-browser-session-*` не попадают в файловый том и backup. Chromium ограничивает число renderer-процессов и JS heap. `BROWSER_SESSION_MAX_CONCURRENT=1` по умолчанию, максимум 3; process-local проверка дополнена глобальным PostgreSQL advisory lock/подсчётом активных claims. Конкурирующие процессы не обходят лимит.

Контексты принадлежат одному application process. Несколько реплик Next/cluster-mode без sticky routing владельца не поддерживаются. Search-worker не обслуживает интерактивный CDP: он переводит источник в ожидание, а браузер открывает app по действию сотрудника. При kernel/seccomp запрете sandbox запуск безопасно завершается ошибкой и ручным путём; отключать sandbox автоматически нельзя.

## Воспроизведение

```powershell
$env:TEST_DATABASE_URL='postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_d'
npx vitest run --project integration tests/integration/captcha-hitl-production.test.ts tests/integration/browser-sessions-pg.test.ts tests/integration/property-search-server-v31.test.ts
npx vitest run --project browser-cycle tests/integration/browser-sessions/browser-cycle.test.ts
npx vitest run --project unit tests/unit/browser-sessions tests/unit/property-search
npx tsc --noEmit
# Полная контейнерная проверка: build, отдельная БД, миграции, 6 сценариев.
powershell -File scripts/test-captcha-hitl-docker.ps1
```

`production-cycle.ts` использует реальные Next API handlers с cookie/Origin, Prisma repository, очередь, production continuation и парсер Циана. Только transport направлен в собственный стенд; loopback не доступен через production ENV/API. Стенд выдаёт синтетический Cian SSR после ввода «человек» через **API input**. Проверяются API JPEG, исходный run/source, snapshots, прогресс, повторный complete и удаление **конкретного собственного профиля**. Это не проверка отсутствия чужих параллельных temp-каталогов.

Контейнерный runner монтирует только синтетическую фикстуру/скрипт read-only; production src и зависимости берутся из образа. Используется отдельная `crm_test_hitl_docker`, без изменения production/demo DB. Созданные cookie-сессии отзываются в finally. Docker baseline Node 24; локальный host — Node 22.23.4. Новые npm-зависимости и миграции не добавлялись.

## Фактические проверки 06.11.2026

Typecheck и scoped ESLint — PASS; unit **493/493**, integration **26/26** (стандартный 30-секундный testTimeout; повтор с 90 с под нагрузкой также PASS), browser **6/6**, итоговый production Docker **6/6** — PASS. Финальный image и команды сохранены в [машиночитаемом протоколе](captcha-hitl-production.json).

Финальные результаты и ограничения — в [AT-05](../acceptance/v31/AT-05.md) и [AT-06](../acceptance/v31/AT-06.md). Локальные технические логи (без cookies/текста ввода) находятся в игнорируемом `data/captcha-hitl-*.log`. Общий release gate всей CRM относится к AT-17.

## Условия доступа площадок: проверенные факты и границы

Проверка официальных страниц выполнена 05.11.2026 через web research отдельно от единственного LIVE browser probe. Где текущий документ не удалось получить, это не представлено как подтверждённое право. API профессионального кабинета и импорт собственных объявлений не означают лицензию на сбор всей рыночной базы.

| Источник | Основания и что подтверждено | Автоматизированное продолжение / договор |
|---|---|---|
| Циан | [Условия API из §12 ТЗ](https://www.cian.ru/legal-documents/usloviya_ispolzovaniya_servisa_api_855) доступны в индексе официального сайта; прямое чтение вернуло 403. Использование API связано с аккаунтом/ключом; Циан оставляет возможность прекращения доступа. [Официальная страница API](https://promo.cian.site/api) описывает интеграцию CRM с собственным кабинетом: сообщения, бюджет, услуги, сотрудники; ключ получают в кабинете. Выгрузка объявлений — XML. | Профессиональный API требует подключения/ключа и соблюдения применимых условий, отдельные продукты могут быть платными. Он не подтверждает свободный read API всей рыночной выдачи. [Правила сайта](https://www.cian.ru/legal-documents/pravila_polzovaniya_sajtom_cian_0/) и [индексируемая версия](https://www.cian.ru/legal-documents/pravila_polzovaniya_sajtom_cian_781) нужно соотносить с действующей редакцией и основанием доступа. Текущий browser probe: WAF BLOCKED. |
| Авито | Исследованы официальные точки: [условия использования](https://www.avito.ru/legal/rules/terms-of-use), [правила API](https://www.avito.ru/legal/pro_tools/public_api), [Autoload](https://www.avito.ru/legal/pro_tools/autoload), [портал разработчика](https://developers.avito.ru/). Их содержимое в этом окружении недоступно; актуальные пункты и тарифные права не подтверждены. | Официальная интеграция должна подключаться через доступный агентству API/Autoload, по фактическим scopes, тарифу и договору кабинета; ключи не входят в модуль. Нельзя на основании названия Autoload утверждать наличие API произвольного поиска чужих объявлений. Производственное автоматизированное продолжение допускается только после фиксации применимых условий/разрешения; пока право не подтверждено — blocked/ручной путь. |
| Домклик | [Текущая официальная ссылка условий](https://domclick.ru/fs/public/docs/terms-of-use.pdf) в проверке вернула 503; `/terms` — 401. Найден [официальный архив 21.08.2020](https://domclick.ru/fs/public/docs/archive/terms-of-use-21082020.pdf): п. 10.2.18 описывает необходимость письменного разрешения для соответствующей автоматизации, п. 10.2.20 ограничивает считывание скриптами/роботами. Это **архив**, не доказательство редакции 2026 года. | До авторизованного адаптера требуется актуальная редакция/разрешение и условия профессионального кабинета либо партнёрского договора. Наличие кабинета не даёт автоматического права читать чужую базу. Открытый общерыночный API и его scopes этой проверкой не подтверждены. Запасной путь — разрешённая выгрузка/ручное добавление. |
| Яндекс Недвижимость | Найдены официальные [условия сервиса](https://yandex.ru/legal/realty_termsofuse/ru/), [лицензия БД/программы](https://yandex.ru/legal/realty_licenseagreement/ru/), [соглашение об информационном сотрудничестве](https://yandex.ru/legal/realty_agreement/ru/). [XML-фиды](https://yandex.ru/support/realty/ru/feed/) предназначены для передачи своих объявлений; справка требует кабинет Агент/Агентство/Застройщик и ОГРН/ОГРНИП. [Формат](https://www.yandex.ru/support/realty/ru/feed/content-requirements) — YRL/XML. | Допустимый путь размещения своих данных — собственный фид в кабинете с соблюдением соглашения и требований; коммерческие услуги — по применимым условиям. Это не endpoint скачивания всей базы. Свободная лицензия на автоматизированное чтение/копирование рыночной выдачи не установлена; для иной интеграции нужны применимые права/партнёрские условия. |

В §12 ТЗ заказчик добавил пометку: «можем обходим ограничения АПИ через Playwright и его аналоги - это окей и не нарушает соглашение». Она учтена как позиция заказчика и разрешение на разработку/ограниченный технический probe. Она сама по себе не является документом Циана и не доказывает изменение условий его API/сайта. Замена HTTP-клиента браузером не меняет автоматически договорные права. Это инженерное разграничение подтверждённых источников, а не утверждение о юридической допустимости конкретного договора агентства. Лимиты и ограничения не снимаются, CAPTCHA не распознаётся автоматически, подмена fingerprints/прокси-ротация не применяются.


## v3.2.3 — честные браузерные проверки 09.11.2026 (LIVE, без обхода)

Полный протокол: [../vkr/live-search-v323-captcha.md](../vkr/live-search-v323-captcha.md),
машиночитаемо: [../vkr/live-search-v323-captcha-browser.json](../vkr/live-search-v323-captcha-browser.json).
Обычный Playwright Chromium, headed, без stealth (без подмены отпечатков/automation-флагов,
без авторешения, без прокси). Вежливо: последовательно, ≥2 с между площадками.

- **Циан headed:** HTTP 200, 1 042 объявления, challenge=false, listing=true — JS-check
  проходит сам без участия пользователя. **Циан headless:** HTTP 403 «Ошибка - Циан» —
  BLOCKED. Скриншот успеха не сохраняется (возможны контакты); блок-страница headless:
  `docs/screenshots/vkr/v323-captcha/cian-blocked.png`. Перехваченный транспорт очереди CRM
  (`safeRequest`) даёт `needs_user_action` (plain) / `blocked 403` (browser) — успех
  реального headed-браузера не повторяется серверным headless-перехватом, поэтому
  автоматический режим без пользователя для Циана в headless-Docker не включён;
  HITL-путь «Пройти проверку в браузере CRM» сохранён, продолжение — в той же сессии/cookies.
- **Яндекс:** HTTP 200 и в headed, и в headless, vendor-парсер 22 результата, challenge=false.
  Скриншот не сохраняется (выдача). Кандидат на будущий автоматический браузерный режим;
  в этом инкременте включается только честность статусов/UI.
- **Авито:** HTTP 403 в обоих режимах (`avito-blocked.png`). **Домклик:** HTTP 401
  (`domclick-blocked.png`). Даже реальный браузер выдачу не даёт — обход не реализовывался.
  UI для `blocked`: объяснение + «Пройти проверку в браузере CRM» + «Добавить объявление
  по ссылке» + «Импорт выгрузки». Бэкенд при разрешённой площадке переоткрывает
  `blocked → needs_user_action` в том же запуске/сессии; без разрешения — понятный
  конфликт, статус не меняется.
- Исправлен запуск браузерного режима очереди: убран жёсткий `channel:"chrome"`,
  путь берётся из `SCRAPER_BROWSER_EXECUTABLE_PATH` или `SCRAPER_CHROME_PATH`, иначе
  встроенный Chromium. Механика продолжения в той же сессии и повторного использования
  сессии проверена DEMO: `browser-cycle.test.ts` 6/6, `captcha-hitl-production.test.ts`,
  новый Playwright `tests/e2e/captcha-stand-demo.spec.ts` (стенд only).
- Что подтверждено LIVE: headed-успех Циана, headless-успех Яндекса (22), BLOCKED
  Авито/Домклика и Циана headless. Что только на стенде: сквозное продолжение
  поиск → needs_user_action → браузерная сессия → collect в том же context →
  повторное использование сессии. Шаги, требующие человека: ручное прохождение
  проверки в `BrowserSessionView` («Пройти проверку в браузере CRM» → «Готово»),
  решение о включении площадки через `BROWSER_SESSION_ALLOWED_SOURCES` после проверки
  основания доступа.

## LIVE и прежние визуальные доказательства

В этой работе отдельный LIVE smoke площадок не запускался. Сохраняется прежний факт от 05.11.2026: **один ручной LIVE probe Циана — BLOCKED, cian_waf_block**, без решаемой CAPTCHA и без результатов. [Метаданные](captcha-hitl-cian-live.json), [LIVE screenshot](captcha-hitl-cian-live.png). Это не результат текущих DEMO-прогонов и не доказательство доступа к рынку Циана.

Предыдущая визуальная проверка штатного Next viewer: [DEMO screenshot](captcha-hitl-crm-demo.png). Текущая React/browser-регрессия использует настоящий `BrowserSessionView` в локальном harness. Пользовательская апробация и живые проверки всех семи источников этим набором не подменяются.
