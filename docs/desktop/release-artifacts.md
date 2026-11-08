# Windows desktop: установленный EXE 998b59f

> Текущее (поиск): `998b59f` — [CI 42440108843](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42440108843) полностью SUCCESS, EXE 800171772 B, SHA-256 `dcccfede42424657f7fce3c4b8cac836dd05f35f0e8301ce5e90577dd3698bb3`. Установленный поиск, UI, LIVE-сбор и AI проверены; протокол: [installed-search-998b59f.md](../acceptance/desktop-v32/installed-search-998b59f.md). Ниже — исторический срез a4.

Исторический артефакт a4, заменённый текущим `998b59f`: commit `a4a4120cd83b8f967b546472a25c8eb0909841de`, run [42415838070](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42415838070), статус **ALL SUCCESS**: build + installer 2022 + installer 2025.

Артефакт: [13592870756](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42415838070/artifacts/13592870756). Файл `releases/windows-x64/CRM-Setup-Windows-x64.exe`, **593 321 323 байт**. SHA-256: `7434e3a5c8a646fe15663ed0b3649026404bb744165cc4baa1431b8e35c1040b`. Установленный launcher SHA-256: `bc46de74eb9490deac0e666d238864e61b46d326883a425a97ca779556b48a86`.

Ветки/история: текущая ветка `codex/installed-release-proof`; `main` сохранён на `a982542a40bab1e2f5667c336f2edd314ee96fa0`. Packaging-only a4 не требует дублирующей production-сборки; production/shared business base a982 и существующие Docker-стеки не затронуты.

## Фактические доказательства (ограниченные)

- CI-регрессии: unit **1795 PASS + 5 optional skip**; SQLite integration **398 PASS + 1 server-only skip**; Rust **1 PASS**; финальный runtime **all PASS**.
- Installer evidence (2022/2025): каждый **74 PASS / 0 FAIL**, включая client-page 200, удаление пустого placeholder самим installer, сохранение пользовательских файлов, native window, single instance, uninstall-keeps, reinstall, update, purge cleanup. **Не** clean consumer VM proof.
- Windows 11 (фактический overinstall): обычная тихая установка поверх старой версии — **exit 0**; база не изменена; старый точный пустой synthetic `app/public/.gitkeep` удалён самим installer. Ресурсы установленной программы не патчились вручную.
- Strict runtime policy: **PASS**; в установке нет ТЗ/spec/исходников/ключей (runtime notices/licenses легитимно сохранены).
- Исторические сбои a982 (client 500 и placeholder) **исправлены** `5b8613e` + `a4`, не являются текущим сбоем.
- Installed a4 core (ограниченный): [installed-a4-core.md](../acceptance/desktop-v32/installed-a4-core.md) — PASS 12/12 parent + 12/12 business, headless packaged Chromium + supervisor smoke, не native WebView/не физический offline.
- Installed a4 cloud (ограниченный): [installed-a4-cloud.md](../acceptance/desktop-v32/installed-a4-cloud.md) — настройка обоих облаков через UI, реальное восстановление из каждого и изоляция отказа одного направления.

## Известные оставшиеся границы

Текущий a4: local backup/restore 20/20 и handoff/conflict 61/61 PASS на синтетических профилях; [протокол](../acceptance/desktop-v32/installed-a4-local.md). PG→SQLite проверен на синтетической копии: 11 проверок PASS, [DT-06](../acceptance/desktop-v32/DT-06.md). Installed Excel UI: 14/14 проверок PASS, 0 новых строк при повторе; [протокол](../acceptance/desktop-v32/installed-a4-import.md). Не доказаны: физический network cut, полный native picker/tray/reboot/reminder matrix. DT-09/10/11 — ограниченный PASS; DT-25/26 — PARTIAL. Clean Windows 10/11 consumer VM — **BLOCKED** по решению пользователя (текущий Win11 + Actions Server не эквивалентны). P2 не является release gate.

**Итог:** частично проверенный кандидат, продолжать верификацию. Не называть весь релиз готовым.

## Исторические сборки (не текущая загрузка)

- `a982542a` / run [42408326567](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42408326567), artifact [13589677235](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42408326567/artifacts/13589677235), 585 556 902 B, SHA `1c818d455cf758edcba5b12aa591f1956c28f4cd8f919772304f6b062b57a0ed`. Исторически: client 500 / placeholder; **не** текущая загрузка.
- `71e8765`: Windows Server 2022/2025 lifecycle PASS; Windows 11 setup/login/экраны/бизнес-цикл в изолированных профилях. [installed-71e8765.md](../acceptance/desktop-v32/installed-71e8765.md).
- `41c39b8` / `7e7e47e`: ранние smoke-сборки; не приёмка текущего EXE.

Linux production (shared business base a982): образ `02d8478e47dbbee51ab8632b4b9797046b8623e3910560f70b07d4cf9c467079`, Node 24.22.2. PostgreSQL 9/9 (3 роли + файлы/RBAC + реальный pg_dump/restore PASS), SQLite 22/22 (реальный encrypted restore + file SHA PASS). Начальное прерывание транспорта не засчитано как PASS; завершённое восстановление — отдельно. Docker production не затронут.
