# Регрессия 7 ноября 2026

Официальный новый EXE пока не прошёл выпускной gate. Результаты ниже имеют разные окружения и не суммируются в единый clean-SHA прогон.

| Контур | Результат | Граница |
|---|---|---|
| Локальный PostgreSQL integration/authorization | 380 PASS, 0 FAIL | Node22.23.4/ABI127, PostgreSQL18.6, реальный portable Chromium; 64 файла |
| Локальный SQLite integration/authorization/SQLite-specific | 402 PASS, 1 существующий server-only skip | Node22.23.4/ABI127; 70 файлов |
| Дополнительный trusted synthetic verifier CLI | PG2/2 и SQLite2/2 PASS | Координатор, только синтетическая книга, 0 unhandled; ранее исключённые из делегированного контура случаи |
| Windows CI `278b54f` | 1750 unit PASS /5 skip; 398 SQLite PASS /1 skip | Node24.15.0; финальный package init PASS, ready FAIL, EXE не собран |
| Node24 production PostgreSQL | 9 PASS, 0 FAIL | Чистый Git-архив `278b54f`, 3 одновременных пользователя, реальное pg_dump/restore и файлы |
| Node24 production SQLite | 22 PASS, 0 FAIL | Тот же образ, local business cycle, реальные документы, restart и encrypted restore |
| Текущие TypeScript / ESLint | PASS | `tsc --noEmit --incremental`; ESLint src/scripts/tests/prisma и конфигурации, затем изменённые acceptance harnesses |

Локальный полный интеграционный прогон использовал отдельную UUID PostgreSQL БД, прямое применение восьми SQL-миграций без dotenv/Prisma CLI и настоящие SQLite миграции/шаблоны. PostgreSQL БД удалена, browser profiles отсутствовали перед очисткой собственного temp. Никакие реальные записи или внешние провайдеры в этом контуре не использовались.

Production `src/` hashes не менялись во время этого полного прогона, но менялись browser test и resource-policy. Это не проверка чистого коммита; точный SHA запуска и снимки файлов сохранены в `data/coordination/dual-regression/34e7719a-9dde-4883-a8cf-cee62b27e0fd/`. После фикса синхронизации UI отдельно прошёл весь browser-cycle файл: 6/6, реальные Chromium и React viewer. Portable Chromium впоследствии заменён в тестовом коде переносимым выбором env/Playwright; installed Chromium ещё не проверен.

Production образ: `sha256:6b7e74e253117858af9585f8be33a2f7d1033bb76897c9d28a6ef3917554bd17`, Node24.22.2, exact APP_COMMIT `278b54f0cbc003a1c87e492e0851b73ec93ba60d`. Подробности: [PostgreSQL](server-production.md), [SQLite](sqlite-production.md). Эти проверки не доказывают Windows launcher/DPAPI, native picker, clean Windows VM и весь набор DT.

Закрытая книга проверена отдельно доверенным локальным кодом на обеих БД: [протокол](excel-local-verification.md). Она не использовалась агентами, CI и синтетическими тестами.
