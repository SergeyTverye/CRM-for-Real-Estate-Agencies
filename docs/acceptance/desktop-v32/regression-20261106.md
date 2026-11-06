# Двойная регрессия — 2026-11-06

Проверка рабочего дерева на основе ba8d271, Node 22.23.4 / Windows 11; PostgreSQL 18.6 в изолированном Docker testdb. Это локальные проверки и не заменяют Node 24/production/installer gates.

- pg: 356 PASS, 0 FAIL, 0 SKIP; success=true
- sqlite: 375 PASS, 0 FAIL, 1 SKIP; success=true

Команды: `vitest run --project integration --project authorization --reporter=json` с TEST_DATABASE_URL=crm_test_a и `vitest run --project integration-sqlite --reporter=json`. Изолированные исходные отчёты находятся в ignored data/qa-v32-20261106-release/. PostgreSQL и SQLite полные прогоны завершились успешно. Единственный SQLite skip — server-only ветка backup packaging; не является проверкой PostgreSQL restore.

Targeted Excel CLI после исправления raw contact export: PG 14/14, SQLite 14/14; форма mapping 7/7, общий tsc PASS. Первый неуспешный полный прогон сохранён в журнале; он не объявлялся PASS.

Более позднее исправление empty-workspace handoff требует собственного теста. Реальное восстановление установленной desktop CRM, production E2E двух режимов, три одновременных пользователя PostgreSQL и чистый deploy/restore проверяются отдельно.
