# Release gate v3.1 — AT-17

## Окончательный SHA c812d18

**06.11.2026, 02:06–02:15 UTC. AT-17: PASS.** Проверен `c812d18c0e835e25598e432036da9284bd9c306d`, ветка `feature/tz-v3.1`. Перед проверками `git status --short` пустой. Исходный код, схема, зависимости и lockfile не менялись. После проверок внесена только документация и доказательства. Прежний прогон ниже сохранён как история и заменён этим разделом в части итогового статуса.

| Проверка | Фактический результат |
|---|---|
| `npx prisma validate` | PASS, exit 0 |
| `npx tsc --noEmit` | PASS, exit 0 |
| `npx eslint . --max-warnings=0` | PASS, exit 0, 0 warnings |
| `npm test` | **1363/1363**, 62 файла, 85.07 с |
| `TEST_DATABASE_URL=…/crm_test_h npm run test:integration` | **326/326**, 52 файла, 326.15 с; отдельная БД на 127.0.0.1:55432, штатный setup пересоздал схему |
| `NEXT_DIST_DIR=.next-build npx next build` | PASS, exit 0 |
| `NEXT_DIST_DIR=.next-build npx playwright test` | **24 passed, 1 skipped**, 2.0 мин, production `next start`, отдельная `crm_e2e` |
| `docker compose -p crm build`, `up -d --wait` | PASS; app/worker/search-worker/db healthy; readiness 200 |
| Рабочий backup → restore-test | **T08 PASS**, backup `2026-11-06_02-11-45`, 39 с |
| Чистый clone/build/up/migrate/seed/smoke | **PASS**, неизменённый c812d18 |
| Чистый backup → restore-test | **T08 PASS**, backup `2026-11-06_02-12-18`, 34 с |
| Чистый restart/persistence | PASS: users/documents/template versions `3/1/1` до и после, файлы/checksums и readiness 200 |

Штатный skip — opt-in `REPLAY сохранённых LIVE результатов без запросов площадок`, без `SEARCH_UI_REPLAY_RUN`. Обязательные production сценарии поиска v3.1, AI-чата, планера, звонков, подборок, шаблонов, v241 и qa-stage2 прошли. AI UI использует синтетический ответ; платных AI-вызовов и новых запросов к площадкам **0**. Предупреждение pg о параллельных `client.query` не подавлялось. Host Node 22.23.4 — отклонение от рекомендуемого 24; Docker runtime **24.22.2**, PostgreSQL **18.6**, Compose **5.6.1**. В Docker выполнен `npm ci`; host `npm install` не запускался. `.next`/ACL не трогались; автоматические include Next удалены из `tsconfig.json` после проверок.

### Чистое развёртывание окончательного commit

`git clone --branch feature/tz-v3.1 --no-hardlinks D:/CRM-for-Real-Estate-Agencies D:/crm-clean-v31-final`; HEAD совпал полностью, исходники клона не менялись, итоговый `git status --porcelain` пустой. Git Bash `scripts/bootstrap.sh` создал новые секреты. В локальном `.env`: `COMPOSE_PROJECT_NAME=crmclean31f`, `APP_IMAGE_TAG=clean31f`, `APP_PORT=18041` (проверен свободным), `APP_BIND=127.0.0.1`, Linux UID/GID 1000, AI/scraper false, APP_COMMIT=c812d18. `docker compose -p crmclean31f build` и `up -d --wait` — exit 0; штатный migrate завершился, seed создал три учётные записи, четыре сервиса healthy.

Вход: mustChangePassword=true → смена временного пароля → повторный вход с false. `/today`, `/property-search`, `/calendar`, `/collections`, `/templates`, `/requests`, `/clients` — **200**. Поиск при выключенном скрапере завершился **completed**, источник **disabled**. Через API созданы синтетическая подборка, DOCX-шаблон и сформированный Document.

Для обоих стеков локальный QA harness на основе `scripts/release-gate-ops.mjs` использовал project из `.env`, добавил `/today` и отдельные restore-порты 18081/18042. Копия harness находилась только в игнорируемом `data/`; исходный скрипт не менялся. Backup и restore запускались именно `D:/runtimes/Git/bin/bash.exe --noprofile --norc scripts/backup.sh` / `scripts/restore-test.sh --keep`. Старый рабочий `restore-test` без удаления сохранён в `data/restore-test-before-c812d18` после проверки отсутствия его контейнеров.

Оба T08 подтвердили БД, миграции, readiness, вход, контрольные строки, SHA256 файла и его API-download, исключение временных browser profiles. Рабочий: **6 файлов, 4 версии/файла шаблонов, 4 generated Documents**; чистый: **1 файл, 1 версия/файл шаблона, 1 generated Document**. Временный manager рабочего smoke деактивирован, сессии отозваны. Выполнены `down -v` для `crm-restoretest`, `crmclean31f-restoretest` и `crmclean31f` — все exit 0. Каталоги сохранены; основной `crm` оставлен работающим.

Доказательства: [машинная сводка](evidence-v31-final/results.json), [статические проверки](evidence-v31-final/static-checks.json), [рабочий smoke](evidence-v31-final/crm-smoke.json), [чистый smoke](evidence-v31-final/clean-smoke.json), [T08 crm](evidence-v31-final/T08-crm.txt), [T08 clean](evidence-v31-final/T08-clean.txt), [restart](evidence-v31-final/clean-persistence.json), [контрольные суммы](evidence-v31-final/SHA256SUMS). Полные локальные логи `*.log` игнорируются Git; сводка содержит их SHA256. Миграционная сверка копии v2.4.1 из предыдущего прогона не повторялась; миграции не менялись, чистое применение подтверждено заново. Новых дефектов не обнаружено. AT-17 PASS не закрывает AT-18, полноту LIVE-охвата или общую приёмку MVP по §11.

## Исторический прогон до окончательного SHA

Дата: **06.11.2026**. Проверки 00:49–01:16 UTC (03:49–04:16 Europe/Moscow). Ветка `feature/tz-v3.1`, исходный и неизменённый HEAD **`32decaacd2a313dc82a7e6fadde3cfb40d387815`**. Данные DEMO/REPLAY; платных AI и живых запросов к площадкам нет. Git commit/checkout/reset/stash не выполнялись. Машинная сводка и хэши логов — [results.json](evidence-v31/results.json), контрольные суммы приложений — [SHA256SUMS](evidence-v31/SHA256SUMS).

**Итог: технические проверки исправленной рабочей копии PASS; AT-17 — PARTIAL до фиксации исправлений координатором и проверки окончательного release SHA.** Чистый клон исходного SHA воспроизвёл дефект Dockerfile; повтор с явно указанной правкой прошёл. Результат модифицированной копии не объявляется PASS неизменённого SHA. Готовность всего MVP / AT-01…18 этим протоколом не утверждается.

## Среда и воспроизведение

Windows / PowerShell; Git Bash `D:\runtimes\Git\bin\bash.exe`; Docker Compose 5.6.1. Host Node **22.23.4**, npm 12.2.1 (отклонение от рекомендуемого host Node 24); production Docker Node **24.22.2**, PostgreSQL **18.6-bookworm**, Next **16.4.4**, Prisma **7.10.1**. Docker выполняет `npm ci`; lockfile и зависимости не менялись, `npm install` не запускался. `.next` и ACL не изменялись; сборка Windows использовала `.next-build`. Автоматические добавления Next в `tsconfig.json` отменены точечно, итогового diff нет.

Команды запускались из корня, вывод направлялся в `docs/operations/evidence-v31/*.log` (логи локальные, игнорируются Git). Итоговые отчёты и JSON в этом каталоге предназначены для Git. Переменные `$env:...` ниже — PowerShell; credentials production задавались только через ENV / локальный `.env`, без вывода.

| Команда | Фактический итог | Локальный журнал |
|---|---|---|
| `npx prisma validate` | PASS | `prisma-final.log` |
| `npx tsc --noEmit` | PASS | `typecheck-release.log` |
| `npx eslint . --max-warnings=0` | PASS, 0 предупреждений | `eslint-release.log` |
| `npm test` | **1331/1331**, 60 файлов, unit + browser-cycle, 80.97 с | `unit-release.log` |
| `$env:TEST_DATABASE_URL='postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_h'; npm run test:integration` | **315/315**, 51 файл, integration + authorization, 305.94 с | `integration-final.log` |
| `$env:NEXT_DIST_DIR='.next-build'; npx next build` | PASS, с TypeScript | `build-final.log` |
| `$env:NEXT_DIST_DIR='.next-build'; npx playwright test` | **24 passed, 1 skipped**, 1.7 мин; production `next start`, `crm_e2e` | `e2e-verified.log` |
| `docker compose -p crm build` | PASS | `docker-build-release.log` |
| `docker compose -p crm up -d --wait` | PASS, app/worker/search-worker/db healthy; readiness HTTP 200 | `docker-up-release.log` |

Первый integration запуск потребовал создать отсутствующую `crm_test_h` через `docker exec crm-test-testdb-1 createdb -U crm crm_test_h`. Схему пересоздаёт штатный global setup. Существующая demo БД не сбрасывалась. Предупреждения pg о параллельных `client.query` не являются падениями, не подавлялись.

## Production E2E и сравнение с v2.4.1

Стандартный конфиг включает `search-v31.spec.ts` (3 обязательных PASS), `ai-chat.ui.spec.ts` (PASS), `release-v31.spec.ts` (4 PASS), `v241.spec.ts` (4 PASS), `qa-stage2.spec.ts` (3 PASS), smoke и UX. AI-чат использует перехваченный синтетический provider/UI ответ; PostgreSQL авторизация AI отдельно покрывается integration/authorization. Это не LIVE AI.

Добавлены production сценарии: четыре периода планера с настоящими API/серверными агрегатами; ручной спам-звонок без Client с проверкой сохранения; независимая подборка и CSV; ввод шаблона без рестарта и настоящий ZIP/DOCX preview. Поиск v3.1 проверяет импорт, пагинацию, сортировки, дубли, XLSX, очередь/отмену и фильтры.

Единственный штатный skip: `REPLAY сохранённых LIVE результатов без запросов площадок` требует `SEARCH_UI_REPLAY_RUN`; на чистой `crm_e2e` такого внешнего run нет. Он не подменён синтетикой; обязательный REPLAY/импортный сценарий поиска выполнен. Проверки чужого Client: отдельная созданная запись, прямой API **404**, UI «Запись не найдена или недоступна» и `noindex`. HTML HTTP может быть 200 из-за `loading.tsx` / streaming Next; это не доступ к записи.

Сквозной v2.4.1: обращение → потребность → поиск → кандидат → Property → факт предложения → КП/печать → показ/результат → сделка → постсделочный контакт → уведомление. Также прошли частичный HTTP429 с сохранением успешного источника, RBAC настроек AI и приватность клиента. PDF проверен как настоящий многостраничный A4; серия 7 встреч по будням и мобильный экран 390 px проверены.

## Миграции

Восстановление исходного dump: `docker cp D:/crm-review/crm_demo_v241.dump crm-test-testdb-1:/tmp/crm_demo_v241_v31gate.dump`, `createdb -U crm crm_v241_copy`, `pg_restore -U crm -d crm_v241_copy --no-owner --no-privileges --exit-on-error ...`. Для пустой БД: `createdb -U crm crm_v31_empty`. Затем `node scripts/release-gate-migrations.mjs`: `prisma migrate deploy` для каждой БД, точный `count(*)` всех прежних таблиц до/после. Время результата **00:53:03 UTC**.

**PASS: все 7 миграций; 66 → 84 предметные таблицы; 18 новых; ни одного изменения счётчика в 66 прежних таблицах. Пустая БД получила 84 таблицы.** `_prisma_migrations` не считается предметной. SHA256 исходного dump: `16750cf10591caf3a7ed3dffea6aa98cb3c14751e357a26b084a6a2d923cfa11`. Полная машинная сверка — [migrations.json](evidence-v31/migrations.json).

| Таблица | До | После |
|---|---:|---:|
| users | 3 | 3 |
| clients / client_needs | 25 / 25 | 25 / 25 |
| lead_requests | 40 | 40 |
| properties | 33 | 33 |
| tasks | 27 | 27 |
| deals | 4 | 4 |
| documents | 157 | 157 |
| commercial_offers | 6 | 6 |
| external_listings / external_listing_snapshots | 320 / 636 | 320 / 636 |
| search_runs / calendar_events / ai_usage_logs | 53 / 3 / 35 | 53 / 3 / 35 |

Схема и миграции в этом gate не менялись.

## Рабочий Docker, backup и restore

Финальный image `crm-app:local`: `sha256:93c04c786bd60668f142385acca649c22c402428a7ded8199daa5ac88844a6c4`. На порту 8080 app/worker/search-worker/db healthy, `/api/health/ready` **200**. Последний build/up включает исправления фото и DEMO адаптера.

`node scripts/release-gate-ops.mjs` создаёт временный синтетический manager (затем деактивирует и отзывает сессии), проверяет страницы, загружает реальный DOCX-шаблон и формирует Document через штатные API. Затем запускает **Git Bash `scripts/backup.sh` и `scripts/restore-test.sh --keep`**. Пароли и cookie не записываются в доказательства. История синтетических контрольных документов сохраняется. `--keep` предотвращает удаление каталогов; тестовый Compose после проверки остановлен отдельно.

Первый успешный backup **2026-11-06_01-01-12**, T08 PASS за 32 с: документы/миниатюры 4 файла; 2 версии, 2 файла шаблонов, 2 generated Documents. [Первый T08](evidence-v31/T08-crm.txt).

Окончательный backup **2026-11-06_01-12-23**, на финальном рабочем образе, итог **01:13:05 UTC**, **34 с**: [T08 release](evidence-v31/T08-crm-release.txt). PASS: БД/файлы, миграции, readiness, вход, контрольный документ SHA256 + скачивание API, все **5 gallery files**, checksum **3 версий/3 файлов шаблонов**, **3 generated Documents**, контрольные строки. `temporary_profiles_excluded: PASS`; архивируется только storage, browser profiles живут вне него. После проверки `crm-restoretest down -v`, основной `crm` оставлен работающим.

## Чистое развёртывание

`D:\crm-clean-v31` уже существовал и не трогался. Выполнено:

```powershell
git clone --branch feature/tz-v3.1 --no-hardlinks D:/CRM-for-Real-Estate-Agencies D:/crm-clean-v31b
```

В новом клоне Git Bash `scripts/bootstrap.sh` создал отдельные случайные секреты. В локальном `.env`: `COMPOSE_PROJECT_NAME=crmclean31`, `APP_IMAGE_TAG=clean31`, `APP_PORT=18031`, `APP_BIND=127.0.0.1`, UID/GID 1000 для Linux-контейнеров Docker Desktop, AI/scraper false. Собраны образы, `docker compose -p crmclean31 ... up -d --wait` применил миграции и seed штатным сервисом `migrate`. Все четыре сервиса healthy.

Первый smoke **01:01:22 UTC**: вход с `mustChangePassword=true`, смена временного пароля, повторный вход с `false`; `/property-search`, `/calendar`, `/collections`, `/templates`, `/requests`, `/clients` — **200**. Поиск с выключенным scraper завершился **completed**, каждый источник **disabled**. [Фактический JSON](evidence-v31/clean-initial-smoke.json).

На неизменённом клоне backup **01-01-33** восстановил БД, файлы, вход и контрольные строки, но **template_files FAIL**: скрипта не было в runtime image. [Исходный T08](evidence-v31/T08-clean-initial.txt). Это реальный дефект исходного SHA.

В клон внесена **только одна COPY-строка Dockerfile**, как в рабочей копии; повторены build/up/backup/restore. Backup **2026-11-06_01-06-51**, итог **01:07:41 UTC**, **T08 PASS за 41 с**, 2 контрольных файла, 2 версии/2 файла шаблонов/2 generated Documents. Повторный вход — через временного синтетического manager; первоначальная смена пароля уже подтверждена первым smoke. [T08 после исправления](evidence-v31/T08-clean-fixed.txt).

Выполнены `docker compose -p crmclean31-restoretest ... down -v` и **`docker compose -p crmclean31 ... down -v`**, exit 0. Каталоги, `.env` и файлы backup остаются локально, не добавляются в Git. Клон проверяет исходный SHA + упаковочную правку; поздние исправления фото/DEMO проверены полным production E2E и финальным рабочим Docker build, но не новым чистым клоном окончательного commit.

## Исправления и границы выпуска

Код / packaging:

1. `Dockerfile`: добавить отсутствовавший `ops-verify-template-files.ts` в runtime image — подтверждено исходным FAIL и повторным T08 PASS.
2. `fixture-scraper.ts`: сохранять первый источник между поочерёдными вызовами очереди; partial DEMO больше не превращается в полный success. Добавлена PostgreSQL регрессия; итог 315 тестов.
3. `catalog-photo.tsx` + точечное подключение в `search-workspace.tsx`: вернуть разрешённое фото CRM в новую выдачу, через действующий авторизованный media API; production браузер подтверждает загрузку реального изображения.

Тестовая инфраструктура / актуализация:

- Playwright управляет настоящим search worker на строго изолированной `crm_e2e`, останавливая его вместе с production webServer.
- Новые четыре сценария `release-v31.spec.ts`; QA scripts миграций/эксплуатации.
- Старые селекторы заменены на текущие: radio-label, раскрытие фильтров планера, четыре режима включая квартал, полный день, типизированный select этажа, карточка `data-listing-id`, точный частичный статус/HTTP429, безопасный NotFound streaming + API404. Проверки реальных бизнес-записей/PDF/приватности сохранены.
- Unit точное русское ожидание `rub_total` приведено к действующей подписи «за объект» вместо «всего».

**Для закрытия AT-17:** координатор коммитит перечисленные изменения, фиксирует итоговый SHA и подтверждает чистый checkout/deploy этого SHA. Запрет агенту делать commit соблюдён. Host Node22 отмечен отдельно; Docker baseline Node24 проверен. AT-18/UAT и остальные LIVE ограничения имеют собственные протоколы, здесь не закрываются.


## Дополнение: финальный SHA 9adc8ff (06.11.2026)

После gate на `c812d18` изменены только экспорт поиска и запрос результатов (ускорение полного экспорта, коммит `9adc8ff`). На `9adc8ff` повторены: `tsc` и полный ESLint — PASS; unit **1364/1364**; PostgreSQL integration/authorization **328/328**; production `next build` — PASS; production Playwright **24 passed / 1 штатный opt-in skip**; Docker `app` пересобран, app/worker/search-worker/db healthy, `/api/health/ready` = 200. Чистое развёртывание и backup/restore подтверждены на `c812d18`; изменения `9adc8ff` не затрагивают миграции, Docker-конфигурацию и резервное копирование.

