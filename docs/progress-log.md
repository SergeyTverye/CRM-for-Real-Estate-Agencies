# Журнал прогресса v2.4.1

Ветка: feature/tz-v2.4.1 (от main ba7e6fa). Нормативные документы: ТЗ_CRM_итоговое_v2.4.1_проверено.md поверх tz.md v1.6.1.

## 2026-11-05
- Создана ветка, ключ Yandex AI перенесён в .env (YANDEX_CLOUD_API_KEY), файл ключа и Real-Estate-Scrapper/ исключены из Git.
- Скрапер 2.1.0 положен в vendor/real-estate-scrapper-2.1.0.tgz.
- APP_TIMEZONE в .env -> Asia/Novosibirsk.
- Исполнители: OpenCode openai/agy/google недоступны (Model unavailable), лимит OpenCode Go исчерпан; разработка — субагенты gpt-6.1-sol/gpt-6-luna, тест/ревью — OpenCode iceman-contributor-free, beam-free.
- Коммиты: схема v2.4.1 (622c0ae), AI-домен (4465579), UI-основа (db7e059), домен поиска/скрапер (4867e98), P0 безопасность (ffd27da, 69/69 PG-тестов).
- Живой Yandex AI: POST /v1/responses aliceai-llm-flash/latest = 200; разбор фильтров падал AI_INVALID_JSON_RESULT -> поручено агенту AI-персистентности.
- На промежуточном срезе были в работе: календарь+уведомления+worker, галерея, AI-персистентность и /settings/ai, приложение/UI поиска, P1-А контур.
- Слиты: календарь/уведомления (57dd8d2), галерея (646d0ad), поиск-приложение (14758d1, фиксы 66af487), AI-персистентность (a2f596f), P1-А (1c450ef), ops/Docker+restore (e8f7269), демо (c68f4fa), доки (47d75ce), e2e+скриншоты (cadade5).
- Проверки: unit 301/301, integration+authorization 152/152, e2e 10/10, eslint/tsc/build PASS, restore-test PASS.
- Независимые ревью OpenCode: домен поиска (3 находки, исправлены), безопасность (находок нет), подборки (6 находок, исправлены).
- На промежуточном срезе были в работе: полировка UI + пересъёмка, замеры 3 пользователей/NFR-14, живой smoke скрапера.

- Финал: независимая проверка (OpenCode beam) на 8d30d92 — unit 500/500, integration+authorization 163/163, E2E 13/13, tsc/eslint/build/Docker PASS. Живой срез скрапера: Яндекс/OnRealt/Юла success, Авито/Домклик blocked, Циан parse_failed, Мир Квартир fetch_failed. Нагрузка 3 пользователей — локально, p95 <= 259 мс. Документация и карточки приёмки обновлены.

## 2026-11-05 — этап 2 (живой AI, UI/UX, скриншоты)
- Модели: openai/* в OpenCode недоступны, Go-лимит исчерпан -> разработка субагентами gpt-6.1-sol; тест/ревью OpenCode iceman/beam.
- На старте этапа запущены: live-испытания AI (бюджет сессии 250 руб.), КП A4+DOCX+PDF, UX поиска, календарь/сегодня/уведомления/клиент, отчёты/настройки ИИ/мобильный/prompt.

- Этап 2 реализован коммитами `91c6fc4`–`e48ea2a`: КП A4/PDF/DOCX, UX поиска, календаря/Сегодня/уведомлений/клиента, отчётов/ИИ/mobile, P2 call_note/offer_text. LIVE: частичный сбор, повтор/пустой результат/тайм-аут/restart PASS; web без карточек PARTIAL, Циан CAPTCHA и Авито/Домклик BLOCKED.
- Независимые Iceman/Beam находки исправлены `9e2b71b` / `f15adc8`. [QA](acceptance/qa-stage2.md) фиксирует dev E2E и ограничения production build (EPERM/Deny ACL); старые числа выше относятся к своим промежуточным версиям. Итоговый пересчёт — только [test-protocol](vkr/test-protocol.md).
- [Чистый deploy d69a3fb](operations/clean-deploy-v241.md): build/migrate/seed/login/PDF/T08/restart PASS; Docker очищен, удаление каталога клона blocked by policy. Поздний HEAD этим прогоном не проверен.
- Документация этапа 2: [приёмка](acceptance/stage2-live-ai-ux.md), user-guide, API, трассировка, README и IMPLEMENTATION_REPORT обновлены; NFR-14 локально, реальный Excel и UAT остаются PARTIAL.

- Этап 2 завершён (05.11.2026): живые испытания Yandex AI (10 подборов, 5 web_search, 12 прочих AI-вызовов этапа поиска + 4 P2 + 4 parse для пересъёмки; ~6,27 руб. по журналу CRM), UI/UX P1, P2 (заметка после звонка, тексты КП), исправления по Iceman/Beam, правило жилого назначения. Итог: unit 1003/1003, integration+authorization 197/197, E2E 16/16 (production), Docker и чистое развёртывание PASS.

## 2026-11-05 — ТЗ v3.1 (ветка feature/tz-v3.1 от 6bbdb7b)
- Модели: openai/* в OpenCode недоступны, Go-лимит исчерпан -> разработка субагентами gpt-6.1-sol; тест/ревью OpenCode iceman/beam.
- Волна 1: схема v3.1 (одна миграция), аудит 7 адаптеров, CAPTCHA human-in-the-loop.
- v3.1 закоммичено: схема (8f3cdf8), адаптеры (be4ca15), CAPTCHA HITL (201f5ce), планер (8056695), звонки/таймлайн (44c837f), подборки (318c0d6), дубли (1ee7767), сервер поиска (c5d70cb), AI-чат (66214c9), шаблоны (97ee958), AI-анализ (4971e60), фиксы (c9fb7f2), UI поиска (73bb0c3).
- Эталон качества: ложные включения 21->12, дубли 0/3->3/3. Ревью Beam P1/адаптеры и тест Iceman P0-B/C — без блокеров, находки исправлены.
- В работе: живые испытания поиска, регрессия/backup/чистое развёртывание, DEMO-скриншоты.

## 2026-11-06 — CAPTCHA HITL production-интеграция (SR-06)
- Подключён ProductionInteractiveSearchAdapter: URL из filters/depthParams задания, тот же page/context, штатный parser, сохранение в исходный SearchRun; повторная блокировка сохраняет прочитанные карточки и даёт ручной путь.
- SearchRun cancellation закрывает сессии; progress показывает связь source/session; viewer возвращается в тот же поиск. Исправлен небезопасный native HTTP redirect браузера; добавлена регрессия.
- Docker app/search-worker: chromium-sandbox + официальный seccomp, non-root, 2 GiB/pids 256/shm 256 MiB, ephemeral tmpfs /tmp; общий PostgreSQL лимит активных сессий. По умолчанию разрешённые для продолжения источники пусты (BROWSER_SESSION_ALLOWED_SOURCES).
- Проверки: tsc/lint/Compose/build PASS, unit 493/493, integration 26/26 (стандартный 30 с; также PASS с 90 с после первоначального timeout экспорта под build-нагрузкой), browser 6/6, финальный Docker image без mount src — 6/6. Доказательства: docs/integrations/captcha-hitl-production.json, AT-05/06 PASS на DEMO-стенде; AT-17/18 не подменяются этим прогоном.
- Новых отдельных LIVE smoke, npm-зависимостей, изменений схемы/миграций и Git commit/checkout/stash/reset/switch не было. Временные HITL-контейнеры завершены; production/demo DB не изменялись. Чужие параллельные изменения сохранены.

- LIVE-поиск v3.1: 8 запусков UI на crm_demo:3415, 0 web_search, 4 AI HTTP-вызова/0.345700 ₽. Реальные OnRealt/Яндекс + blocked Циан403/Авито439/Домклик401; CAPTCHA REPLAY-стенд PASS. 20 новых размеченных URL, метрики 8→2 false inclusion/1→0 exclusion, старый эталон 21→9 false inclusion. Исправлены basement conflict/небоскрёб/explicit operation с регрессиями; unit 457/457, integration 49/49, tsc/lint PASS. Подборка→need→экспорт→КП локально PASS; XLSX визуально PARTIAL. Бюджет и сессии восстановлены/отозваны, процессы остановлены. Полный протокол docs/vkr/live-search-v31.md; Git commit/migration/install не выполнялись.

- Уточнение приёмки отмены: первичная LIVE-запись cancelRequested=false, поэтому LIVE PARTIAL. Дополнительный controlled REPLAY queued-run при остановленном worker подтвердил cancelRequested=true/source cancelled, без новых запросов к площадкам. Финальный снимок помечен REPLAY. Свой повторный сервер 3415 остановлен, tsconfig include удалены, активных временных сессий нет.

## 2026-11-06 — окончательный release gate v3.1, c812d18
- HEAD c812d18c0e835e25598e432036da9284bd9c306d, ветка feature/tz-v3.1, перед прогоном status чистый. Prisma/tsc/полный ESLint/build PASS; unit 1363/1363 (62 файла), PG integration/authorization 326/326 (52 файла), production E2E 24 PASS + 1 opt-in REPLAY skip.
- Рабочий crm и новый неизменённый D:\crm-clean-v31-final / crmclean31f: build/up/migrate/seed, четыре healthy, readiness 200. В чистом — смена временного пароля, семь страниц 200, scraper disabled завершает поиск; restart сохраняет строки и файлы.
- Git Bash backup/restore-test: рабочий T08 PASS 39 с, чистый PASS 34 с, включая вход, API/checksum контрольного файла, строки и шаблоны. Три изолированных проекта down -v; каталоги сохранены, основной crm работает.
- AT-17 PASS; сводная AT-таблица актуализирована по карточкам. AT-02/04 разделены на PASS реализации/тестов и внешние BLOCKED/unknown с запасным путём; AT-18 ожидает людей. Полнота LIVE и готовность всего MVP не объявляются.
- Новых дефектов, правок кода/схемы/lockfile/install, git commit/checkout/stash/reset/switch нет. Автоinclude Next в tsconfig убраны; .next/ACL не менялись. Платных AI/source-запросов 0; host Node22 отмечен, Docker Node24 проверен. Доказательства: docs/operations/release-gate-v31.md и evidence-v31-final/.

## 2026-11-06 — v3.2.1 desktop (ветка feature/desktop-v3.2 от 227124f)
- Конфиденциальный Excel: ни одна модель не читает содержимое; только доверенные локальные скрипты с обезличенным выводом.
- Решения: EXE собирается в GitHub Actions (локально нет Rust/MSVC); чистые VM недоступны (решение пользователя) — проверка на этом ПК и на чистых раннерах GitHub Actions, VM-проверки DT-01/02 BLOCKED.
- Облака: пользователь заполнит D:\crm-secrets\clouds.env.
- Волна 1: аудит+прототип SQLite, защита конфиденциальных данных, формат backup и облачные адаптеры, профилировщик Excel.

## 2026-11-06 — SQLite backend, этап 1
- Добавлены воспроизводимая SQLite-схема (84 модели), отдельный Prisma client/migrate, ADR 0010 и полный аудит PG-конструкций; PG schema/migrations не менялись.
- Явный CRM_DEPLOYMENT_MODE, scaled INTEGER вместо неточного native Decimal, Unicode LIKE/equality, очередь + BEGIN IMMEDIATE, PRAGMA и dialect SQL; неперенесённая выдача поиска fail closed.
- Синтетический core-путь, RBAC/StorageAdapter/планер 1500 задач, конкурентный AI-бюджет и stock Decimal probe проходят; clean/repeat Prisma Migrate PASS. PG integration/authorization финально 332/332, npm test 1418/1418, SQLite 11/11 (10 core + 1 параллельный settings); tsc/ESLint/production build PASS. Протокол — docs/desktop/sqlite-core-prototype.md.
- DT-05/17 остаются PARTIAL, DT-06 transfer — следующий этап. Tauri и коммерческие материалы не исследовались; коммиты выполняет координатор.

## 2026-11-06 — SQLite backend, этап 2

- Перенесены search result SQL/revision/sorts/export, JSON/list/skipDuplicates/batch/точная Decimal арифметика; сохранены PG-контракты и независимые paid AI caches. Все существующие integration/authorization запускаются в integration-sqlite с отдельными временными файлами и SQLite migration global setup.
- PG→SQLite всех 84 моделей, read-only snapshot, исходные IDs/FK, финансовые суммы, storage/checksum, шаблоны/AI/search; rollback нового target и preflight. Первый запуск empty/demo/собственный пароль/случайные секреты, offline Prisma-compatible migration history и защитный upgrade snapshot.
- Gate: SQLite 360/360 (62 файла), PG crm_test_a 342/342 (57), npm test 1438/1438 (69), transfer 2/2, реальный Next HTTP readiness/login/clients/file/page/Origin PASS; tsc и targeted ESLint PASS. Протокол: docs/desktop/sqlite-stage2.md.
- PG schema/migrations и секреты не изменялись; коммерческая книга/производные не открывались; dependency install/git commit не выполнялись. Next 3511 остановлен, auto-includes убраны. Packaged Node24/Windows installer/restore отдельного исполнителя не подтверждаются backend-прогоном.

## 2026-11-06 — проверочный контур Excel DT-22/23 (синтетика)
- Добавлены private-import/verify-workbook.ts и compare-workbook.ts: изолированная crm_private_verify/SQLite, миграции, роли, dry-run, fault rollback/retry, commit/repeat/export/reimport, сравнение структуры/ключей/дат/денег, RBAC, SHA и cleanup; наружу только числовые агрегаты/координаты/фиксированные коды.
- Исправлено сопоставление даты/участника/контактов исторического архива при экспорте. PG schema/migrations, зависимости и Git-ветки не менялись; реальная книга/производные не открывались.
- Финально SQLite 12/12, PostgreSQL 12/12, unit 6/6, targeted ESLint PASS; временный каталог пуст. Общий tsc FAIL: две TS2322 в параллельном settings/backups/backup-panel.tsx:111; свою зону ошибок не выдаёт. Реальные DT-22/23 остаются координатору. Протокол: docs/import/private-verifier-verification.md.
## 2026-11-06 — интеграция v3.2.1 и продолжение release gate
- Отправлены fb9a792 (manager-only backup UI/API, очередь/расписание/worker, supervisor/native dialogs, обязательные runtime entries) и ba8d271 (определение структуры Excel без ordinal guesses, проверка eligible rows, raw contacts roundtrip, offline mapping review). Локальный guard CG_PASS; main/source branch не менялись.
- Проверки: общий tsc и lint PASS; unit/browser-cycle 1467/1467. Первые полные DB-прогоны нашли один одинаковый дефект CLI roundtrip (PG355 PASS+1 FAIL, SQLite374 PASS+1 FAIL+1 SKIP); исправлен raw contact export, targeted PG/SQLite 14/14, полный повтор делегирован QA. Backup E2E3/3 server и3/3 desktop, esbuild8/8, supervisor restart/shutdown PASS.
- LIVE подключение двух облаков через UI отдельной синтетической SQLite CRM:2/2 read probes PASS; расширенный module transfer/restore пока FAIL без успешного verdict, добавлена безопасная диагностика. ФизическийUSB E: backup/readback/restore PASS на7MiB syntheticfile; unplug толькоinjectedIO, installedUI отдельно.
- Созданы27 DT-карточек с честнымиPARTIAL/BLOCKED. РеальныйExceldry-run выявилmappingнеоднозначности; локальнаяofflineформаготова, ожидаетсяподтвержденныйпрофильвладельца (ТЗ12.1), данныеагентамнепередаются. Исходникнеизменен. ЛокальнаяслужебнаяCodextree-ссылкаскнигойудаленаобратимо; reachablehistoryповтор:0запрещённыхпутей/0точнойкниги.
- РеальныеStealthscreenshots(backups/schedule/clients, DEMO)сохранены. CI42273923333наfb9a792 выполняетNode24desktopgate; ba8d271ожидаеточередь. DockerproductionbuildNode24запущен. EXE/lifecycle/полнаяготовностьнеподтверждены.

## 2026-11-06 — документация v3.2.1 по подтверждениям координатора, срез 11a2778

- Только документация: обновлены README/DT-01–27, добавлены ограниченные протоколы cloud-module-live и excel-local-verification, уточнён backup-settings UI/API и дополнена трассировка. Исторические записи выше не переписывались. Закрытые файлы не читались, Git-команды/сборки/тесты не выполнялись.
- Реальный локальный verifier PG+SQLite: на каждом все 24 boolean checks=1, errors={}; 359 recognized =122 imported (8/14/4/90/6)+128 hidden excluded+106 rejected+3 probable duplicates; unresolved0. Rollback/idempotent commit/retry/reimport zero/RBAC/source SHA unchanged/cleanup PASS. Профиль исправлен координатором после разрешённого исследования структуры, не опубликован. Неоднозначные rejected и контрольная таблица unsupported оставляют DT-22/23 PARTIAL.
- Excel preservation: 0 mismatches для122 row keys/186 key fields/32 money/90 contacts/90 dates, геометрии6 листов/4640 numformats/90 headers/names/sections/order. Compatibility:41 UNSUPPORTED_COLUMN/32 HYPERLINK_CLEARED/90 UNSUPPORTED_FIELD/15 images; FORMULA_CLEARED0 при отсутствии формул не доказывает их сохранение.
- Новый cloud module-transfer-restore PASS: архив7354253 байта,2 облака/2 restore с контролем БД+SHA файла, S3parts2/Mailruchunks8,2 fault injections/queue reload/failed-only retry/anonymous GET+LIST403/cleanup. Не физический network disconnect и не IAM minimum-permission proof. UI probes2/2 отдельно; manager-only server+desktop UI реализован, realtor API/page403. Installed full restore не подтверждён. USB E:/Disk2 USB module PASS; unplug только injected, installed picker не проверен.
- Server production ограниченный PASS:3 concurrent sessions, настоящий pg_dump/files/verify/второй project pg_restore/3 fresh login/control rows/file SHA. Exact image и Node24.22.2 — в неизменённом server-production.md; dirty provenance не равна clean11a2778 build.
- В11a2778 native file restore/WebDAV retry/Excel precision+geometry; supervisor Rust notice/NATIVE_IMPORT dispatch интегрирован; exit listener fix local smoke PASS. Переданы targeted native30/parser64+5optional skip/export14 на каждой БД/WebDAV25+2MinIO skip; global tsc/lint PASS. Старые PG356/SQLite375+1skip/unit1467 не выдаются за новый финальный QA, он продолжается.
- CI04c2 упал на test-event race, новый11a2778 run ожидается; EXE ещё нет. Clean Win10/11 VM BLOCKED по решению пользователя, текущий ПК и планируемые Actions Windows Server не заменяют их. Три скриншота остаются DEMO. Полная готовность выпуска не объявляется.

## 2026-11-07 — актуализация публичных приёмочных сведений v3.2.1 без повторных проверок

- Только README и DT-05/17/18/21/27 в desktop-v32, актуальный раздел v3.2.1 трассировки и эта запись. Другие DT и исходные отчёты не изменялись. Git/build/test не запускались; закрытые данные, env, приложения/логи и customer files не читались. Исторические сведения выше сохранены; export «14 на каждой БД» в прежней записи следует читать как **14 всего: 7 PG + 7 SQLite**.
- Опубликован b4a9e27; подтверждение координатора: Windows CI 7e7e47e/run 42293184755 прошёл unit/SQLite/desktop bundle-artifact guard, NSIS ещё компилируется, EXE/checksum нет. Следующий b4a9e27 run queued, не PASS. Native cap=4/shared lock опубликованы; dead-PID recovery (отдельный набор 44 теста) и autocleanup ещё реализуются, не закоммичены, готовность не заявлена.
- [QA](acceptance/desktop-v32/regression-final.md): unit/browser 1514 PASS/5 skip; исходно PG 362 PASS/1 harness FAIL, SQLite 384 PASS/1 такой же harness FAIL/1 skip. Прямой повтор координатора PG+SQLite 4/4 PASS за 33.32 s снял оба отказа; покрытие PG 363/363 и SQLite 385 PASS/1 skip — full-run плюс repeat, не новый чистый full-run. Desktop backup 46 PASS/2 MinIO skip, cloud synthetic 10 PASS, USB synthetic 4 PASS, UI 3 server+3 desktop PASS.
- Актуальный [server clean-image gate](acceptance/desktop-v32/server-production.md) PASS и [SQLite production](acceptance/desktop-v32/sqlite-production.md) 22 PASS/0 FAIL, оба с actual restore: APP_COMMIT 11a27784bdead108483ca058bfa72179597fb8fe, image sha256:965356828d986cddf1f61ffd175e4629b124b0f4e31d9dad2502cbadd2e60d8e. Прежний dirty-image gate — исторический, не последний. QA host Node22.23.4, production Node24.22.2, Windows CI Node24.15.0 различаются.
- [Security review](acceptance/desktop-v32/security-review.md): подтверждённых P0/P1 в проверенной области нет; фактического Windows lifecycle evidence всё ещё нет. Формул в локальном Excel0 — не доказательство preservation. Полные PG/SQLite production DT PARTIAL; чистые Win10/11 VM BLOCKED по решению пользователя. Полный release PASS не объявлялся.

## 2026-11-07 — объединение main и исправления установленного EXE

- По прямому указанию пользователя main последовательно fast-forward объединяет feature/tz-v2.4.1, feature/tz-v3.1 и feature/desktop-v3.2; main496c8a2 отправлен на GitHub, истории сохранены. EXE7e7e47e и контрольная сумма скачаны в ignored releases/windows-x64; повторный ZIP удалён после сверки SHA. Это ещё не готовый выпуск.
- Установщик7e7e47e завершился exit0 на текущем ПК. Отдельный синтетический installed smoke прошёл client/file -> encrypted backup -> verify -> change -> restore -> restart -> rollback/file SHA, protective backup присутствует. Обычное GUI окно отсутствует: воспроизведён Node EISDIR при verbatim-пути Tauri; smoke использовал другой источник пути. Исходное исправление нормализует resource path и добавляет фиксированные native stage codes, не меняя права/изоляцию. Проверка HWND и API в CI остаётся обязательной; Rust и новое окно пока не проверены.
- Найдено ошибочное копирование полного Next standalone trace, включая ТЗ/AGENTS/docs/tests/source. OpenCode заменил его явной политикой runtime-ресурсов и итоговым guard; npm/Node/Chromium legal notices сохранены. Переносимые временные пути исправлены координатором; focused resource-policy5/5, ESLint и bundled-Node syntax reproduction3/3 PASS. Все8 runtime entries компилируются без внешних TS dependencies. Сборка EXE и установленная проверка новых ресурсов ожидаются.
- Очистка делегирована отдельно: ранее удалены159 root log/build-info файлов (2883953bytes); большие каталоги проверяются с сохранением data/backups/private-data/секретов/зависимостей. Независимое OpenCode/Beam ревью исправлений выполняется. Полная приёмка не объявляется.

## 2026-11-07 — Windows build и безопасный обратный перенос

- main70ef19d: нормализация verbatim Windows resource path и явная runtime packaging policy. CI42311329545 unit/SQLite PASS, остановка на TS-декларациях нового теста. main277f5a8 добавляет d.mts/проверку outputFiles; локальные полный tsc/lint/7focused PASS. CI42312434310 unit/SQLite/desktop bundle и final resource guard PASS, pinned Node path regression3/3 PASS; Rust --locked обнаружил отсутствие Cargo.lock. Взята exact lock-копия из успешного публичного артефакта7e7e47e; Cargo.toml blobs HEAD/7e совпадают. Компиляция/Rust tests и новое GUI по-прежнему ожидаются.
- Installed7e smoke/API handoff: свежие A/B/C, A->B real encrypted transfer, checksum/file/identity preservation, B successor give, standby PATCH503 и diverged C conflict/reject/preservation PASS. Возврат B->A BLOCKED503; общий verdict BLOCKED. Изолированные источники сохранены, реальные профили не читались. Safe evidence data/qa-v32-handoff-4f1c305f-80b8-4472-978f-0b45c20885c9/safe-report.json, measured launcher SHA45f8b7be3038919e679a93cad97b1b4a4b0018001d0005feb1905076ecf2c977.
- OpenCode исправил узкий manager receive на supervised standby: остальные13 команд остаются запрещены. Независимый Beam обнаружил receive rollback для same/local_changed; это подтверждено4 падающими тестами и исправлено no-op с сохранением readOnly/DB/files/state/identity. Второе предположение ревью про запрет чужого deployment на genuinely empty первой установке отклонено: bootstrap должен принять deployment источника, сохраняя local instance/device identity; теперь это отдельный PASS test.
- После интеграции: tsc/lint PASS, 66/66 targeted tests (13 runtime synthetic SQLite/archive,30 HTTP/application guard и существующие native/resource cases). Temp paths portable os.tmpdir. Ни эти проверки, ни old smoke не являются подтверждением нового installed GUI/Windows lifecycle.
- Очистка фактически освободила2824100480bytes/4887files за подтверждённые проходы; оставшиеся каталоги проверяются, это не итоговый полный результат. Бесплатный Iceman по public synthetic Excel подтвердил три оставшихся gap: formula preservation, enterprise v2 control/agreement table, закрытый allowlist hyperlink columns. DT22/23 остаются PARTIAL, реальные данные модели не передавались.

## 2026-11-07 — чистая установка41c39b8, final-runtime gate и очистка

- По сообщению пользователя предыдущая установка удалена. CI42313787406: build/Rust tests PASS, оба installer jobs FAIL до readiness (SMOKE_EXIT_BEFORE_READY). Артефакт13550879559 скачан, ZIP SHA e063c44cbf4b9235f7b48d556c187b74e3da78ecef7ad35d94d4e1fe846bfff5; EXE585583866bytes SHA b56ec7501a9b9ebc9328f9e1dfc03cf452b8e10611bae0675bb4eb6f4262126b. Чистая установка на текущем ПК exit0; root внутренних материалов0. Installed launcher SHA1553873c574f6fe60141c0a26c19f08b0ccab18154c134b42a1056cbe4a00653. Обычный UI не объявлен PASS.
- OpenCode воспроизвёл missing @prisma/client-2c3a283f134fdcb6/runtime/client в изолированном installed профиле. Добавлены dist/node_modules aliases, узкая материализация exact in-trace пакетов и реальный final-resource preflight (bundled Node/init/Prisma/setup/assets) до Rust/NSIS. Координатор добавил сохранение compiled API paths data/backups, строгие npm names/realpath containment, no-copy out-of-trace и protected API probes401. Сборочный package-lock удаляется после SBOM; исходники/ТЗ остаются запрещены. Независимый Iceman дал RED на compiled route и invalid scope; после интеграции tsc/lint и13 targeted tests PASS. Это synthetic unit/preflight tests, не свежий настоящий installer PASS.
- Полная очистка:29775files/8415120587bytes logical length,31 directories удалён полностью,7 защищённых остатков сохранены, tsconfig.tsbuildinfo TREE_CHANGED оставлен. Generic script больше не пишет вне workspace и не подменяет dry-run исторический отчёт, считает только текущий проход, проверяетignored files и корректно обрабатывает пустые trees. Реальный Windows PowerShell dry-run8candidates/1cachefile/0refusals/0deletions; SHA отчёта неизменён. Все подтверждённые дубликаты новогоZIP/EXE удалены; одна новая версия в releases/windows-x64.
- Опциональная попытка остановить медленный standalone cleanup отклонена automatic approval review из-за риска затронуть параллельные OpenCode helper-процессы. Обход не выполнялся; процесс самостоятельно завершил очистку. Новый CI кеширует только Cargo registry/git и compiled release subdirs, без NSIS/user profiles, с pinned official actions/cache v5 SHA; installer jobs по-прежнему без checkout/Node/build cache.
