# Installed follow-up — 2026-11-07

Проверенный установленный binary: `71e8765`, EXE SHA-256 `a3e5ab26cbe6bcd249f2f222994052c4f985541c46b81910b9221d3262be311e`. Только отдельные синтетические профили; программные ресурсы установки не подменялись.

## Подтверждено

- Installed backup/verify/restore: 20 boolean PASS, 0 FAIL; архив 1 849 210 байт, реальная защитная копия, клиент и документ/SHA после восстановления. `data/qa-v32-installed/run-20261107T183759099Z-0c5e379b/safe-report.json`.
- Installed A→B→A и конфликт расходящейся C: 61 boolean PASS, 0 FAIL; документ/SHA, локальная идентификация, standby guard и собственное завершение процессов. `data/qa-v32-handoff-80de3d71-19bc-4933-b052-f25b9277a865/safe-report.json`.
- Облачный UI: оба направления настроены и проверены, credentials хранятся Windows DPAPI; один архив загрузился в Yandex и Mail.ru, обе строки очереди verified, ID/SHA/size совпали с каталогом. Восстановление не завершено: после выбора архива не открывалась форма восстановления. Прогоны `cfbfc14f-d762-432c-8318-653a18bb7d07` и `f629e071-e575-433c-996b-cd03142825d6` остаются FAIL, а не PASS облачного DT.

## Исправление UI

Коммит `47b8e9ba200c3f2efc04c8647003bb119873207c`: общий Modal отличает программное закрытие от нового запроса пользователя. Закрытие списка больше не сбрасывает следующую форму. Сохранены X, Escape и настоящее native close.

5 unit PASS; typecheck и scoped lint PASS. Независимый синтетический Chromium-стенд извлекает точное AST-тело настоящего Modal: исходный вариант провалил 5/7 сценариев, исправленный прошёл 7/7. Проверены переход списка к восстановлению, идентификатор архива, X/Escape ровно один раз, native close, быстрые reopen и порядок событий. Это source/React/Chromium proof, не подтверждение нового установленного EXE.

[Новая Windows CI](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42406886907) ещё выполняется. Предыдущий [bf8538d run](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42403535722) полностью SUCCESS: build и installer lifecycle на Windows Server 2022/2025, включая удаление устаревших программных ресурсов при overinstall. Consumer Windows VM по решению пользователя отсутствуют.

## Production bf8538d

Один чистый build публичного Git archive `bf8538dda8ddae3a3a35eddf24b3d95ba2a8be24`, image `crm-app:v32-clean-bf8538d`, ID `sha256:0e91c62a5c925be2468753134b9c98a2c8d0eca9ca9efc5573cc1ce55bd5cfea`. Build exit0; PostgreSQL 9/9, SQLite 22/22, terminal exit0 обоих harness. Реально восстановлены БД и файлы; все собственные контейнеры завершены, volumes сохранены. Пользовательские stacks не затронуты.

Результаты: `data/qa-v32-prod-build/ab2973db-409e-43a2-a668-e9fe6e7eeb67/context/data/qa-v32-prod/2026-11-07T19-27-19-402Z/result.json` (SHA `d2b045e6bbc3474059427b4f0b6149ab314f500945022430fad6dbdd0b9b6a57`) и `context/data/qa-v32-sqliteprod/2026-11-07T19-29-16-911Z/results.json` (SHA `666c449f2f18f13adeb43acdf5b47aa8e78ecfbd6fb2b64442ed7ec2998bc0e8`). Это bounded production proof bf8538d, не exact-SHA сертификация 47b8e9b.

## Оставшиеся границы

Системный диалог экспорта открывался, но CUA не подтвердил сохранение; были ошибки foreground/geometry. Не засчитаны native picker, USB GUI и чистая установка consumer Windows. Подмены native mailbox для PASS не было. Управление рабочим столом освобождено по обращению пользователя; последующие проверки выполняются headless через существующий smoke supervisor и не доказывают native WebView.

Проверка новых EXE, облачного восстановления и всей матрицы DT ещё не завершена. Непроверенные функции готовыми не объявляются.
