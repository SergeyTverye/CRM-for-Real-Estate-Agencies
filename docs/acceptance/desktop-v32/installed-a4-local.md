# Установленная a4: локальное восстановление и передача базы

Дата испытания: 2026-11-08. Проверены синтетические профили установленной CRM на текущем Windows 11 ПК.

## Границы прогона

- Текущий установленный launcher: SHA-256 `bc46de74eb9490deac0e666d238864e61b46d326883a425a97ca779556b48a86` (официальный EXE `a4a4120cd83b8f967b546472a25c8eb0909841de`, CI [42415838070](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42415838070)). Патчи установленных ресурсов **не применялись**.
- Среда: Windows 11, текущий ПК. Координатор последовательно выполнил существующие скрипты; оба завершились с **exit 0**.
- Данные: только синтетика; пользовательские профили/данные не использовались.
- **Не доказано:** штатный GUI, реальный Windows file picker (`actualWindowsPickerTested=false`), native ReplayNativeMailbox/desktop control, USB-флаги, физическая чистая установка на отдельной машине, перенос/конфликт на двух физических компьютерах, автономная работа второго ПК в пользовательском UI. Browser `0 external HTTP` (если применимо к другим прогонам) не эквивалентно физическому offline — к этому документу не относится.

## 1. Installed workflows (backup/verify/restore)

Скрипт: [`scripts/desktop/test-installed-workflows.ps1`](../../../scripts/desktop/test-installed-workflows.ps1). Safe report (координатор): `data/qa-v32-installed/run-20261107T223159831Z-5e8d2e37/safe-report.json`, SHA-256 `6144bc732988491bceee25cd3642cd4f72cb82137a490dc21a85a80b98e61e6d`.

| Область | Факт |
|---|---|
| Итог | `installedWorkflowPassed=true`, **20 passed / 0 failed** |
| Границы | `actualWindowsPickerTested=false`, `handoffTested=false` |
| Runtime | own loopback ready, bundled Node 24 — PASS |
| Setup/данные | fresh synthetic setup, document SHA — PASS |
| Backup/control | command queue + results, supervisor restart, encrypted archive size + SHA — PASS |
| Restore | mutation before rollback, protective backup, client restored + document SHA — PASS |
| Cleanup | own launcher exit — PASS |
| Архив | 1 849 210 bytes, SHA-256 `8d35082e8bee81efcd71e1b3d88bacfa6314d9a06652750ae2aad7b2985f6bee` |

**Важно (граница restore):** это **exact installed fresh synthetic profile with protective rollback** под supervisor/API. **Не заявляется** «восстановление в чистую новую установку» в пользовательском смысле (отдельная установка + Windows picker + ручной выбор внешнего архива). Исторические доказательства других билдов остаются валидными только в своих границах.

## 2. Installed handoff (A→B→A, конфликт)

Скрипт: [`scripts/desktop/test-installed-handoff.ps1`](../../../scripts/desktop/test-installed-handoff.ps1). Safe report (координатор): `data/qa-v32-handoff-6e3d2af7-8b86-47d2-862b-c895bb1f8cd4/safe-report.json`, SHA-256 `faa1ebbc4e8737aeed34bb999f9ee54cfe49b0f5515f3582b0083224202f29c0`.

| Область | Факт |
|---|---|
| Итог | `outcome=PASS`, **61 passed / 0 failed**, `gates=[]` |
| Границы | `normalGuiProven=false`, `actualWindowsPickerTested=false` |
| Сценарий (по публичному исходнику/фактам) | последовательные fresh synthetic A/B/C профили, A→B→A, client + document SHA, active/standby writes, конфликт и сохранённые версии |
| Среда | **один** актуальный Windows 11 ПК, real installed launcher/supervisor/API; **не** два физических компьютера |
| Teardown | только собственные process handles; без shared shutdown/name kills; без user profile data |
| Флаги/инструменты | без USB flags, без native ReplayNativeMailbox, без desktop control |

**Важно:** 61 PASS относится ко всему handoff/conflict suite, а не к одному конфликтному действию. Удалённые/облачные installed-тесты вынесены отдельно ([installed-a4-cloud.md](installed-a4-cloud.md), если опубликован) и в этот документ не включаются.

## Связанные доказательства (отдельные границы)

- [installed-a4-core.md](installed-a4-core.md) — a4 packaged browser/supervisor, ограниченный PASS.
- [installed-71e8765.md](installed-71e8765.md), [installed-followup-20261107.md](installed-followup-20261107.md) — исторические/предыдущие installed границы.
- [release-artifacts.md](../../desktop/release-artifacts.md) — артефакты релиза.

## Итог

В границах предоставленных координатором фактов на exact installed launcher a4 подтверждены supervisor/API backup+verify+restore (20/20) и A→B→A+conflict suite (61/61) на одном ПК с синтетическими профилями. Полные DT-07/DT-13/DT-14 **не закрыты**: требуется пользовательский GUI/picker, восстановление в отдельную чистую установку/пользовательский выбор внешнего архива, два физических ПК и UI-разрешение конфликта — где применимо.
