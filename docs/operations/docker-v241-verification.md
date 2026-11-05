# Docker / эксплуатация v2.4.1 — фактическая проверка

Дата: 05.11.2026. Среда: Windows, Docker Desktop Engine 29.9.2, Compose v5.6.1,
Git Bash `D:/runtimes/Git/bin/bash.exe`. Рабочий project `crm` сохранён.
Исходный HEAD `1c450ef`, проверяется общая рабочая копия с незакоммиченными параллельными изменениями.
Схема и миграции вручную не менялись; generate выполнялся только существующим этапом Docker build,
deploy миграций — только контейнером migrate.

| Проверка | Результат / свидетельство |
|---|---|
| Защитная копия перед обновлением | `2026-11-05_01-17-08`, создана без удаления исходных данных |
| `docker compose -p crm build` | PASS, образы app/migrate/worker собраны; отдельный ops backup image собран |
| `docker compose -p crm up -d` | PASS, migrate exit 0; app, db, worker healthy |
| Схема рабочей БД | `20261105120000_v241_extensions`, readiness сообщает 2 миграции |
| `/api/health/ready` | `status=ok`, database/fileStorage ok, active |
| `node -e "import('./scripts/container-smoke.mjs')"` в app | PASS: `create({browser:true})`, headless Chromium запускается и закрывается, без навигации к площадкам |
| Linux sharp | PASS: Node v24.22.2/linux/x64, sharp 0.35.5, WebP 44 байта |
| Worker / restart | До рестарта 2 notifications; после рестарта 2; `count(*) - count(DISTINCT dedup_key)=0` |
| Логи worker | JSON `notifications.worker_started`, `notifications.delivered` count=2; без текста задач и секретов |
| Backup новой схемы | `2026-11-05_01-27-26`, 66 контрольных счётчиков, 2 файла: фото и миниатюра |
| `verify.sh 2026-11-05_01-27-26` | PASS: checksums, manifest, pg_restore list, zstd test |
| Restore-test через Git Bash | PASS, первый полный прогон 30 секунд; повтор с окончательным host-скриптом 39 секунд, отдельный project `crm-restoretest`, после теста удалён |
| Restore: БД / файлы / миграции / readiness | PASS |
| Restore: вход / контрольный файл в storage / скачивание через API | PASS |
| Restore: галерея / контрольные счётчики | PASS, 2 файла; индивидуальные SHA-256 проверены |
| Scoped ESLint | PASS: env.ts, ops/worker/*.mjs, container-smoke и два ops fixture helper |
| `npx tsc --noEmit` | PASS, окончательный прогон exit 0 (`ops-typecheck-last.log`) |
| Vitest | PASS: property-media.test.ts и property-media-storage.test.ts, 10/10 |

Машинные отчёты T08: `backups/restore-test-reports/T08-2026-11-05_01-27-26.txt`,
`backups/restore-test-reports/T08-2026-11-05_01-32-07.txt`.
Окончательный образ: `crm-app:local`,
`sha256:5d9399829bdee731b4e03c55aee7710499e2fd56a45a0f7128d44a9530d981a9`.
После его запуска повторно проверены readiness, healthy всех трёх сервисов,
2 уведомления без дублей и сохранность контрольного документа.
ENV wrapper проверен положительным smoke и отрицательным тестом
`SCRAPER_CHROME_PATH=/bin/false`: получен ожидаемый отказ запуска, рабочая ENV не менялась.
Локальные журналы сборки/команд: `ops-build-*.log`, `ops-restore-test-*.log`, `ops-tests.log`,
`ops-lint-*.log`, `ops-typecheck-*.log` (исключены из Git и build context).

Для проверки создан помеченный синтетический объект, одна фотография с миниатюрой и одна задача.
Они остаются в dev-стеке как контрольные данные; исходные записи не удалялись.
Первоначальный пароль manager из `.env` уже не подходил (401). Вместо сброса рабочего пароля
создан одноразовый синтетический пользователь с криптографически случайным паролем через ENV;
его копия проверена после восстановления. Из рабочего стека тестовый логин удалён,
контрольный запрос вернул 0 таких пользователей. Пароль не сохранялся в документах/логах.

Устранённые ошибки: tgz не копировался перед npm ci; playwright-core исчезал после prune;
CRLF ломал shebang в образе; worker не запускался эксплуатационными скриптами;
необязательный отсутствующий ENV обрывал lib.sh; прежний manifest не покрывал новые таблицы;
tar пытался изменить метаданные корня Windows bind mount.

В промежуточных прогонах общий tsc падал из-за параллельно меняющихся
`scripts/demo/seed-demo.ts`, затем синтаксиса `scripts/demo/demo.test.ts:72,117`.
Эти файлы другим агентам не исправлялись. После их изменений окончательный tsc прошёл.
Docker build штатно использует `CRM_DOCKER_BUILD=1` с отдельной проверкой типов;
PASS tsc подтверждён отдельной командой, а не фактом сборки.
Ограничения:
Живой сбор площадок, платные AI-вызовы, чистая установка, нагрузка трёх пользователей,
полная sandbox/egress-изоляция браузера этим прогоном не проверялись.
