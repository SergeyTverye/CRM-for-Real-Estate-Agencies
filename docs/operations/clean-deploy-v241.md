# Проверка чистого развёртывания v2.4.1

Дата: 05.11.2026. Время в протоколе — Europe/Moscow (UTC+03:00).

HTTP-времена взяты из проверочного скрипта; интервалы shell-команд округлены по времени начала/окончания вызовов. Это эксплуатационный протокол, не измерение производительности.

Проверяется отдельный `git clone --branch feature/tz-v2.4.1 --single-branch` локального репозитория в `D:\crm-clean-deploy`. Коммит клона: `d69a3fbc9642965732264f58dc2cc10be2d19cbf`. Незакоммиченные изменения общей рабочей копии в проверку не входят.

Изоляция: `COMPOSE_PROJECT_NAME=crmclean`, `APP_IMAGE_TAG=crmclean-d69a3fb`, `APP_BIND=127.0.0.1`, `APP_PORT=3480`; PostgreSQL без опубликованного порта; файлы и backup внутри клона. Restore-test использует отдельный проект `crmclean-restoretest` и порт 18480. Рабочие проекты `crm` и `crm-test`, их БД и тома не изменяются.

Среда: Windows, Docker Desktop Linux containers, Docker Compose v5.6.1, Git Bash `D:\runtimes\Git\bin\bash.exe`. Каталог клона до запуска отсутствовал. `.env` создан штатным bootstrap из `.env.example`, все пароли и идентификаторы сгенерированы заново. AI/web/scraper выключены, ключ Yandex пустой. `SEED_DEMO_DATA=true` включает только штатные синтетические данные. UID/GID установлены в 1000:1000 для Linux-контейнеров вместо Windows UID Git Bash. Секреты в протокол не включаются.

## Ход проверки

| Время | Шаг | Фактический результат |
|---|---|---|
| 15:27:03 | Инвентаризация | `crm-app-1`, `crm-worker-1`, `crm-db-1`, `crm-test-testdb-1` healthy; 3480 свободен. |
| ~15:27:25 | Чистый clone | PASS, ветка и SHA зафиксированы выше; `core.autocrlf=false` для shell-скриптов. |
| 15:27:31–15:27:37 | `bash scripts/bootstrap.sh` | PASS: каталоги, новые секреты, `docker compose config -q`. |
| 15:27:46–15:27:48 | Первая попытка deploy | Ошибка оператора: глобальный `MSYS_NO_PATHCONV=1` не преобразовал путь `.env` для Windows docker.exe. До сборки/запуска контейнеров; флаг снят. |
| 15:27:55–15:40:55 | `bash scripts/deploy.sh` | PASS, exit 0: оба образа собраны из clone; PostgreSQL создана с нуля; migrate и seed выполнены; app/worker запущены. Около 13 минут, включая сетевую загрузку зависимостей и экспорт образов. |
| 15:33:54–15:34:30 | Production Next build | PASS: компиляция, сбор данных страниц, production routes. TypeScript в Docker build пропускается конфигурацией, поэтому проверен отдельно ниже. |
| 15:40:35 | Миграции | PASS: `20261103120453_baseline_schema`, `20261105120000_v241_extensions`, `20261105210000_p2_ai_call_types`; применены к пустой БД. |
| 15:40:44 | Seed | PASS: 3 новых пользователя с временными паролями, 65 значений справочников, 2 юрлица, синтетические клиенты/объекты/потребности/сделка. |
| 15:40:56 | Healthchecks | PASS: app, worker, db — running/healthy. |
| 15:41:01 | `/api/health/ready` | PASS: HTTP 200, 222 мс. |
| 15:41:02–15:41:03 | Авторизация | PASS: login 200 с `mustChangePassword=true` → change-password 200 → login новым паролем 200. Новый пароль сохранён только в локальном `.env` для restore-test; seed существующие пароли не меняет. |
| 15:41:03–15:41:04 | Ключевые страницы | PASS: `/today` 200 (744 мс), `/property-search` 200 (498 мс), `/calendar` 200 (169 мс), `/offers` 200 (114 мс); итоговый URL проверен, редиректов на login нет. |
| 15:41:05–15:41:08 | Создание КП и серверный PDF | PASS: seed КП не создаёт; `POST /api/v1/offers` → 201, `GET /api/v1/offers/{id}/pdf` → 200 за 3163 мс, `application/pdf`, 45213 байт, сигнатура `%PDF-`. |
| 15:39:20–15:41:19 | Отдельные проверки исходников clone | PASS, exit 0: Prisma generate, `tsc --noEmit --incremental false`, ESLint `src/worker ops/worker scripts/container-smoke.mjs --max-warnings=0`, Vitest `tests/unit/notification-worker.test.ts` — 5/5. Изолированный disposable Docker container, без сети и без обращения к БД. |
| 15:41:17–15:41:22 | Файловая фикстура и container smoke | PASS: штатный `ops-gallery-fixture.ts` создал синтетический объект, JPEG, миниатюру и задачу; `container-smoke.mjs` подтвердил запуск Chromium, Node v24.22.2, Linux x64, sharp 0.35.5. |
| 15:41:28–15:41:38 | `scripts/backup.sh` | PASS, exit 0: backup `2026-11-05_12-41-33`, dump + files + manifest + checksums; встроенная verify успешна. |
| 15:41:44 | Проверка CLI verify без ID | Ожидаемый exit 1: ID обязателен; повторено с ID ниже. Это ошибка вызова проверяющего, не дефект продукта. |
| 15:41:55–15:42:01 | `scripts/backup-verify.sh 2026-11-05_12-41-33` | PASS, exit 0. |
| 15:42:01–15:43:13 | `RESTORE_TEST_PORT=18480 scripts/restore-test.sh 2026-11-05_12-41-33` | PASS, exit 0; собственный project `crmclean-restoretest`, отдельная БД и каталоги, app standby; фактический сценарий T08 занял 66 секунд, затем автоматический cleanup. |
| 15:43:23–15:43:35 | Первый restart smoke | Restart/readiness/login/КП и сравнение данных успешны; проверочный скрипт ошибочно запросил отсутствующий `GET /api/v1/documents` (404). ID контрольного документа получен из своей БД, проверка повторена. Исходники CRM не менялись. |
| 15:44:00–15:44:08 | `docker compose -p crmclean restart`, повторная проверка | PASS: readiness 200, прежний новый пароль работает (200, без требования смены), КП доступно (200), файл скачан (200) и SHA-256 совпал. Счётчики до/после: clients=5, client_needs=4, properties=5, commercial_offers=1, documents=1. Оба файла сохранены без изменения хешей. |
| 15:44:22 | Проверка изоляции | PASS: app/worker/db crmclean снова healthy. У всех 4 исходных контейнеров `crm`/`crm-test` сохранились ID и StartedAt, все healthy. Restore-test контейнеров и томов уже нет. |
| До 15:45:33 | `docker compose -p crmclean down -v` | PASS, exit 0: удалены app/worker/db, обе сети, `crmclean_postgres_data`. Уникальные теги `crm-app:crmclean-d69a3fb`, `crm-backup:crmclean-d69a3fb`, `crmclean-checks:d69a3fb` также удалены. Общий image/build cache не очищался. |
| 15:45:38 | Проверка очистки Docker | PASS: контейнеров с именем crmclean нет; томов и сетей обоих изолированных Compose-проектов нет. |
| 15:45:45–15:46:20 | Удаление каталога клона | BLOCKED: автоматическая проверка исполнения отклонила PowerShell `Remove-Item -LiteralPath 'D:\crm-clean-deploy' -Recurse -Force` с причиной `blocked by policy`, в том числе после проверки абсолютного пути и отсутствия reparse-point у корня. Обход запрета не выполнялся. |
| 15:46:25 | Финальная инвентаризация | Исходные 4 контейнера healthy с неизменными StartedAt. `D:\crm-clean-deploy` существует; серверов или контейнеров проверяющего нет. |

## Доказательства

КП: `ef3c4e6b-1d9e-48f6-b194-3d36665486bf`; SHA-256 PDF `079e8e5c344119e2d55d295ddbb8550e66aaf9766ccb465514d4d179c8afa50c`.

Backup manifest: SHA-256 `d43e003c9e6a1c088d2472990ff5cfc7086af063bfdca338555aef9bb28e6975`; PostgreSQL major 18; schema version `20261105210000_p2_ai_call_types`; app commit `d69a3fb`. `database.dump`: 241769 байт, SHA-256 `b3424696cdb0e584fe123fdab07882d35ba71da63151b9fb220e6eb088fde304`. `files.tar.zst`: 533 байта, 2 файла, SHA-256 `265b6478fd0130a8d06367c6b7f2f803f6608834dc29a4d8c9b4107b127ebc0d`.

Контрольный документ после restart: SHA-256 `c013d8f468b0a89835faba0cdec711edfbc8b6a1a5d0b14bef4b0bf9a09f4efc`.

Содержимое итогового штатного отчёта `T08-2026-11-05_12-41-33.txt` (до удаления клона):

```text
date: 2026-11-05T12:43:07Z
app_commit: d69a3fb
restore_db_files: PASS
migrations_compat: PASS
readiness: PASS
login: PASS (manager)
control_file_storage: PASS
control_file_api: PASS
gallery_files: PASS (2 files)
control_row_counts: PASS (сверены restore-data.sh)
duration_sec: 66
```

Сверка manifest охватывала 66 таблиц, включая задачи, уведомления, связи документов, поиск и AI. В копии 0 AI runs/usage/reservations. Это проверка чистого развёртывания и эксплуатации; полный Playwright, нагрузка, визуальная оценка PDF и живой Yandex AI в этот прогон не входят. Полные временные логи, HTTP-проверочные скрипты, PDF, backup и `.env` пока остаются в клоне из-за запрета удаления; существенные результаты сохранены здесь. Секреты в логи/протокол не выводились.

## Статус

Функциональная часть чистого развёртывания — **PASS**, включая T08 и сохранность после restart. Дефектов развёртывания не обнаружено; Dockerfile/compose/scripts/README не менялись. Агент изменил основной репозиторий только этим протоколом; параллельные изменения других исполнителей не затрагивались. npm install и изменения схемы/миграций не выполнялись.

Очистка Docker — **PASS**. Очистка каталога — **BLOCKED внешней политикой исполнения**. Поэтому весь запрос с обязательным удалением клона пока имеет статус **PARTIAL**, хотя чистая установка технически подтверждена. Оставшееся действие владельца машины:

```powershell
Remove-Item -LiteralPath 'D:\crm-clean-deploy' -Recurse -Force
```

Контур `crm` и тестовая БД не использовались в проверке и не перезапускались.
