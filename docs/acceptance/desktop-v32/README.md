# Приёмка CRM v3.2.1

Нормативный источник: `ТЗ_CRM_v3.2.1_standalone_SQLite_облака_импорт_защита.md`. Изменения feature-веток объединены в `main` по поручению пользователя. Проверки на ранних коммитах не доказывают готовность будущего установщика.

## Текущее состояние — 2026-11-07

- `main`: `278b54f`. Исправления разработки сохранены в `codex/desktop-installer-fix` и объединены без переписывания истории. [Windows-сборка](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42392607372) остановилась на final readiness после успешного init; новый EXE пока не подтверждён. Причина воспроизводится локально на закреплённом Node24.
- Скачанный EXE `41c39b8` в `releases/windows-x64/` не готов к выпуску. Установка проходит, внутренних ТЗ/AGENTS/исходников нет, но отсутствовали hashed Next dependency aliases. Диагностическое восстановление aliases открыло native setup; это не приёмка неизменённого установщика.
- CI `1d02f18`: 1747 unit PASS / 5 skip; SQLite 398 PASS / 1 skip; финальные INIT/READY/PRISMA PASS. Исправлен неверный GET теста к POST-only backup API. Следующая сборка сохраняет полный финальный init/API/assets gate и дополнительно ограничивает устанавливаемые assets.
- Локальная независимая регрессия: PostgreSQL 380 PASS; SQLite 402 PASS / 1 server-only skip. По два private-verifier теста явно исключены из делегированного контура. Реальный portable Chromium; Node22 соответствует локальному native ABI. Источники production не менялись во время прогона, но два test/packaging файла менялись: clean-SHA и Node24 certification не заявляются.
- [Реальная книга](excel-local-verification.md): trusted local PG и SQLite verifier 24/24; 127 поддержанных строк, 0 расхождений roundtrip / новых записей reimport. 104 неоднозначные строки отклонены, 128 hidden исключены; unsupported элементы и installed пользовательский flow оставляют DT-22/23 PARTIAL. Формул в реальной книге нет; bounded subset проверен отдельно синтетикой.
- Прежние [Node24 PostgreSQL production](server-production.md), [SQLite production](sqlite-production.md), [LIVE cloud module](cloud-module-live.md) и USB проверки имеют свои SHA/границы. Они не доказывают новую установленную GUI-версию. Новый clean-archive production image `278b54f` прошёл PG9/9 и SQLite22/22 с реальным restore; см. [актуальную регрессию](regression-20261107.md).
- Чистых Windows 10/11 VM не будет по решению пользователя; DT-01/02 и чистые VM-части DT-18 остаются BLOCKED. Этот Windows 11 ПК и Actions Windows Server — отдельное подтверждение. Остальные неполные DT имеют PARTIAL, цель не объявлена завершённой.

## Карточки

Каждая карточка содержит полное условие PASS. PARTIAL означает, что весь критерий пока не доказан, а не что можно выпускать продукт как готовый.

| Группа | Карточки |
|---|---|
| Установка, запуск, автономные сценарии | [DT-01](DT-01.md), [DT-02](DT-02.md), [DT-03](DT-03.md), [DT-04](DT-04.md) |
| SQLite, права, перенос PostgreSQL | [DT-05](DT-05.md), [DT-06](DT-06.md) |
| Локальные копии, USB, облака и очередь | [DT-07](DT-07.md), [DT-08](DT-08.md), [DT-09](DT-09.md), [DT-10](DT-10.md), [DT-11](DT-11.md), [DT-12](DT-12.md) |
| Перенос состояния, конфликт, обновление, supervisor | [DT-13](DT-13.md), [DT-14](DT-14.md), [DT-15](DT-15.md), [DT-16](DT-16.md) |
| Регрессия, выпуск, удаление и серверный режим | [DT-17](DT-17.md), [DT-18](DT-18.md), [DT-19](DT-19.md), [DT-20](DT-20.md), [DT-21](DT-21.md) |
| Защищённый Excel | [DT-22](DT-22.md), [DT-23](DT-23.md), [DT-24](DT-24.md) |
| Надёжность облаков и совместимость | [DT-25](DT-25.md), [DT-26](DT-26.md), [DT-27](DT-27.md) |

Оставшиеся gates: завершение CI последнего среза и EXE с checksum → фактический lifecycle установки/обновления/удаления → полный production/release gate обеих БД → restore и перенос через установленную CRM → финальная матрица. Полные PG/SQLite DT остаются PARTIAL. Чистые Windows 10/11 по-прежнему BLOCKED; текущий ПК и Actions Windows Server не заменяют их. P2 не является условием этого выпуска.

Источники этой редакции — публичные отчёты и обезличенные подтверждения координатора из задания. Проверки не перезапускались, закрытые файлы не читались. Модульный PASS нигде не означает PASS полного DT или готовность v3.2.1.
