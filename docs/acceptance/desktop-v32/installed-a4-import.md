# Installed a4 — synthetic Excel UI/import roundtrip (SQLite)

**Статус: ограниченный PASS для заявленного синтетического UI-сценария; DT-22/23 остаются PARTIAL.**

## Источник и границы

- Официальный installed a4: `a4a4120cd83b8f967b546472a25c8eb0909841de`, CI `42415838070`.
- Launcher SHA-256: `bc46de74eb9490deac0e666d238864e61b46d326883a425a97ca779556b48a86`.
- `resources` не патчились.
- Артефакт прогона: `data/qa-v32-installed-browser/run-9ffc2c40-5f70-4768-8cef-8f379b7acb1d/result.json`, SHA-256 `6241b93c566753b1d26a9b7e2ba977098ff43955beb6104bc7db799ccb8ccec8` (файл в private ignored `data/`, не выгружен).
- Terminal: PASS 5, parent 0 fail + 1 business NOT RUN, 14/14 helper flags PASS.
- Профиль: свежий синтетический. Installed Node `24.15.0` / SQLite `3.51.2`, exact installed packaged Chromium `156.0.8078.4` (supplied path), controller Node `22.23.4`.
- Режим: headless supervisor, без WebView. External browser HTTP requests = 0 (**не** физический offline на уровне ОС). Cleanup: `error: null`, restart выполнен, клиент persisted.
- Данные: только синтетика. Реальная книга/значения/ключи не обрабатывались; UI и native file picker по реальной книге **не заявляются**.

## Проверенный UI-цикл

| Шаг | Факт |
|---|---|
| Upload → initial dry-run | 4 секции + 2 unresolved |
| Remap профиля v2 | 0 unresolved |
| Preview | 4 допустимые строки с `validationStatus`; `commitResult = null`; **0 operational writes до commit** |
| Подтверждение и commit | оба UI checkbox; 4 imported, 0 skipped, 0 errors |
| Operational records | 9 (2 properties, 1 client, 1 agreement, 1 advertisement, 2 tasks, плюс need/lead) |
| Выгрузка | compatibility report + фактический XLSX: 4 листа, 1 поддерживаемая формула + 2 гиперссылки; заголовки запрещённых ПДн/синтетические sentinels отсутствуют |
| Reimport экспортированного XLSX (UI, custom profile) | 4 already-imported duplicate warnings; commit 0 новых строк; operational count остаётся 9 |
| Ignored sheet | сохранён как cleared geometry, не опущен |

## Артефакты (синтетика, private ignored `data/`)

- Исходная синтетическая книга: 10 656 байт, SHA-256 `055f8c971d4b08a71fe1796a357e14ac9abb3d3ada2ba08448ab012d252b0f18`.
- Экспортированный XLSX: 10 635 байт, SHA-256 `f5823f17dfd66843f2a2259fffd0b7ac24fc4c9127c777616bd5daa3ae610344`.
- Реальный скриншот, просмотрен и читаем: [synthetic import roundtrip](../../screenshots/vkr/v32-installed-9ffc2c40-5f70-4768-8cef-8f379b7acb1d-synthetic-import-roundtrip.png), рядом сохранён протокол `.md`.

## Нативный пересчёт

Нативный Excel 16.0: read-only пересчёт поддерживаемой формулы, изменение входа и обратное восстановление, неизменность формулы, Close(false), самостоятельное завершение собственной Excel-сессии и неизменность SHA-256 XLSX — PASS. Протокол `data/qa-v32-installed-browser/run-9ffc2c40-5f70-4768-8cef-8f379b7acb1d/import-cycle/excel-recalc/result.json`, SHA-256 `b5115992d8bf132028b3a3bc140f13ecc4616941e0acd051ef1c2b9763664efd`.

## Не доказано / не заявляется

- LibreOffice и произвольные неподдерживаемые формулы не проверялись.
- UI/native file picker по реальной книге, физический offline на уровне ОС, полный нативный WebView walkthrough.
- Сохранение старых ограничений: 104 неоднозначные/128 скрытых строки реальной книги, неподдерживаемые колонки/поля/engine limits и factual условия, не подтверждённые этим прогоном.
- Весь релиз v3.2.1 **не** PASS.

## Связь с карточками

- [DT-22](DT-22.md), [DT-23](DT-23.md) — обновлены с учётом этого доказательства, статус PARTIAL сохранён.
- [excel-local-verification.md](excel-local-verification.md) — доверенный verifier по реальной книге: 127 поддерживаемых строк, 0 расхождений, повторный импорт без новых записей (PG+SQLite).
