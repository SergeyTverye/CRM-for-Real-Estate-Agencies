# Desktop backup: .crmbackup v1

Нормативная основа: ТЗ v3.2.1 §6–9, DT-07–14, DT-25/26.
Модуль `src/modules/desktop-backup/**` не использует PostgreSQL, Prisma, HTTP-маршруты или серверные сессии. Серверная система backup не изменена.

## Публичные контракты и подключение

Экспорты — `src/modules/desktop-backup/index.ts`. Это desktop-only entrypoint; не импортировать в PG runtime.

- `SnapshotSource.createConsistentSnapshot(destPath)`: SQLite Online Backup API или VACUUM INTO, не копирование открытой рабочей БД.
- `SnapshotBarrier.run(work)`: координатор SQLite обязан запретить **все** mutations, дождаться in-flight файловых операций и удерживать запрет до окончания снимка и копирования документов/фото/шаблонов. Входные metadata/revision должны соответствовать зафиксированной БД; предпочтителен metadata callback, который createArchive вызывает внутри барьера. Без этого барьера согласованность БД+файлы не гарантируется.
- `SnapshotValidator.validate(path)`: штатный `SqliteSnapshotValidator` открывает readonly, требует integrity_check=ok и пустой foreign_key_check.
- `BackupDestination.put/list/get/delete/verify`: LocalDir, RemovableDrive, YandexS3, MailruWebDav.
- `ReplicationQueue`: один экземпляр в desktop supervisor, `pump()` на старте, таймере и восстановлении сети. Планировщик не запускается сам по импорту библиотеки.
- `restoreArchive`: сервис подготовки и переключения поколения. Менеджер/RBAC, системный файловый диалог и подтверждение реализуются desktop API/UI, а не этим инфраструктурным модулем.
- `StateTransfer`: give/receive/compare, обязательный verifyIncoming через extractArchive, явное сохранение обеих ветвей.

Секреты провайдеров передаются конфигурацией из Credential Manager/DPAPI адаптера desktop. Модуль не сохраняет их в JSON, архиве или логах. Код не создаёт HTTP API, не меняет PG migrations и не обходит authorization.

## Контейнер

Все целые числа — unsigned big-endian. Сжатия нет; ZIP/TAR не принимаются.

1. Magic: 8 ASCII bytes `CRMBKP1\n`.
2. uint32 длина заголовка, затем UTF-8 canonical JSON (максимум 8192 bytes).
3. Повторяемые кадры: uint32 длина ciphertext, ciphertext, 16-byte GCM tag.
4. Последний кадр: length=0, tag. Обязателен; любые байты после него запрещены.

Размер plaintext одного кадра ≤1 MiB. Nonce: 8 случайных bytes noncePrefix + uint32 номер кадра. Для каждого архива случайный 256-bit data key; более 2^32−1 кадров запрещено. AAD каждого кадра — UTF-8 `sha256(canonicalHeader):index:length:finalBit`. Последний кадр аутентифицирует конец архива: обрезка на границе кадров не принимается.

Расшифрованный поток: uint32 длина манифеста, UTF-8 canonical JSON, затем содержимое файлов **в порядке manifest.files**, без дополнительных заголовков и padding. Пустые файлы допустимы.

Canonical JSON: ключи объектов сортируются лексикографически, порядок массивов сохраняется, пробелов нет, undefined-поля отсутствуют. `manifestSha256` — SHA-256 canonical JSON **без самого manifestSha256**.

## Манифест и ключи

Манифест содержит backupId, formatVersion=1, crmVersion, schemaVersion, deploymentId, instanceId, deviceId, snapshotRevision, parentBackupId, createdAtUtc, components, files[{path,size,sha256}], encryption{alg,kdf,params}, kind=full, verification{files,snapshot,verifiedAtUtc}, manifestSha256. Времена UTC ISO. UUID, числовые границы, поля и типы проверяются strict Zod.

Компоненты: database.sqlite, settings.json и документы/фотографии/шаблоны под documents/, photos/, templates/. Неизвестные поля настроек запрещены: текущий allowlist — timeZone, locale, backupSchedule.hour/minute. API passwords/tokens, сессии, cloud credentials и локальные ключи не экспортируются.

Encryption: AES-256-GCM, KDF scrypt(N=32768,r=8,p=1,maxmem=64 MiB), random salt 16 bytes. Заголовок содержит только параметры, noncePrefix и две GCM-обёртки data key. Каждая обёртка имеет собственный случайный 12-byte nonce, ciphertext и tag; AAD — базовый заголовок без обёрток.
Кодовая фраза (12–1024 символа) создаёт wrapping key через scrypt. Recovery key — независимо случайные 256 бит, формат `CRM1-<64 hex>-<12 hex SHA256 of hex payload>`; checksum обнаруживает ошибки ввода, не заменяет шифрование.
Recovery key **не содержится в архиве**. Пользователь должен сохранить его отдельно и подтвердить recoveryKeySaved=true. При забытом пароле recovery key снимает независимую обёртку того же data key. Потеря обоих секретов невосстановима. Ключи Buffer обнуляются после использования; JS-строки нельзя гарантированно стереть из памяти.

Архив сначала создаётся как .pending. До публикации выполняются полная расшифровка, проверка SHA-256 всех файлов, manifest, settings, SQLite integrity/FK и финального tag. Только затем fsync/rename и возвращение результата «готово».

## Ограничения, пути и диск

По умолчанию: архив/суммарный payload ≤100 GiB, файл ≤20 GiB, ≤100000 файлов, manifest ≤16 MiB, settings ≤64 KiB. Можно понизить limits; увеличение требует измерений диска и памяти. Потоковые чтение/шифрование ограничивают память; WebDAV part ≤128 MiB, S3 part 5–128 MiB. Размера архива в памяти нет.

Пути только относительные POSIX, без `..`, `.`, backslash, ADS/drive-colon, control/NUL, абсолютных путей, пустых сегментов, Windows reserved devices и завершающих dot/space. Case/NFC collisions, повторные пути и file/directory collisions запрещены. В формате отсутствуют symlink/hardlink entries; existing symlink/junction в staging/source/destination отвергаются. Файлы staging создаются wx. XML WebDAV с DTD/ENTITY запрещён. Заявленные размеры проверяются до выделения файлов; произвольные ZIP bombs отвергаются по magic.

Staging располагается в закрытом каталоге пользовательских данных. POSIX mode 0700/0600; **на Windows desktop bootstrap обязан обеспечить наследуемый ACL текущего пользователя**: Node mode не заменяет Windows ACL. При завершении staging удаляется; обещания физического стирания SSD нет. Защита не рассчитана на злоумышленника с правами владельца процесса, способного подменять каталоги в момент работы.

createArchive по умолчанию прекращает накопление при 50 локальных архивах или 20 GiB (`localBudget`); свободное место проверяется перед копированием и упаковкой. Автоматического удаления последней копии нет; при лимите возвращается LOCAL_BACKUP_CAPACITY. Supervisor сериализует создание архивов и политику хранения.

## Восстановление и защитное поколение

1. Чтение/скачивание и полная проверка в отдельном staging внутри dataRoot на том же filesystem.
2. Проверка schemaVersion (более новая отклоняется), settings, hashes, SQLite integrity/FK.
3. `prepareStage`: desktop SQLite adapter мигрирует **только staging**, проверяет логические счётчики и совместимость. Hook может вернуть {schemaVersion}, чтобы current.json фиксировал версию после миграции; исходный manifest остаётся историческим.
4. `withStoppedRuntime`: эксклюзивный maintenance lock, остановка workers/web и закрытие DB handles.
5. `protectCurrent`: полный зашифрованный снимок текущей БД+files; сервис повторно проверяет checksum, расшифровку и SQLite. В пустой установке hook создаёт валидную исходную пустую SQLite и её защитный backup.
6. Staging переименовывается в generations/<uuid>; durable current.json публикует generation/backupId/manifestSha256/schemaVersion. Это одна точка переключения **БД и файлов вместе**.
7. Runtime открывает DB/storage по current.json; старые поколения и защитный архив сохраняются. Ошибка до публикации указателя оставляет старые данные действующими.

Runtime должен читать все пути из GenerationStore.currentPath(), а не менять SQLite и папку файлов двумя независимыми rename. Не переключать открытые SQLite handles. На POSIX sync каталога выполняется; Node на Windows не предоставляет directory fsync, поэтому абсолютная гарантия против внезапного обесточивания NTFS здесь не заявляется. Атомарная замена указателя и прежние поколения позволяют диагностировать/откатить отказ.

## Назначения

LocalDir/RemovableDrive: уникальная временная папка, archive.pending → fsync → SHA-256 → rename → manifest → публикация каталога backupId. Только опубликованные каталоги попадают в list. RemovableDrive требует существующий выбранный каталог; при исчезновении не создаёт новый «носитель» на системном диске. Ошибки записи/извлечения возвращаются вызывающему коду; исходная БД/архив не удаляются.

YandexS3: endpoint https://storage.yandexcloud.net, region ru-central1, AWS SDK SigV4, static service-account credentials. Immutable key <prefix>/<backupId>.crmbackup; PUT и CompleteMultipartUpload используют If-None-Match:*. Повторный 412 успешен только после контрольного скачивания с совпавшим SHA-256. Multipart abort при ошибке; uploadId сохраняется в журнале, переживает процесс и отменяется перед retry. Для аварийного окна между CreateMultipartUpload и записью журнала рекомендуется lifecycle abort-incomplete. ETag используется только для CAS ownership.json, не как checksum архива. readOwnership/compareAndSetOwnership реализуют If-Match либо первичный If-None-Match; это не offline lock.
Минимальная IAM/bucket policy ограничивается bucket/prefix и необходимыми List/Get/Put/Delete/Multipart операциями. Публичные ACL запрещены; список, download, abort должны быть разрешены ключу. Настройка реальной политики — отдельный smoke; библиотека не выдаёт storage.admin и не меняет публичный доступ.

MailruWebDav: HTTPS https://webdav.cloud.mail.ru, Basic с email и отдельным паролем внешнего приложения. PROPFIND/MKCOL/PUT/GET/DELETE/MOVE, без LOCK. Часть загружается в уникальное pending-имя, полностью скачивается и проверяется, затем MOVE Overwrite:F; при 405/501 — PUT в уникальное финальное имя с повторной проверкой. useMove=false принудительно отключает MOVE. Признак complete публикуется **последним** в <backupId>.complete.json с ordered parts[{key,size,sha256}] и archive metadata. Только complete виден в list; get проверяет каждую часть и общий архив. Незавершённые orphan parts после потери сети не показываются как backup; автоматическая очистка неизвестных remote-каталогов не выполняется.

По умолчанию WebDAV часть 64 MiB: консервативный client cap, **не утверждение о тарифном лимите Mail.ru**. partBytes задаётся по проверенным возможностям аккаунта; поддержка conditional writes/MOVE/квота/rate-limit у реального аккаунта требуют smoke. При отсутствии CAS нет общего latest и автоматического повышения владельца; unique immutable backup IDs, проверка hashes и сохранение конфликтов остаются обязательными. WebDAV без CAS не обеспечивает конкурентную публикацию одного backupId разными writers; desktop supervisor single-writer и протокол handoff обязательны.

Официальные источники, проверены 06.11.2026:
- [Yandex SigV4](https://yandex.cloud/ru/docs/storage/s3/signing-requests): подписи статического ключа.
- [PutObject](https://yandex.cloud/ru/docs/storage/s3/api-ref/object/upload) и [CompleteMultipartUpload](https://yandex.cloud/ru/docs/storage/s3/api-ref/multipart/completeupload): If-Match / If-None-Match.
- [Yandex limits](https://yandex.cloud/ru/docs/storage/concepts/limits): объект до 5 TB, single request до 5 GB, multipart минимум 5 MB кроме последней части, до 10000 частей.
- [Mail WebDAV](https://help.mail.ru/cloud/desktop/webdav/): endpoint, внешний пароль и отключение LOCK. Статья не устанавливает контракт MOVE/CAS или единый лимит файла; эти свойства здесь не выдумываются.

## Очередь, политика хранения и перенос

JSON-журнал data/backup-replication-v1.json, version=1; атомарная temp+fsync+rename запись, статусы по (backupId,destinationId): queued → uploading → uploaded → verified / failed. Содержимое: archive metadata/hash, локальный sourcePath, attempts, nextAttemptAt, безопасный errorCode. Секретов/ответов облака нет.

Максимум pending по умолчанию 50 архивов/20 GiB; один archive считается один раз при N назначениях. Retry 5 попыток с exponential backoff 2s…300s; pump не спит. После падения uploading/uploaded возвращаются в queued; идемпотентный put проверяет уже имеющийся архив. Исчерпанные failed доступны явному retry только этого направления. Частичный успех не меняет verified другого назначения и не удаляет локальный архив. Для переноса журнала в SQLite сохранён отдельный application-контракт, DB зависимости отсутствуют.

Retention по destination: количество/дни/байты, минимум 2 восстановимых поколения по умолчанию и никогда меньше 1. recoverable отмечается **только после restore-test**, не по HTTP 200/verify. Pending любого направления блокирует удаление требуемого ему архива. Если защищённые поколения не укладываются в квоту, возвращается spaceLimitExceeded вместо удаления последнего пригодного. Самостоятельный delete — низкоуровневый примитив; UI/supervisor использует retain и проверенный каталог пригодности.

Handoff хранит deploymentId, instanceId/deviceId, snapshotRevision, parentBackupId, backupId/hash, dirtySinceBackup, readOnly. give делает проверенную копию и сохраняет readOnly; desktop mutation guard обязан соблюдать этот флаг, а локальные записи — повышать revision/dirty транзакционно. receive принимает прямого потомка с большей revision только без локальных изменений; неизвестная цепочка предков консервативно конфликтует. Часы не определяют порядок. Чужой deployment, sibling и одинаковый backupId с другим manifest hash — conflict.
При конфликте обе зашифрованные копии сохраняются как <backupId>-<archiveSha256>.crmbackup; автоприменения/merge нет. Ручное решение требует подтверждения руководителя; losing version уже сохранена. При импорте сохраняются собственные instanceId/deviceId получателя. SQLite-state и readOnly gate подключает desktop coordinator, S3 CAS не блокирует offline DB.

## Испытания и ограничения приёмки

Команды:
```powershell
npx vitest run --config tests/desktop-backup/vitest.config.ts
$env:DESKTOP_MINIO_TEST='1'
$env:DESKTOP_MINIO_IMAGE='dappros/minio@sha256:624bad2fe79a8613aa3c5c9b765ebcab365080b8445cf1b05c357cc7753725f0'
npx vitest run --config tests/desktop-backup/vitest.config.ts
npx tsc --noEmit
npx eslint src/modules/desktop-backup tests/desktop-backup scripts/desktop/cloud-smoke.ts --max-warnings=0
```

MinIO запускается docker run --rm, случайный loopback port, временный container, синтетические credentials; afterAll останавливает его. Официальные minio/minio и quay.io/minio/minio на этом стенде вернули pull denied/401; испытан зеркальный fixed digest указанного релиза, не production dependency.
WebDAV — npm webdav-server в процессе на случайном loopback port. Никаких реальных облаков, ключей D:\\crm-secrets и коммерческой книги тесты не читают.

Финальный прогон: **27/27** тестов (10 формат/restore/USB/retention/handoff, 5 malicious-format hardening, 6 локальные облака/queue, 4 settings/crypto/DPAPI, 2 HTTP settings); tsc и scoped ESLint PASS. Native SQLite реально открывается после restore из обоих направлений. Проверены ciphertext/header/truncation, traversal, oversized declarations, ZIP rejection, FK/integrity, conflicts, bounded retry/restart, network cut WebDAV/S3, multipart abort, S3 CAS и запрет anonymous GET.
Тесты выполнены на host Node 22.23.4; Node24 packaged runtime, настоящий USB disconnect, Windows ACL/installer и реальная облачная IAM/quota/MOVE требуют отдельного desktop gate.

DT-07/08/11/12/13/14: инфраструктура покрыта синтетикой, UI/runtime wiring/физический носитель остаются PARTIAL.
DT-09/10/25/26: локальные совместимые endpoints PASS; **реальные облака и UI не проверялись**, поэтому общие DT не помечены PASS.

`scripts/desktop/cloud-smoke.ts` подготовлен, **не запускался**. Только при явном --execute-real-cloud-smoke читает D:\\crm-secrets\\clouds.env:
YANDEX_S3_BUCKET, YANDEX_S3_ACCESS_KEY_ID, YANDEX_S3_SECRET_ACCESS_KEY, MAILRU_WEBDAV_EMAIL, MAILRU_WEBDAV_APP_PASSWORD.
Создаёт только synthetic DB/document в отдельном случайном namespace, один архив для двух облаков, выполняет queue/download/restore и удаляет только свой synthetic backup. В выводе — только destination/status; ошибки/секреты не печатаются. Может потреблять платные операции и квоту; не включать в CI/обычный запуск.

## API настроек для руководителя: server и desktop

Дополнение координатора от 06.11.2026. Реализован общий endpoint **GET / PUT /api/v1/settings/backups**. Обе операции используют api({access:"manager"}); service повторно проверяет actor.role=manager. В текущем role codebook manager включает административные полномочия: отдельная роль "admin" не вводится. UI скрывает раздел от realtor, но защита действует и для прямого URL.

Route импортирует только settings-service/settings-runtime, не index.ts и не SQLite archive-код. Server PostgreSQL не зависит от better-sqlite3 для настроек. Desktop использует тот же HTTP-контракт через штатную локальную сессию. Включённые настройки сами по себе **не инициируют сетевую передачу**.

GET возвращает:
```json
{
  "updatedAt": null,
  "destinations": [],
  "schedule": {"enabled":false,"timeZone":"Asia/Novosibirsk","frequency":"daily","hour":19,"minute":0,"weekday":1,"onClose":false,"beforeUpdate":true},
  "retention": {"keep":7,"maxAgeDays":30,"maxBytes":21474836480},
  "secretStorage": {"protection":"server-aes-256-gcm","available":false}
}
```

PUT — полная замена публичной конфигурации с expectedUpdatedAt (null при первом сохранении), destinations, schedule, retention. Destination.id — UUID, enabled — boolean:
- local/removable: {id,kind,enabled,directory} — абсолютный путь **на машине runtime**, не браузера. UI desktop получает его через разрешённый native directory dialog; server USB означает подключённый к server накопитель.
- yandex_s3: {id,kind,enabled,bucket,prefix,endpoint:"https://storage.yandexcloud.net",region:"ru-central1",credentials?:{accessKeyId,secretAccessKey},clearCredentials?:boolean}.
- mailru_webdav: {id,kind,enabled,email,prefix,endpoint:"https://webdav.cloud.mail.ru",partBytes,useMove,applicationPassword?:string,clearCredentials?:boolean}.
У каждого направления допускается необязательный retention:{keep,maxAgeDays,maxBytes}; без override применяется общий retention. Удаление выполняется supervisor через queue.retain для конкретного destinationId.
Endpoint не произвольный: исключены SSRF через localhost/metadata URLs и отправка секретов чужому host. Префикс ограничен безопасными сегментами.

GET/PUT-ответ содержит только публичные поля destination + **credentialsConfigured:boolean**, никогда credentials, applicationPassword или secretRef. AccessKeyId тоже write-only. Отсутствующее secret-поле сохраняет прежнее значение, clearCredentials=true удаляет секрет; одновременная передача clear и секрета запрещена. Включить cloud без настроенного секрета нельзя. При смене провайдера нужно новое id. Пустой пароль не означает "оставить": поле надо опустить. Full replacement удаляет отсутствующие направления и их отдельные encrypted secrets.

PUT требует application/json, совпадающий Origin, активную сессию, сменённый временный пароль и active instance. Ответы: 401 без сессии, 403 role/CSRF, 400 безопасная валидация без введённых значений, 409 STALE_UPDATE, 503 безопасная ошибка хранилища. На standby PUT запрещён общей оболочкой. В GET секрета нет даже для manager. UI не хранит пароль в localStorage и после успеха очищает поле.

Сервис: BackupSettingsService(SettingsRepository, CredentialStore), методы get(actor)/update(actor,unknown). Metadata destinations.v1.json хранится под BACKUP_SETTINGS_DIR; updatedAt монотонен, updatedBy фиксирует инициатора. JsonSettingsRepository сериализует обновления в одном web owner; workers только читают. Конфигурацию и секреты нельзя включать в safe settings архива. Смена конфигурации worker/supervisor должна пересобрать назначения после завершения текущего transfer, не удаляя уже созданный архив.

**Server:** BACKUP_SETTINGS_DIR — абсолютный ACL/volume-protected путь, default <cwd>/data/backup-settings; BACKUP_SETTINGS_MASTER_KEY — случайные **32 bytes base64**, только ENV/secret mount, не NEXT_PUBLIC и не браузер. Отсутствие ключа не ломает PG startup/GET/local настройки; запись cloud credentials недоступна, GET показывает available=false. Secrets шифруются AES-256-GCM с random nonce и AAD=secret UUID в отдельных immutable blobs. Rotation требует расшифровать старым ключом и перешифровать новым до смены ENV; просто поменять ENV означает потерять доступ. Master key и credential store резервируются администратором отдельно от crmbackup.

**Desktop Windows:** WindowsDpapiProtector применяет .NET ProtectedData CurrentUser; зашифрованные blobs под data/backup-settings/credentials, bound к текущему Windows-пользователю. PowerShell запускается hidden, фиксированный script, секрет только stdin, stderr не печатается. Plaintext временных файлов и CLI credentials нет. Другой пользователь/другой ПК не должен читать эти blobs: при переносе CRM облака подключаются заново. Windows ACL каталога обязан установить bootstrap. Non-Windows desktop fail-closed, без fallback на server ENV key.

Новые ENV не добавлялись в общую .env.example (зона другого агента); ниже дан отдельный пустой template для подключающего агента. Настоящие секреты в документации/fixtures отсутствуют. Secret store не предоставляет HTTP GET и не экспортируется через DTO.

Проверки дополнения: settings 4/4 (включая настоящий DPAPI на Windows), HTTP server/desktop 2/2 с синтетическим session adapter; новый PG authorization файл 2/2 и SQLite API 1/1 с настоящими сессиями; PG regression auth/deals/documents/admin/RBAC 27/27. UI подключения и запуск worker по расписанию остаются задачей интеграционного агента.

## Протокол проверки модуля (06.11.2026)

Рабочая ветка feature/desktop-v3.2; наблюдаемый HEAD 628f131 (общая копия, параллельные изменения других агентов). Host Windows/Node 22.23.4, Docker Engine 29.9.2. Это не проверка Windows EXE/Node24 packaged runtime.

| Проверка | Результат |
|---|---|
| tests/desktop-backup с DESKTOP_MINIO_TEST=1 | 27 PASS, 5 файлов; реальные SQLite snapshots, local WebDAV и временный MinIO |
| tests/authorization/desktop-backup-settings.test.ts | 2 PASS, реальные PostgreSQL session/RBAC/CSRF/OCC |
| tests/sqlite/backup-settings.test.ts | 1 PASS, реальные SQLite session/RBAC + Windows DPAPI |
| PG auth/deals-offers-documents/crm-access/admin-api | 27 PASS на crm_test_c |
| npx tsc --noEmit | PASS |
| scoped ESLint по модулю/API/scripts/новым тестам | PASS |
| git diff --check | PASS; чужие изменения не откатывались |
| Временные MinIO containers | Остановлены afterAll, не оставлены работающими |
| Реальные Yandex/Mail.ru | НЕ ЗАПУСКАЛИСЬ, D:\\crm-secrets не читался |
| Коммерческий Excel | Не открывался, производные не создавались |

Новые npm зависимости этой задачи: @aws-sdk/client-s3@3.1163.0 и dev webdav-server@2.6.3 (--save-exact).
better-sqlite3@12.6.2 и @types установлены параллельным SQLite агентом, модуль использует их без PG schema/migration изменений.
