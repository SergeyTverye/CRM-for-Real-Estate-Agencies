# v3.2 installed supervisor backup/restore — preparation only

**Статус: NOT RUN.** Подготовлен opt-in runner; установленное приложение, installer,
DPAPI, реальный backup/restore, USB и Windows picker в рамках подготовки не запускались.
Это не PASS T08/DT и не замена `test-installer.ps1`.

## Граница и предусловия

- Координатор отдельно собирает/устанавливает принятый EXE. Runner не вызывает Git,
  npm, build, NSIS, регистрацию, uninstall или purge.
- Windows x64, PowerShell 7.2+, native bundled Node **24**. Host Node не нужен.
- Только установка `%LOCALAPPDATA%\Programs\RealEstateCRM`; нестандартный путь,
  включая `RealEstateCRM-CI`, намеренно отклоняется. Не переносить туда чужую установку
  ради теста; координатор должен подготовить нужный путь отдельно.
- Закрыть собственное пользовательское приложение вручную. Runner проверяет процессы
  RealEstateCRM и writer mutex; при наличии чужого экземпляра прекращается, не останавливает его.
- Не включать transcript, HTTP tracing, verbose/debug capture, memory dump. Случайные
  manager password / archive passphrase / recovery key не передаются через аргументы,
  env, отчёт или plaintext-файл; они живут в памяти. Managed strings не гарантируют
  физического стирания памяти. Само приложение пишет DPAPI-encrypted credential blobs
  в защищённый одноразовый профиль; runner их не читает.
- Fresh root обязателен. Существующий run-каталог отклоняется независимо от наличия
  synthetic marker. Пользовательский default data root никогда не принимается.
- Все существующие предки путей проверяются на reparse points. Использовать локальный
  несинхронизируемый QA workspace, без конкурентной подмены путей. Проверки не являются
  защитой от враждебного процесса того же пользователя / TOCTOU.

## Отдельный запуск координатором после разрешения

Следующий пример **не выполнялся**. Новый timestamp + nonce на каждый запуск;
не создавайте run-каталог заранее.

```powershell
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$nonce = [Guid]::NewGuid().ToString('N').Substring(0,8)
$run = Join-Path 'D:\CRM-for-Real-Estate-Agencies\data\qa-v32-installed' "run-$stamp-$nonce"
$root = Join-Path $run 'localappdata\RealEstateCRM'
pwsh -NoProfile -File .\scripts\desktop\test-installed-workflows.ps1 `
  -InstallDirectory "$env:LOCALAPPDATA\Programs\RealEstateCRM" `
  -DataRoot $root -RunInstalledWorkflows
```

Родительский LOCALAPPDATA не меняется. Для **дочернего** launcher задаются
`LOCALAPPDATA=<run>\localappdata`, APPDATA/TEMP/TMP внутри run. App сам добавляет
фиксированное `RealEstateCRM`. Environment очищается от DB/storage/backup overrides
и credentials вызывающей оболочки. Установка остаётся в исходном месте.
ACL изменяется только у нового run-root (current user + SYSTEM).

## Проверяемая последовательность

1. Fresh profile; installed `RealEstateCRM.exe --smoke --smoke-seconds=1800`, без WebView.
2. Свежий runtime.json только из собственного профиля: loopback URL, PID supervisor,
   его parent PID = запущенный launcher, executable = installed bundled node.
3. Ready 200; bundled `node.exe --version` = v24. First setup доступен.
4. Empty setup, случайный manager password, login; synthetic client без контактов;
   synthetic TXT загружен через multipart documents API, download SHA-256 совпадает.
5. Manager `POST /api/v1/settings/backups/control`, action=create с memory-only
   passphrase/recovery key. Реальный supervisor останавливает writers и исполняет
   опубликованную API команду. Runner не подделывает command/result JSON.
6. Ожидание собственного `<requestId>.result.json`, action/create/status=verified;
   ready и новый PID server.js. Реальный переносимый archive: 32 B–256 MiB,
   SHA-256/size совпадают с результатом. Этот лимит — safety guard синтетической QA,
   не лимит продукта. Незапланированно большой архив не экспортируется.
7. Отдельный verify через recovery key; результат verified, restart server,
   повторный login. DPAPI работает через production adapter, без mock/host Node.
8. PATCH client с expectedUpdatedAt; подтвердить AFTER до restore.
9. Explicit confirmed restore собственного catalog archive с passphrase;
   результат restored, отдельный protectiveBackupId и protective archive существуют;
   ready / новый server PID / login; client снова BEFORE; Document download SHA-256
   прежний. Наличие protective archive проверяется, его расшифровка/rollback обратно
   этим runner не проверяются.
10. Cleanup: дождаться bounded smoke, никогда не использовать глобальный `--shutdown`.
    Через 360 s ожидания завершения — аварийный Kill(tree) **своего process handle**,
    пометка failed. Launcher Job Object должен убирать дочерние процессы; независимая
    проверка отсутствия всех descendants после выхода остаётся ручной. Данные не удаляются.

### Известное ограничение длительности

Текущий `src-tauri/src/main.rs` clamp smoke duration = **300 s**, даже при запросе
1800. Установленный EXE может отличаться: проверять release отдельно. При истечении
runner завершается ошибкой, не перезапускает автоматически и не выдаёт частичный
результат за PASS. Если операций не хватает в 300 s, это blocker конкретного прогона;
не менять launcher в рамках этой задачи. Runner не проверяет shutdown/closing backup
как отдельный acceptance step.

## Необязательный export mailbox REPLAY

Добавить `-ReplayNativeMailbox` для экспорта под произвольным именем в собственный run.
Это API native-export → запись собственного UUID.path → production supervisor export
→ native-result=exported → SHA-256. **REPLAY, не настоящий save dialog / picker.**

Для заранее предоставленного координатором HDD/USB каталога нужны одновременно:

```powershell
# Добавить к основному вызову (только после отдельного разрешения):
-ReplayNativeMailbox -UsbDirectory 'E:\approved-qa' -AllowUsbExport
```

Каталог должен существовать; runner создаёт только новый `run-<timestamp>-<nonce>`
подкаталог, не перечисляет/не перезаписывает прежние файлы, не удаляет результат.
Одинаковый SHA подтверждает копирование, но не тип физического устройства,
безопасное извлечение, повторное подключение или restore с USB. Содержимое остальных
каталогов носителя не читается. Передать заново свежий root при повторном тесте.

## Отдельные ручные сценарии, NOT RUN

### Настоящие Windows save/open dialogs и импорт arbitrary filename

В отдельном disposable synthetic profile координатор запускает полноценное установленное
приложение (не smoke), проходит setup, создаёт client/document и backup. Через UI
сохраняет на разрешённый носитель под **произвольным** именем `.crmbackup`, закрывает
dialog; проверяет cancel без изменения данных. После изменения client выбирает этот
файл через настоящий Windows open dialog, вводит recovery material только в UI,
подтверждает restore; проверяет protective snapshot, restart/login, rollback client,
download SHA. Повторяет cancel / неверный ключ / damaged synthetic archive без замены
рабочих данных. Записывает только безопасные результаты и SHA, без UI-секретов.

Runner **не реализует import mailbox replay** и не заявляет импорт из файла: основной
restore работает из собственного каталога. Любой будущий `.path` import replay должен
называться REPLAY и не засчитываться как реальный picker.

### Handoff двух профилей

Не входит в runner. Writer mutex/stop-event общие для одной Windows-сессии, поэтому
нельзя запускать профили одновременно или применять `--shutdown` ко второму профилю.
Ручной тест: give A → убедиться read-only A → штатно закрыть A и дождаться выхода
процессов/освобождения mutex → новый disposable B → actual native import/receive →
compare/подтверждение → проверить данные и запись только на B. Нужна отдельная
проверка conflict/dirty A. Без неё перенос/ single-writer не PASS.

## Доказательства и очистка

`<run>\safe-report.json`: только schema, fixed check codes/booleans, byte counts,
SHA-256; никаких paths, PID, user inputs, raw HTTP errors, cookies или secret blobs.
До создания защищённого run-root ошибка возвращает только фиксированный failure code,
без report. `actualWindowsPickerTested=false`, `handoffTested=false` всегда.
Не публиковать run-root целиком: внутри тестовая DB, logs, archives и encrypted credentials.
Пароли не сохраняются, повторный login после окончания этим runner не предусмотрен.

Runner ничего не удаляет. После независимой проверки выхода собственных процессов
координатор может отдельно удалить **точный одноразовый run** и точный экспортный
подкаталог носителя по marker и имени. Никаких purge default profile, recursive delete
общего data/backup/USB root, остановки чужих процессов или изменения NSIS registration.

Preparation validation: PowerShell `Parser.ParseFile`, без исполнения runner. Реальный
installed acceptance остаётся NOT RUN до отдельного решения координатора.
