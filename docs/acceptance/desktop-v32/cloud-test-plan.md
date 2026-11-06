# Безопасный cloud backup live smoke (координаторский запуск)

## Граница и запуск

Сценарий использует только synthetic CRM fixture, временные SQLite/PG базы и каталог артефактов с `runId` в имени. Он не открывает рабочую книгу, `private-data/`, `data/private-imports/` и не пишет в существующие remote prefixes. Единственная разрешённая загрузка cloud credentials — `D:\crm-secrets\clouds.env`, внутри явного запуска `scripts/acceptance/cloud-backup-live.ts --execute-cloud-live`. До отдельного запуска скрипт не читает этот файл и не обращается к сети.

Runner должен выводить только фиксированные этапы/статусы и числовые размеры/счётчики. Запрещены page/API body, provider errors, headers, URLs с credentials, секреты, заполненные формы, screenshots, traces, HAR и произвольные error messages. Playwright screenshots/video/trace отключены. В credentials form values вводятся непосредственно из памяти процесса. Prefix каждого направления уникален на запуск; удаление разрешено только для точных object keys, записанных самим текущим run.

## Независимые scopes

Команды никогда не смешивают UI и модульные доказательства:

1. **UI_CONFIG_PROBE** — `npx tsx scripts/acceptance/cloud-backup-live.ts --execute-cloud-live --scope=ui-config-probe`. Только UI login, настройка двух destinations с уникальным synthetic prefix и текущий API probe. До чтения cloud credentials проверяется обязательная конфигурация, а base URL допускает только явный HTTP(S) на `localhost`, `127.0.0.1` или `[::1]`. Probe означает лишь успешное чтение/list. Этот scope не создаёт backup, не проверяет write, не скачивает/восстанавливает архив и может быть выполнен только координатором на разрешённом disposable CRM deployment. Конфигурация после прогона остаётся в настройках для ручного разбора; удаление/откат настроек этим smoke не выполняется.
2. **MODULE_TRANSFER_RESTORE** — `npx tsx scripts/acceptance/cloud-backup-live.ts --execute-cloud-live --scope=module-transfer-restore`. Создаёт самодостаточные synthetic SQLite/file inputs внутри собственного `mkdtemp`, создаёт один зашифрованный архив, делает реальную передачу/скачивание обоими destinations, проверяет **две отдельные SQLite restore operations** в `GenerationStore` (по одной на архив, скачанный из каждого облака; контрольная SQLite row + checksum документа). Это две restored SQLite instances, не два типа DB backend; PostgreSQL restore этим scope не подтверждается. Выполняет анонимный GET конкретного уже проверенного S3 archive и anonymous ListObjectsV2 точного run-prefix; оба должны ответить 403. Это доказывает только `public read/list denied`, не минимальный IAM scope. URL и тела ответов не читаются и не выводятся. После проверок удаляет только точный `backupId` в своём уникальном prefix. Файл 7 MiB заставляет включить multipart S3 и WebDAV chunking; количества частей выводятся числами. Отдельно выполняет two controlled-failure runs через wrapper: first-put failure на Yandex при реальном Mail.ru transfer, затем controlled network-error на Mail.ru при реальной Yandex verification; persisted queue загружается новым экземпляром и восстанавливается через retry. Маркер этих проверок — `failureModes: 2`; это не физическое отключение сети. Ошибка удаления точного объекта проваливает scope.

Scope `MODULE_TRANSFER_RESTORE` использует только собственные временные исходники/очереди/restore stores. Он читает cloud credentials только при явном opt-in и ограничивает remote operations уникальным prefix и созданным в этом процессе archive ID. `UI_CONFIG_PROBE` имеет отдельные требования: не запускать его на рабочей базе, так как settings PUT меняет live-настройки направления.

## Этапы и доказательства

| Проверка | Метод | Допустимое доказательство |
|---|---|---|
| UI подключение обоих providers | Scope `UI_CONFIG_PROBE`: Playwright manager UI, заполнение секретных полей через локальный код; сохранение; POST `probe` | `configured/read-list-probe=PASS` по каждому provider, без request/response dumps; запись не проверяется |
| Один backup и раздельная доставка | UI `create`, дождаться каждого destination status | Один backup ID и одинаковый SHA-256 из локального архива и контрольных downloads; наружу только `hashesMatch: true/false` |
| Отказ одного направления | Изолированная повторная передача с намеренно недоступным синтетическим endpoint либо управляемый fault adapter | Первый destination verified, второй failed; отдельно от реальных учетных данных |
| Offline queue → resume/restart | Worker/queue integration harness с сетевым fault injection; остановка/повтор worker | queued→verified, один объект на destination, без повторной записи |
| Mail.ru chunk transfer | Синтетический файл больше настроенного part size; полный GET и SHA-256 | byte count, chunk count, hash equality |
| S3 anonymous read/list и CAS | Anonymous requests и повторная запись того же ключа с условием `If-None-Match: *` | anonymous denied и second write conflict; это не доказывает IAM policy scope |
| Desktop restore | `MODULE_TRANSFER_RESTORE`, только запущенный desktop bundle, `CRM_DESKTOP_SUPERVISED_UPGRADE=1` и supervisor mailbox; проверка запуска требует остановки сервера | Login, synthetic control row, restored file checksum; никакого прямого archive API в UI-тесте |
| PostgreSQL restore | `MODULE_TRANSFER_RESTORE`, только disposable PostgreSQL target и операторский `ops/backup` restore runbook | PostgreSQL-specific restore proof: реальный login, synthetic row и файл. `verifyServerPortable`/`pg_restore --list` — только archive validation, не restore |

## Известные интерфейсные gaps текущей рабочей копии

1. Settings/control UI доступен, но `probe` проверяет чтение/list; UI-команда `create` остаётся production backup path и не принимает synthetic source. Нужен координаторский способ запускать приложение против изолированных DB/file roots, не затрагивая его рабочую среду.
2. Desktop `restore` ставится в очередь supervisor и требует supervised runtime. Это должно быть отдельное испытание, не модульное SQLite restore.
3. Server UI явно запрещает restore; `verifyServerPortable` только валидирует PostgreSQL archive через `pg_restore --list`. Для настоящего серверного восстановления нужен disposable PG target и конкретный ops runbook/entrypoint от координатора.
4. Отказ одного направления, offline/restart и объектные cleanup должны исполняться через контролируемый fault injection и run-owned exact keys. Нельзя использовать cleanup всей bucket/prefix.
5. Smoke не доказывает минимальный IAM scope сам по себе. Доказательство требует независимого просмотра policy и negative tests на account/key с документированными полномочиями.

## Статус

Исходник и synthetic mock tests не равны cloud live acceptance. Координатор запускает каждый scope явно. UI scope требует disposable deployment и меняет его settings. Module scope использует ownroot, однако производит реальные cloud operations в уникальном prefix. После запуска координатор заполняет только агрегированное доказательство, фактический backend и `PASS/PARTIAL/BLOCKED`. Не включать screenshots/traces или provider diagnostics. PostgreSQL restore остаётся отдельным operator runbook gate.
