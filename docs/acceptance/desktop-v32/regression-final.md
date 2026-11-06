# v32 — итоговая синтетическая QA-регрессия

## Повтор координатора после QA-harness

07.11.2026 локально выполнен только отказавший synthetic CLI-набор без перенаправления его защищённого scratch: `vitest run --project integration --project integration-sqlite tests/integration/private-workbook-verifier.test.ts`, PostgreSQL `crm_test_b`. Результат: **4/4 PASS**, по 2 теста на PostgreSQL и SQLite, 33.32 s. Это снимает два описанных ниже отказа обвязки; прежние неуспешные прогоны сохранены. Коммерческая книга этим тестом не читается. Остальной полный набор повторно не запускался: итоговое покрытие составляет PG 363/363 и SQLite 385 PASS / 1 server-only skip с учётом точечного повтора, а не новый единый зелёный full-run.

Дата отчёта: 2026-11-07. Shared checkout: `D:/CRM-for-Real-Estate-Agencies`.

## Границы и окружение

- Только существующие зависимости/сгенерированные клиенты; без install, generation, full Next build и изменений продуктового кода/конфигурации.
- Node основного прогона: `v22.23.4`. Требование package engines: >=24. Доступный Node 24.22.1 не совместим с установленным better-sqlite3: ABI 127 вместо требуемого 137; desktop UI seed на нём завершился ERR_DLOPEN_FAILED. Rebuild/install не выполнялись.
- Основные PG suites: `127.0.0.1:55432/crm_test_a`; DATABASE_URL и TEST_DATABASE_URL одинаковы. Server UI: разрешённая координатором crm_test_f. Позднее также разрешены postgres/crm_private_verify только для synthetic verifier. Пароли намеренно не приводятся.
- Очищенный allowlist env, preload блокирует чтение приватных env-файлов; dotenv config возвращает пустой результат. Приватные checkout roots не читаются; обращения тестового CLI перенаправлены в собственный scratch.
- Windows x64, 12 logical CPUs, 32 GiB RAM. Scratch: собственные каталоги os.tmpdir и `data/qa-v32-final`. Worker=1, file parallelism off, heap ceiling 4096 MiB, timeout 30 минут на Vitest suite. Наборы выполнялись последовательно.
- QA guards — только в `data/qa-v32-final`; исходные тесты не ослаблялись и не исправлялись. Failures под guard не равны подтверждённому дефекту продукта. Git команды внутри disposable synthetic test fixtures относятся только к собственным временным репозиториям; Git shared checkout не изменялся.

## Итоги Vitest

Итог с двумя UI-режимами: **2326 PASS, 2 FAIL (один и тот же QA-guard-related verifier в PG и SQLite), 8 skipped**. Регрессия не полностью зелёная; продуктовый дефект по этим двум падениям не подтверждён.

| Набор | Exit | Tests | PASS | FAIL | Pending/skip | TODO | Failed suites | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| unit-browser | 0 | 1519 | 1514 | 0 | 5 | 0 | 0 | 232 |
| pg | 1 | 363 | 362 | 1 | 0 | 0 | 1 | 328 |
| sqlite | 1 | 386 | 384 | 1 | 1 | 0 | 1 | 333 |
| desktop-backup | 0 | 48 | 46 | 0 | 2 | 0 | 0 | 30 |
| cloud-live | 0 | 10 | 10 | 0 | 0 | 0 | 0 | 12 |
| usb-live | 0 | 4 | 4 | 0 | 0 | 0 | 0 | 4 |

## Команды

Оркестратор: `node data/qa-v32-final/run.cjs` (явное synthetic env + preload).

```text
node node_modules/vitest/vitest.mjs run --project unit --project browser-cycle --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=data/qa-v32-final\unit-browser.json
node node_modules/vitest/vitest.mjs run --project integration --project authorization --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=data/qa-v32-final\pg.json
node node_modules/vitest/vitest.mjs run --project integration-sqlite --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=data/qa-v32-final\sqlite.json
node node_modules/vitest/vitest.mjs run --config tests/desktop-backup/vitest.config.ts --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=data/qa-v32-final\desktop-backup.json
node node_modules/vitest/vitest.mjs run --config tests/cloud-live/vitest.config.ts --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=data/qa-v32-final\cloud-live.json
node node_modules/vitest/vitest.mjs run --config tests/usb-live/vitest.config.mts --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=data/qa-v32-final\usb-live.json
node data/qa-v32-final/run-ui.cjs
node data/qa-v32-final/run-ui-server.cjs
```

USB config в checkout имеет расширение `.mts`; использован фактический `tests/usb-live/vitest.config.mts` вместо несуществующего `.ts`.

## Backup UI

- Server: после явного разрешения координатора crm_test_f запущен существующий harness с QA-owned wrapper; 3 PASS, 0 FAIL, 0 skipped.
- Desktop: выполнен запуск оригинального testMatch/setup с QA-owned wrapper config; distDir, outputDir и tsconfig помещены в собственный scratch, без full build.
- Desktop statistics: `{"startTime":"2026-11-06T20:54:24.620Z","duration":60350.742000000006,"expected":3,"skipped":0,"unexpected":0,"flaky":0}`.
- Desktop runner: `{"exit":0,"seconds":62}`.
- Server statistics: `{"startTime":"2026-11-06T21:07:11.026Z","duration":66337.71399999999,"expected":3,"skipped":0,"unexpected":0,"flaky":0}`.

## Завершение и конкурентный запуск

- Исходный оркестратор PID 10764 и PG child 11648 проверены явно. Оба завершены; оставшиеся SQLite/desktop-backup/cloud-live/usb-live завершены foreground-командой с exit results. Фоновых полных QA suites не оставлено.
- Случайный конкурентный запуск, остановленный координатором, дал PG deadlock 40P01 при DROP SCHEMA. Это test-race, не продуктовый дефект; evidence сохранено отдельно в pg-race.log / pg-race.json.
- Полный исходный PG-прогон завершил 363 теста: 362 PASS, один guard-related FAIL verifier. Deadlock не является причиной этого результата, поэтому повтор полного PG не выполнялся. Unit/browser не дублировался.
- Наборы запускались без изменений продуктового кода. Исправления portability от координатора и отдельный production acceptance не заявляются результатом этого QA-прогона.


## Ограничения и evidence

- Cloud/USB — синтетические suites, не запуск реальных облачных аккаунтов/USB smoke. Реальные credentials и clouds.env не читались.
- Optional MinIO tests используют штатный opt-in DESKTOP_MINIO_TEST; в этом ограниченном прогоне он выключен. Skip counts не считаются PASS.
- Private workbook verifier требует private-data/verify-tmp и отдельную crm_private_verify/admin postgres. QA запрещает выход из выделенных roots/БД; такой результат отражает несовместимость harness с границами запуска. Preload возвращает физический realpath перенаправленного scratch; trusted CLI штатно отклоняет redirected workspace, без ослабления его safety checks.
- Машиночитаемые counts и public failure stacks: `data/qa-v32-final/{unit-browser,pg,sqlite,desktop-backup,cloud-live,usb-live}.json` и соответствующие `.log`; UI: `ui-desktop.json`, `ui-desktop.log`.
- Не выполнялись общий lint/typecheck/build, реальные миграции/бэкапы приложения и иные приёмочные сценарии вне заданного QA scope.

## Failures: pg

### trusted CLI: full synthetic cycle, numeric-only output, no source strings, cleanup

```text
AssertionError: expected { ARGUMENTS_FAILED: 1 } to deeply equal {}
    at D:/CRM-for-Real-Estate-Agencies/tests/integration/private-workbook-verifier.test.ts:37:27
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///D:/CRM-for-Real-Estate-Agencies/node_modules/vitest/dist/chunks/run.CjdgFZiW.js:2801:20
```

## Failures: sqlite

### trusted CLI: full synthetic cycle, numeric-only output, no source strings, cleanup

```text
AssertionError: expected { ARGUMENTS_FAILED: 1 } to deeply equal {}
    at D:/CRM-for-Real-Estate-Agencies/tests/integration/private-workbook-verifier.test.ts:37:27
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///D:/CRM-for-Real-Estate-Agencies/node_modules/vitest/dist/chunks/run.CjdgFZiW.js:2801:20
```
