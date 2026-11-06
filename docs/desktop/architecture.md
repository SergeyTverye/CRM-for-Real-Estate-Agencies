# Desktop runtime и Windows installer

ТЗ v3.2.1 §3, §5/5.1, §11. Серверный baseline сохранён: output standalone включается только при CRM_BUILD_TARGET=desktop; PostgreSQL schema/migrations не меняются этой задачей. Runtime-выбор БД — только CRM_DEPLOYMENT_MODE=desktop.

## Процессы и границы

Tauri 2 держит native single-instance plugin, окно WebView2 и tray. Повторный ярлык показывает/фокусирует окно. Дополнительный Windows named mutex защищает writer также при --smoke. Имена находятся в Local namespace Windows logon session. В профиле одного пользователя не поддерживается одновременная работа из разных Windows logon sessions.

До создания Node/WebView parent включается в Windows Job Object с KILL_ON_JOB_CLOSE; все потомки наследуют job. Handle держится до завершения процесса ОС (ManuallyDrop), чтобы его раннее закрытие не убило parent во время штатного cleanup. Native --shutdown сигнализирует event; приватный stdin STOP даёт Next/worker завершиться, после ограниченного ожидания применяется kill. Job Object обеспечивает завершение потомков при аварии parent. Перезапуск отдельного умершего worker автоматически не маскирует ошибку: весь runtime останавливается с диагностикой.

Rust запускает только app/node/node.exe + фиксированный supervisor.mjs. WebView не получает shell/fs плагины или команды запуска. invoke_handler отсутствует, capabilities=[] и withGlobalTauri=false: удалённая loopback-страница не имеет native IPC. Все native действия идут из tray/событий окна. WebView навигация разрешена только на точный выданный origin.

Node supervisor выбирает свободный порт, слушает только 127.0.0.1, формирует runtime env и ожидает /api/health/ready до навигации. Проверка Host/Origin действует для всех страниц/assets через src/proxy.ts и повторно для API. Desktop не доверяет forwarded-host; Origin мутаций обязателен. Cookies, Argon2id, sessions и RBAC CRM сохранены. HTTP CSP запрещает внешние script/connect/frame; inline scripts/styles разрешены для гидратации Next. Для встроенной bootstrap-страницы действует отдельный строгий CSP Tauri.

Каталог %LOCALAPPDATA%/RealEstateCRM отделён от установки: data, files, backups, logs. Rust проверяет существующие ancestor reparse points, ограничивает ACL текущим SID и SYSTEM до создания БД/секретов. Node повторно проверяет directories; backup-модуль проверяет symlink/path traversal. Runtime identity хранится в data/identity.json, UUID сохраняются между запусками.

## Первый запуск и обновление

/setup доступен только в desktop при нуле пользователей; повторный POST проверяет ноль внутри сериализованной SQLite-транзакции. Создаются manager, справочники и юридические заглушки; demo дополнительно создаёт синтетические client/need/task/property с владельцем manager. Предопределённого пароля нет. Прямой server setup — 404.

Пакет выбирает scripts/desktop/init-db.ts, если файл существует. Контракт: Node запускает с --initialize, CRM_DEPLOYMENT_MODE=desktop, DESKTOP_DATA_DIR, DATABASE_URL, SQLITE_DATABASE_URL, identity env; код 0 после миграций, без создания пользователя. До появления этого entrypoint fallback делегирует SQLite database-lifecycle, не создавая второй migration ledger.

CRM_DESKTOP_SUPERVISED_UPGRADE=1 сообщает init-db, что supervisor уже создал зашифрованный protective snapshot. CLI без флага сохраняет прежнее поведение. Snapshot использует createArchive/extractArchive и SqliteSnapshotValidator из src/modules/desktop-backup. На этом этапе сервер и worker ещё остановлены, поэтому barrier атомарен для DB+files. Pending upgrade journal восстанавливается после аварии до запуска новых writers. До smoke/ready новая версия не фиксируется. При ошибке восстанавливается SQLite, WAL/SHM очищаются, предыдущая версия сохраняется. Архив остаётся; бинарный downgrade требует предыдущего EXE.

Tray snapshot использует тот же проверяемый архив, останавливая все writers на время снимка. Локальный DPAPI key предназначен текущему Windows-профилю. Это не переносимый пользовательский backup: portable recovery/export UI интегрирует другой агент. Backup worker этой задачи восстанавливает/обрабатывает durable ReplicationQueue из data/backup-queue, читает настройки/DPAPI credentials и независимо обслуживает targets; конфигурации облаков добровольны. Самостоятельное создание переносимых архивов по расписанию остаётся контрактом backup-модуля, не объявляется доказанным этой оболочкой.

## Сборка

scripts/desktop/build-desktop-bundle.mjs требует Windows x64 и Node 24.15.0. Выполняет Next build в .next-desktop, копирует standalone/static/public, SQLite schema/migrations/metadata/generated client. Production npm ci --omit=dev создаёт node_modules по lockfile, native better-sqlite3 rebuild и runtime probe выполняются именно Node24 x64. Dev-зависимости не поставляются. Workers/init/upgrade компилируются esbuild в CJS; import.meta.url адаптирован для generated Prisma. Локальные .env, private-data, БД/архивы и symlinks в resources запрещены.

Официальный Node zip скачивается с nodejs.org по фиксированной версии. SHA-256 сверяется с SHASUMS256.txt и зафиксированным digest; в пакет входят только node.exe, LICENSE, release checksums. App-local MSVC CRT DLL из официального VS Redist каталога runner включены рядом с node.exe; версии и SHA-256 перечислены в node/MSVC-RUNTIME.json. Shared runtime installer не вызывается и не удаляется. Перераспространение регулируется [Visual Studio Redist list](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution). Полный Chromium Playwright включён для offline PDF/скрапера, executable указан manifest. WebView2 offlineInstaller включается Tauri NSIS. SBOM npm CycloneDX + runtime list + Cargo metadata/lock и SHA-256 соседствуют с EXE.

Rust и MSVC локально отсутствуют. Cargo.lock будет получен первым CI build и опубликован рядом с EXE: координатор должен вернуть проверенный lock в репозиторий и затем включить --locked. До этого точные direct crate versions фиксированы, но транзитивная Rust reproducibility PARTIAL. Никакой локальной сборки Rust не заявляется.

## Установщик и CI

NSIS currentUser/Russian использует штатную регистрацию HKCU и ярлыки Tauri. PREINSTALL останавливает прежнюю установку; PREUNINSTALL/POSTUNINSTALL дополняют стандартный teardown. Используется штатный checkbox uninstall-page с повторным предупреждением. /S сохраняет данные; /S /PURGE-DATA /CONFIRM-PURGE очищает только data/files/backups/logs текущего профиля и собственные credentials RealEstateCRM:. /UPDATE блокирует purge независимо от флагов. Встроенная общая data-delete ветка Tauri отключается hook, чтобы не обходить scope checks.

Фиксированный cleanup helper выбирает процессы по canonical installation path и их descendants (WebView shared executable учитывается только как потомок приложения), сначала ждёт graceful exit, затем останавливает оставшихся. Перед рекурсивным удалением проверяются абсолютные allowlisted paths и reparse points. Общие runtimes, другие профили и облака не изменяются. Не регистрируются сервисы, scheduled tasks или автозапуск.

desktop-windows.yml: push feature/desktop-v3.2/workflow_dispatch → windows-latest build → artifact → независимая matrix windows-2022/windows-2025 без checkout/setup-node. Installer test проверяет checksum, install /S, headless --smoke, readiness, HKCU/shortcuts, manager login/client API, сохранение файла/БД при uninstall, reinstall, overinstall и purge. Пароль синтетический случайный, не печатается и не отправляется в artifact. Evidence содержит только коды и runtime metrics.

## Доказательства и ограничения

Локально: unit Origin/Host и реальный encrypted rollback на synthetic SQLite, первый setup/конкурентное создание/login, PG auth/доступ setup, ESLint, JS/PowerShell синтаксис и Tauri JSON schema. Фактические результаты — installer-agent-status.md. DT-01/02/03/15/16/18/19/20 остаются PARTIAL/BLOCKED до EXE, CI-install и ручного WebView/tray/offline прогона. Раннеры Server не заменяют Windows 10/11.

Официальные источники: [NSIS и offline WebView2](https://v2.tauri.app/distribute/windows-installer/), [Node runtime как resource](https://v2.tauri.app/learn/sidecar-nodejs/), [single-instance](https://v2.tauri.app/plugin/single-instance/), [Tauri config](https://v2.tauri.app/reference/config/).
