# Приёмка CRM v3.2.1

Нормативный источник: `ТЗ_CRM_v3.2.1_standalone_SQLite_облака_импорт_защита.md`. Ветка: `feature/desktop-v3.2`; исходные ветки не меняются. Проверки на ранних коммитах не доказывают готовность будущего установщика.

## Текущее состояние — 2026-11-07

- Последний опубликованный срез по подтверждению координатора: `b4a9e27`. Windows CI `7e7e47e`, run `42293184755`: unit, SQLite и desktop bundle/artifact guard прошли; на момент среза компилируется NSIS, EXE/checksum ещё не подтверждены. Следующий run для `b4a9e27` в очереди; его успех не заявляется.
- Чистых потребительских Windows VM не будет по решению пользователя. Проверки на этом Windows 11 ПК и Windows Server 2022/2025 в Actions выполняются отдельно; DT-01/02 остаются BLOCKED в части чистых Windows 10/11.
- [Облачный модульный LIVE](cloud-module-live.md): один архив 7 354 253 байта, два облака, два восстановления с проверкой БД/файла; очередь, failed-only retry и два инъецированных отказа PASS. Предыдущие UI read/list probes 2/2 — отдельная проверка, не restore установленной CRM.
- [Доверенная локальная проверка Excel](excel-local-verification.md): PostgreSQL и SQLite, на каждом все 24 булевы проверки = 1, `errors={}`; 122 импортированных строки, 0 необъяснимых потерь/расхождений проверяемых полей. Неоднозначные отклонённые строки и неподдерживаемая контрольная таблица оставляют DT-22/23 PARTIAL. Закрытый профиль исправлен координатором и не публикуется.
- [USB DT-08](DT-08.md): физический USB E:, Disk 2; модульные copy/decrypt/restore и контрольный файл 7 MiB PASS. Извлечение только инъецировано, установленный picker не проверен.
- [Server production](server-production.md): актуальный ограниченный clean-image gate PASS на APP_COMMIT `11a27784bdead108483ca058bfa72179597fb8fe`, image `sha256:965356828d986cddf1f61ffd175e4629b124b0f4e31d9dad2502cbadd2e60d8e`. Три одновременные сессии, RBAC/документы, импорт/экспорт, restart, настоящий pg_dump/verify и изолированный pg_restore с проверкой входов/записей/файла прошли. Это не проверка последнего `b4a9e27` или полный DT-21.
- [SQLite production](sqlite-production.md): тот же image/APP_COMMIT, Linux Docker без PostgreSQL и внешней сети; 22 PASS / 0 FAIL, включая CRM-путь, DOCX/PDF/XLSX, RBAC, restart и реальное восстановление зашифрованного архива. Не Windows launcher/DPAPI/picker и не полный DT-05/17.
- [Итоговая регрессия](regression-final.md): unit/browser 1514 PASS / 5 skip; исходно PG 362 PASS / 1 harness FAIL, SQLite 384 PASS / 1 такой же harness FAIL / 1 skip. Прямой повтор координатора 4/4 PASS за 33.32 s снял оба отказа обвязки: покрытие PG 363/363, SQLite 385 PASS / 1 skip **по full-run плюс точечному повтору**, не новый единый зелёный full-run. Desktop backup 46 PASS / 2 MinIO skip, cloud synthetic 10 PASS, USB synthetic 4 PASS, backup UI 3 server + 3 desktop PASS. QA host Node 22.23.4, production image Node 24.22.2, Windows CI Node 24.15.0 — разные окружения.
- Targeted export — 14 PASS всего (7 PostgreSQL + 7 SQLite), не 14 на каждой БД. Parser 64 PASS / 5 optional skip; переданные tsc/lint PASS не являются частью итогового QA. В локальном Excel формул 0: это не доказательство сохранения формул.
- Native budget cap=4 и shared lock включены в `b4a9e27`. Восстановление dead-PID lock (отдельный набор 44 теста) и autocleanup по подтверждению координатора ещё реализуются, не закоммичены; готовность не заявляется. [Security review](security-review.md): подтверждённых P0/P1 (CRITICAL/HIGH) в проверенной области нет, но Windows lifecycle, ACL, диалоги и дочерние процессы фактически не доказаны. Три скриншота — DEMO, не доказательство установки.

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
