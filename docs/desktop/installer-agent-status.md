# Tauri/NSIS: протокол агента

Дата: 2026-11-06. Общая копия feature/desktop-v3.2; Git commit/push/checkout/stash/reset/switch не выполнялись. Коммерческий Excel и его производные не читались/не копировались; использованы synthetic fixtures.

## Передача координатору

Исходники готовы к первому CI-прогону. Координатору: собрать текущие совместные изменения, проверить diff и запушить feature/desktop-v3.2. Это сигнал на push; агент push не выполняет. После push требуется анализ job build и install matrix, исправление ошибок и новый прогон. До этого EXE и DT-18 не объявляются полученными.

Новые фиксированные npm devDependencies: @tauri-apps/cli@2.12.4, esbuild@0.28.2, установлены npm install --save-dev --save-exact --ignore-scripts; package-lock обновлён. Cargo локально не запускался, прямые crate versions зафиксированы в Cargo.toml. Первый CI должен вернуть Cargo.lock из artifact, после ревью координатор добавляет его и --locked. Локально Node 22.23.4; Windows bundle требует именно Node 24.15.0 и native probe в CI.

Единственная правка чужой зоны scripts/desktop/init-db.ts — уважать CRM_DESKTOP_SUPERVISED_UPGRADE=1, чтобы не создавать второй незашифрованный снимок после уже проверенного encrypted supervisor snapshot. CLI без флага не меняется. Никаких правок PostgreSQL schema/migrations. Общие next.config/API-handler изменены точечно.

## Реально выполненные проверки

| Проверка | Результат и предел доказательства |
|---|---|
| npm test | PASS: 1438/1438, 69 файлов, 285.49s, unit + browser-cycle. Срез перед последним добавлением config unit |
| Целевые desktop unit | PASS: 17/17 (Host/Origin 14, rollback 1, config server/desktop 2), 3 файла |
| SQLite setup | PASS: 1 сценарий, два конкурентных POST создают одну manager; Argon2id, dictionary, demo client/need/task/property, login, закрытие setup |
| PG regression crm_test_e | PASS: 11/11, 3 файла auth/desktop-server-isolation/desktop-backup-settings; 44.45s. Полную PG regression своей задачей не заявляю |
| npx tsc --noEmit | PASS, итоговый data/desktop-tsc.log; более ранние ошибки параллельной разработки не подменяют финальный результат |
| Targeted ESLint | PASS, собственные TS/TSX/MJS и тесты, --max-warnings=0 |
| Next desktop build | PASS, CRM_BUILD_TARGET=desktop / CRM_DEPLOYMENT_MODE=desktop / .next-desktop-agent-check, Turbopack compile 45s, typecheck/routes/standalone PASS |
| HTTP standalone synthetic smoke | PASS: init, ready, /setup, static asset, Host spoof, Origin GET/POST, setup, login/cookie, clients API, setup redirect |
| Bundled worker/init smoke | PASS: esbuild notifications/search/backup/init/upgrade, фактический compiled init на synthetic SQLite, загрузка backup/upgrade CJS |
| Tauri config | PASS по schema установленного CLI; это не Rust compile |
| JS/PowerShell/YAML syntax | PASS; не исполнялись uninstall/purge на рабочем ПК |
| Confidential guard собственной зоны | PASS: node scripts/security/confidential-guard.mjs --artifact src-tauri --artifact scripts/desktop. Ресурсы пока не собраны; обязательный --artifacts gate запускается bundler в CI |

Локальные текстовые логи только в игнорируемом data/, не в release artifact. Собственная generated standalone/.env удалена без чтения; bundle filter запрещает .env и CI не имеет рабочих секретов. Next автоматически менял include во время build; итоговый tsconfig.json без diff. Каталог .next/ACL не менялись. Запущенные smoke-серверы завершены.

## Трассировка scope

| Требование | Файлы/проверка | Статус |
|---|---|---|
| §3 runtime bundle | next.config.ts, build-desktop-bundle.mjs, desktop-versions.json, runtime/* | PARTIAL: Next/worker smoke PASS, Node24 native + финальный EXE ждут CI |
| §3 single instance / tray / job / graceful | src-tauri/src/{main,supervisor,job,control}.rs | PARTIAL: source + официальные API; runtime UI ждёт CI/ручной Windows |
| §11 loopback security | src/proxy.ts, desktop-loopback.ts, API handler; 14 unit + HTTP smoke | PASS для HTTP границы; native WebView проверка ожидается |
| §5 first setup | app/setup, API desktop/setup, desktop-setup/service, init-db.ts | PASS локально; installer first-run PARTIAL |
| §5 update | runtime/upgrade.ts + desktop-upgrade.test.ts | PARTIAL: rollback DB/files доказан, installer upgrade ждёт CI |
| §5.1 uninstall | windows/hooks.nsh, uninstall-cleanup.ps1, test-installer.ps1 | PARTIAL: syntax/source; install/uninstall ещё не исполнен |
| §11 CI/SBOM/checksum | desktop-windows.yml, bundler, copy-vc-runtime.ps1 | PARTIAL: готов pipeline, artifact ещё не создан |
| DT-01/02 | Windows 10/11 полностью offline | BLOCKED: чистые consumer VM недоступны; Server runners не замена |
| DT-03/15/16/18/19/20 | Windows build/install matrix + ручной WebView/tray/PDF | PARTIAL: ожидают push и CI evidence |

## Остаток и интеграционные границы

- Рабочая Rust/NSIS компиляция, pinned Node24 better-sqlite3 probe, Chromium/WebView offline и реальная install/reinstall/purge не проверены локально: MSVC/Rust отсутствуют.
- windows-2022/windows-2025 — отдельные свежие runners без checkout/setup-node в job install, но на hosted image уже есть общие runtime. Это не доказательство отсутствия всех внешних runtime на consumer Windows.
- Tray делает проверенный локальный DPAPI safety backup; переносимый recovery/export/расписание создания архивов — зона backup агента. Worker оболочки читает настройки и обслуживает durable queue, не auto-uploads safety snapshots.
- Мастер выбирает рекомендуемый default data directory; произвольный каталог SQLite не реализован. Нет обещания переносимости DPAPI ключей между Windows-профилями.
- До измерений Windows не указаны вымышленные минимумы RAM/диска. CI собирает installer/resource bytes, working-set sample и OS metrics.
- Подпись отсутствует. Cargo транзитивная воспроизводимость остаётся PARTIAL до добавления первого Cargo.lock.
- При upgrade snapshot retained; автоматический rollback установленного бинарного пакета отсутствует (документирован предыдущий installer). Ошибка миграции не оставляет молча изменённую БД.
- npm audit при install: 10 moderate в общей dependency tree; автоматическое несовместимое audit fix не выполнялось.

Ссылки: [установка](install.md), [архитектура](architecture.md), [Windows installer](https://v2.tauri.app/distribute/windows-installer/), [Node resources](https://v2.tauri.app/learn/sidecar-nodejs/), [single-instance](https://v2.tauri.app/plugin/single-instance/).
