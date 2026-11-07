# Приёмка CRM v3.2.1 (desktop v32)

Нормативный источник: `ТЗ_CRM_v3.2.1_standalone_SQLite_облака_импорт_защита.md`. Проверки на ранних коммитах не доказывают готовность будущего установщика.

## Текущее состояние — 2026-11-08 (a4, ограниченный срез)

- Текущий загруженный EXE: `a4a4120cd83b8f967b546472a25c8eb0909841de`, CI [42415838070](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42415838070) **ALL SUCCESS** (build + installer 2022/2025), artifact [13592870756](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42415838070/artifacts/13592870756). `CRM-Setup-Windows-x64.exe` **593 321 323 B**, SHA-256 `7434e3a5c8a646fe15663ed0b3649026404bb744165cc4baa1431b8e35c1040b`, launcher `bc46de74eb9490deac0e666d238864e61b46d326883a425a97ca779556b48a86`. Ветка `codex/installed-release-proof`; `main` = `a982542a`. Подробности: [release-artifacts.md](../../desktop/release-artifacts.md).
- CI/installer: unit **1795 PASS + 5 optional skip**; SQLite **398 PASS + 1 server-only skip**; Rust **1 PASS**; final runtime **all PASS**. Installer 2022/2025: каждый **74 PASS / 0 FAIL** (client-page 200, empty placeholder удалён installer, user files retained, native window/single instance/uninstall-keeps/reinstall/update/purge). Win11 silent overinstall **exit 0**, DB unchanged, старый пустой synthetic `app/public/.gitkeep` удалён installer; strict runtime policy **PASS**. **Не** clean consumer VM proof.
- Installed a4 core (**ограниченный PASS**): [installed-a4-core.md](installed-a4-core.md), run `26b62a10-9ae2-4ecd-98ee-6c6c94a7a89d` — 12/12 parent + 12/12 business; headless packaged Chromium `156.0.8078.4` + supervisor smoke; Node 24.15.0 / SQLite 3.51.2; UI setup/login/экраны/форма клиента; API need/task/property/collection/offer/document authorization; реальные DOCX/PDF/XLSX/ZIP; restart persisted. **Не** native WebView walkthrough; browser `0 external HTTP requests` ≠ физический offline; PDF link origin `127.0.0.1:4011` корректен на момент создания, persisted link across restart **не доказан**.
- Installed a4 cloud (**ограниченный PASS** в границах прогонов): [installed-a4-cloud.md](installed-a4-cloud.md) — фактические результаты: run `c51da549-...` PASS 5 parent + 13 helper (business not run) — UI config/probe обоих облаков, один encrypted archive для обоих, destination-specific RESTORE для каждого облака с SHA/check, restart/owned cleanup. Fault run `bf1bf751-...` PASS 5 parent + 16 helper — неверный synthetic S3 key ID в isolated appconfig → Yandex fails + Mail.ru verified; восстановление config через UI/retry → тот же archive verified для обоих + restored from each. **Не** физический network cut / IAM changes. Ключи/email/bucket/prefix/скриншоты не сохранялись/не отправлялись.
- Исторические исправления: a982 client 500 и placeholder — исторические, исправлены `5b8613e` + `a4`.
- Production (shared business base a982, packaging-only a4 не требует дублирования): образ `02d8478e47dbbee51ab8632b4b9797046b8623e3910560f70b07d4cf9c467079`, Node 24.22.2. PostgreSQL 9/9 actual (3 роли + файлы/RBAC + реальный pg_dump/restore PASS); SQLite 22/22 (реальный encrypted restore + file SHA PASS). Начальное прерывание транспорта не PASS; завершённое восстановление — отдельно. Docker-стеки не затронуты.
- Ранее подтверждённые границы сохраняют силу: clean-archive `278b54f`/`11a2778` production/live-cloud/USB smoke в своих границах; [regression-20261107.md](regression-20261107.md), [excel-local-verification.md](excel-local-verification.md) (DT-22/23 PARTIAL), [installed-followup-20261107.md](installed-followup-20261107.md), [installed-71e8765.md](installed-71e8765.md).

## Карточки (фактические границы)

Каждая карточка содержит полное условие PASS. **PARTIAL** = весь критерий не доказан. **Ограниченный PASS** в этом README = доказанное подмножество/сценарий в указанных границах, **не** полный PASS карточки, если условие шире. Clean consumer Windows 10/11 VM — **BLOCKED** по решению пользователя.

| Карточка | Статус (ограниченно) | Основание |
|---|---|---|
| DT-01 | BLOCKED | Clean consumer Win10 22H2 VM не выполнялась (решение пользователя). Текущий Win11 + Actions Server не эквивалентны. |
| DT-02 | BLOCKED | Clean consumer Win11 VM не выполнялась. |
| DT-03–DT-05, DT-07–DT-08 | PARTIAL | Отдельные installed/CI факты есть (installer lifecycle 2022/2025 74 PASS/0 FAIL, a4 core restart/persist, backup/handoff границы из 71e/follow-up), но полный installed-путь/все подпункты карточек не закрыты. Текущий a4: local backup/restore 20/20 и handoff/conflict 61/61 PASS; [протокол](installed-a4-local.md). |
| DT-06 | PASS на синтетической копии | Полный перенос и запуск установленной CRM: 11 проверок, 85 таблиц, ID/связи/деньги/документ/версии шаблона; [протокол](DT-06.md). |
| DT-09 | **Ограниченный PASS** | a4 cloud run: UI config/probe, encrypted archive, destination-specific RESTORE + SHA/check, restart/owned cleanup в фактическом контуре. Не физический network cut, не все условия DT. |
| DT-10 | **Ограниченный PASS** | Аналогично DT-09 для второго облака в том же фактическом контуре. |
| DT-11 | **Ограниченный PASS** | Один encrypted archive verified для обоих облаков + restore из каждого (run `c51da549-...`), fault recovery с тем же архивом (run `bf1bf751-...`) — в границах прогонов. Не физический cut/IAM. |
| DT-12–DT-24 | PARTIAL | Смешанные доказательства (production/live/CI/installed границы, Excel verifier 24/24 local но UI/формулы в installed не закрыты). PG→SQLite проверен: [DT-06](DT-06.md). Installed Excel UI: 14/14 проверок PASS, 0 новых строк при повторе; [протокол](installed-a4-import.md). |
| DT-25 | PARTIAL | Ограниченный fault/recovery PASS в UI/конфиге (synthetic key ID) есть, но физический network cut / IAM / полный resilience-мatrix не доказан. |
| DT-26 | PARTIAL | Доказаны конкретные upload/restore/retry сценарии; полный набор cloud reliability/совместимости не закрыт. |
| DT-27 | PARTIAL | Совместимость/операционные границы частично покрыты; полного PASS нет. |

Полные карточки: [DT-01](DT-01.md)–[DT-27](DT-27.md). Модульный/ограниченный PASS **не** означает PASS полного DT или готовность v3.2.1.

## Оставшиеся gates

На a4 подтверждены локальный backup/rollback (20 проверок), handoff/conflict (61), PG→SQLite с запуском установленной CRM (11), Excel UI roundtrip (14) и пересчёт в Excel 16.0. Ограничения: физический обрыв/восстановление сети и полный native picker/tray/reboot/reminder matrix не проверены. Чистые потребительские Windows 10/11 VM — BLOCKED по решению пользователя. PG/SQLite production проверены на общем business-срезе a982; a4 меняет упаковку. P2 не является условием выпуска.

**Финальный статус:** частично проверенный кандидат, продолжать верификацию. Не объявлять весь релиз готовым.