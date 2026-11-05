# Инструкция администратора (руководителя)

Описание эксплуатационных операций CRM. Технические команды выполняются на сервере из каталога проекта;
на сервере нужны только Docker Engine и Docker Compose plugin.

## 1. Установка на чистый сервер

```bash
git clone https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies.git /opt/crm && cd /opt/crm
./scripts/bootstrap.sh     # каталоги, .env с новыми секретами (права 600)
./scripts/deploy.sh        # сборка, PostgreSQL, миграции, seed, запуск
```

Адрес выводится в конце (`http://<сервер>:8080`). Первичные пароли учётных записей `manager`, `realtor1`,
`realtor2` — в `.env` (`SEED_*_PASSWORD`); при первом входе система требует сменить пароль.
Параметры (порт, часовой пояс, лимиты файлов, интервалы контроля) меняются только в `.env`, затем `./scripts/deploy.sh`.

Демонстрационные данные для обучения: `SEED_DEMO_DATA=true` в `.env` до первого `deploy.sh` (синтетические записи с пометкой «[демо]»).

## 2. Пользователи и права

Раздел **Администрирование → Пользователи** (только руководитель):
- **Создать** — логин, имя, роль; система показывает временный пароль один раз, сотрудник меняет его при первом входе.
- **Сбросить пароль** — новый временный пароль, все сессии пользователя завершаются.
- **Деактивировать** — пользователь не может войти, его активные сессии отзываются; история и ссылки сохраняются.
  Последнего активного руководителя деактивировать или понизить нельзя.
- Все изменения ролей и статусов фиксируются в **Администрирование → Журнал аудита**.

**Контакты собственников чужих объектов** выдаются в карточке объекта → «Собственники» → «Выдать доступ риелтору»;
отзыв действует немедленно. **Юрлица ИП/ООО** — Администрирование → Юрлица.
**Справочники** (каналы, источники, площадки, типы объектов) — Администрирование → Справочники; используемое
значение не удаляется, его можно деактивировать.

## 3. Резервное копирование и восстановление

| Задача | Команда |
|---|---|
| Ручная копия | `./scripts/backup.sh` (или «Создать backup сейчас» в разделе «Эксплуатация») |
| Ежедневная копия | cron: `30 20 * * 1-6 cd /opt/crm && ./scripts/backup.sh --trigger scheduled --targets all >> backups/backup.log 2>&1` |
| Проверка копии | `./scripts/backup-verify.sh <backup_id>` (или «Проверить копию» в UI) |
| Список копий | `./scripts/backup-list.sh` |
| Тест восстановления (T08) | `RESTORE_TEST_PASSWORD=<пароль руководителя> ./scripts/restore-test.sh [<backup_id>]` |
| Восстановление рабочей среды | `./scripts/restore.sh <backup_id>` — запросит ввод идентификатора копии и сначала сделает защитный snapshot |

Копия = `backups/<YYYY-MM-DD_HH-mm-ss>/` с `database.dump`, `files.tar.zst`, `manifest.json`, `checksums.sha256`.
Хранится `BACKUP_RETENTION_DAILY` (по умолчанию 14) обычных копий; копии перед обновлением/восстановлением не удаляются автоматически.
Каталог `backups/` рекомендуется дополнительно копировать на другой носитель или NAS.
**Наличие файла копии не доказывает её пригодность** — регулярно запускайте `restore-test.sh` (раздел «Эксплуатация» показывает отчёты T08).

### Off-site копии (расширение, ТЗ 39)

```bash
./scripts/backup-remote-add.sh nas-main filesystem          # каталог BACKUP_FILESYSTEM_TARGET_PATH (NAS)
YC_ACCESS_KEY_ID=… YC_SECRET_ACCESS_KEY=… YC_BUCKET=… ./scripts/backup-remote-add.sh yandex-main yandex
MAILRU_USER=… MAILRU_APP_PASSWORD=… ./scripts/backup-remote-add.sh mailru-main mailru
./scripts/backup-remote-probe.sh nas-main                    # list/write/read/delete через шифрование
```

Затем `BACKUP_TARGETS=nas-main,yandex-main` в `.env`. Каждый backup шифруется на сервере (rclone crypt: содержимое и имена)
и реплицируется во все targets независимо; ошибка одного target не влияет на остальные. Повтор только ошибочных:
`./scripts/backup-retry.sh <backup_id>`. Восстановление из облака: `./scripts/restore.sh --source yandex-main --backup <id>`.
Файлы `secrets/recovery/<code>.txt` (crypt-пароль и соль) **перенесите на офлайн-носитель**: без них облачные копии
расшифровать нельзя. Секреты не хранятся в БД, Git и самих копиях.

## 4. Обновление

`./scripts/update.sh` — защитная копия → сборка новой версии → миграции → перезапуск. Если миграция не прошла,
новая версия не запускается; данные можно вернуть из копии `pre_update`.

## 5. Импорт исходных Excel

Раздел **Импорт**: загрузите `.xlsx` → система найдёт секции листа по заголовкам → проверка (dry-run, рабочие данные не
меняются) → отчёт по строкам (ошибки, предупреждения, вероятные дубли) → выберите секции и подтвердите загрузку.
Паспорт, «Выдан», «Регистрация» и дата рождения исключаются политикой и не попадают ни в БД, ни в отчёт.
Неоднозначные колонки («ОВ», «ЗУ», «А») не загружаются до уточнения профиля (`import-profiles/`).
Перед массовой загрузкой выполните пробный импорт обезличенной выборки. Повторная загрузка того же файла не создаёт дубли.

## 6. Переносимый узел (расширение, ТЗ 41)

`./scripts/export-config-bundle.sh` — зашифрованный пакет несекретной конфигурации. На новом ПК:
`./scripts/bootstrap-portable.sh --config-bundle deployment-config.enc --rclone-conf <путь> --source <target> --backup <id>`.
Узел стартует в роли **standby (только чтение)**. Перевод в рабочий режим — `./scripts/promote-instance.sh` только после
подтверждения, что прежний сервер остановлен (одновременно может работать только один active-узел). Windows: те же
команды через `scripts\*.ps1` (Docker Desktop + WSL2).

## 7. Диагностика

`./scripts/status.sh` — контейнеры и `/api/health`; `./scripts/logs.sh app --follow` — журналы (без паролей и токенов,
с идентификатором запроса — его показывает пользователю сообщение о внутренней ошибке).

## 8. Docker v2.4.1: worker, Chrome и галерея

В v3.1 основной `compose.yaml` также запускает `search-worker` из общего образа app.
Сборка и запуск: `docker compose -p crm build app && docker compose -p crm up -d`.
Отдельный `compose.property-search.yaml` удалён. Проверка:
`docker compose -p crm ps search-worker`, `docker compose -p crm logs --tail=30 search-worker`.
Healthcheck проверяет PID дочернего процесса; ошибки обработки обозначаются безопасным
JSON-событием `property_search.queue_tick_failed`, без текста исключения и секретов.
Поисковый worker имеет исходящий доступ к площадкам и `/dev/shm` 256 MB.
При обслуживании, восстановлении и смене active/standby останавливайте/пересоздавайте
также `search-worker`; при standby он не обрабатывает очередь.

Проверка без внешних запросов: `SCRAPER_ENABLED=false`, `SCRAPER_DEMO_FIXTURES=false`,
`AI_ENABLED=false`. После изменения ENV пересоздайте app и search-worker.
Авторизованный `POST /api/v1/property-search/runs` с filters, sources и idempotencyKey
возвращает запуск в очереди. Опрос `/runs/{id}/progress` должен показать `completed`
и `disabled` для источников; зависший `queued` требует проверки worker и его журнала.
Для отмены используйте `POST /runs/{id}/cancel`; частичные результаты сохраняются.
Для воспроизводимой проверки отмены ожидающего запуска можно временно остановить
search-worker, поставить запуск в очередь, отменить и снова запустить worker.
Не включайте `SCRAPER_DEMO_FIXTURES=true` в рабочем стеке.

Автоматизированный вариант для рабочей копии с Node.js и зависимостями:
`node ops/worker/search-smoke.mjs` (проект `crm`, локальные SEED-параметры).
Сценарий требует выключенных scraper/fixtures/AI в ENV и контейнерах, проверяет
API, отмену после остановки worker, перезапуск, healthcheck, общий image ID и отсутствие
секретов в журнале. Сессия закрывается; в CRM остаются два синтетических запуска.
Если SEED-пароль уже изменён, локальный оператор может добавить `--fixture-session`:
через Docker создаётся сессия на две минуты для активного руководителя без требования
смены пароля; в конце она отзывается. Пароли и пользователи не изменяются, токен не выводится.

`deploy.sh` и `update.sh` запускают app и worker из единого образа. Сохраняйте имя проекта `crm`;
не используйте `down -v` на рабочем стеке. При восстановлении оба процесса останавливаются,
при promote/demote оба пересоздаются с новой ролью.

```bash
docker compose -p crm ps
docker compose -p crm logs --tail=30 worker
docker compose -p crm restart worker
docker compose -p crm exec -T app curl -fsS http://127.0.0.1:3000/api/health/ready
docker compose -p crm exec -T app node scripts/container-smoke.mjs
```

Worker запускает `tsx src/worker/notifications-worker.ts` под супервизором. Интервал
`NOTIFICATIONS_INTERVAL_MS=15000` (1000–60000 ms). Healthcheck проверяет дочерний процесс;
ошибки проходов видны как `notifications.tick_failed` в JSON-логе. Живой процесс сам по себе
не доказывает успешность обработки. PostgreSQL advisory lock и уникальный dedup key защищают
от дублей; standby не генерирует уведомления. Браузер для уведомлений не требуется.

Образ содержит Node 24.22.2, Chromium 156.0.8078.79-1~deb12u1, шрифты, Linux sharp,
tsx и playwright-core 1.64.1. `CHROMIUM_VERSION` — build ARG для контролируемого обновления.
`SCRAPER_CHROME_PATH=/usr/bin/chromium` — путь для серверной конфигурации; совместимый
`channel: chrome` указывает на тот же Chromium. Для `browser:true` настроен
`PLAYWRIGHT_BROWSERS_PATH=/opt/playwright`. Процесс работает без root, `/dev/shm` — 256 MB.
Оба режима запуска проходят через wrapper, читающий `SCRAPER_CHROME_PATH` из ENV;
при переопределении укажите исполняемый файл, существующий внутри контейнера.
Smoke запускает и закрывает браузер без обращения к площадкам, затем кодирует WebP через sharp.
Он не проверяет доступность площадок. Используются настройки sandbox библиотеки Playwright;
полная изоляция браузера от host/private networks требует отдельного egress-контроля на сервере.
Не включайте privileged для устранения ошибок браузера.

ENV скрапера: `SCRAPER_ENABLED=false`, `SCRAPER_BROWSER_ENABLED=true`,
`SCRAPER_JOB_TIMEOUT_MS=180000`, `SCRAPER_MAX_CONCURRENT_JOBS=1`, `SCRAPER_RESULT_TTL_HOURS=24`.
`SCRAPER_DEMO_FIXTURES=true` включает обозначенные синтетические ответы.
Фотографии и миниатюры хранятся в общем томе `./data/files:/data/files`, включая `thumbnails/`.
Files-архив покрывает всё дерево StorageAdapter. `files.sha256` содержит суммы каждого файла.
Manifest считает все пользовательские таблицы, включая search/AI/calendar/notifications,
из того же snapshot PostgreSQL, что и dump. Snapshot БД и файлов не атомарен:
при массовом изменении файлов используйте окно обслуживания.
Restore-test проверяет счётчики, суммы, оригиналы и миниатюры, readiness и вход.
Без контрольного документа пустая копия не получает T08 PASS.
Если первоначальный пароль из `.env` уже сменён, передайте действующие
`RESTORE_TEST_LOGIN`/`RESTORE_TEST_PASSWORD` через окружение. Скрипт не меняет рабочие пароли.
Для синтетического dev-стека доступны явные helpers `scripts/ops-gallery-fixture.ts`
(`OPS_SYNTHETIC_FIXTURE=true`) и `scripts/ops-restore-login.ts` (одноразовый логин
`OPS_RESTORE_TEST_LOGIN=ops_restore_<12 hex>` и случайный пароль ≥24 символов через
`OPS_RESTORE_TEST_PASSWORD`; после backup удалить helper-командой `--remove`).
Первый helper оставляет помеченные тестовые объект/фото/задачу; запускайте его только
на синтетических данных. Пароль тестового логина не выводится и в документы не включается.

## 9. Лимиты AI

AI по умолчанию выключен. Ключ `YANDEX_CLOUD_API_KEY` задаёт владелец в `.env`.
Все `YANDEX_*` из `.env.example` передаются через compose; `store=false` принудителен.
Не выводите `docker compose config` без `--quiet` в общие журналы: он раскрывает ENV.
После изменения ENV пересоздайте app (`docker compose -p crm up -d app`).
Настройки руководителя на `/settings/ai` ограничиваются ENV: 30 запросов/пользователь/час
(`YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR`), 1800 выходных токенов, 30000 ms на запрос,
1000 ₽/месяц (`YANDEX_AI_MAX_MONTHLY_COST_RUB`). 1000 ₽ — предохранитель, не утверждённый бюджет.
Веб-поиск отдельно выключен (`YANDEX_WEB_SEARCH_ENABLED=false`,
`YANDEX_WEB_SEARCH_AUTO_FALLBACK=false`); пределы: 1 вызов/задание, 3 задания/пользователь/день,
контекст low, регион 65. Перед платными вызовами проверьте тарифы и ограничения в UI.
