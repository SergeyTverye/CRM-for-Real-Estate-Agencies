# QA десктопной версии CRM v3.2.3 — отчёт стенда `data-qa/desktop-profile`

Дата: 2026-11-09. Ветка `feature/v3.2.3-qa-desktop`. Все данные синтетические (`[QA-D323]`, телефоны `+7 900 001-*`, адреса вымышлены).
Профиль и данные лежат в `data-qa/` (gitignored), установленная программа пользователя и её данные не затрагивались.

## 1. Окружение

- Сборка: `src-tauri/resources/app` из репозитория (webpack-вариант `npm run desktop:bundle`, см. §7 отклонения), Node 24.15.0, Chromium из пакета, SQLite.
- Supervisor `app/supervisor.mjs` напрямую (`node/node.exe`), без окна Tauri: `LOCALAPPDATA=<профиль>/localappdata`, `APPDATA`, `TEMP/TMP`, `USERPROFILE/HOME` изолированы.
- Первый запуск: `/setup` (руководитель `d-manager`, режим `empty`), затем `scripts/demo/seed-realistic-desktop.ts` (гуарды: `DESKTOP_QA_SEED=1`, `CRM_DEPLOYMENT_MODE=desktop`, путь БД строго внутри `data-qa/desktop-profile`).
- Данные: 100 клиентов (70 физлиц + 30 компаний), 110 потребностей, 120 объектов (по 2 синтетических JPEG), 110 обращений, 70 подборов, 50 показов, ~150 задач, 10 КП (+PDF/DOCX), 6 сделок с 2 комиссиями, 12 договоров (+допсоглашение, PDF/DOCX), 20 объявлений (часть истекает ≤5 дней), 24 записи исторического архива.
- Секреты только через окружение, в отчёт и логи не печатались. `private-data` и реальный Excel не использовались (только `tests/fixtures/synthetic/workbook-like.xlsx`).

## 2. Сценарии (Playwright `tests/qa-desktop/`, конфиг `playwright.desktop.config.ts`)

| # | Сценарий | Итог |
|---|----------|------|
| D-01 | Вход/выход, неверный пароль 401, экран Сегодня | PASS (login 1,2 с) |
| D-02 | Входящий звонок → клиент → потребность → задача; дедупликация чужого телефона | PASS |
| D-03 | Конфликт оптимистичной блокировки 409; чужая потребность 403/404 | PASS |
| D-04 | Объект (UI), фото (multipart), доступ к контактам, показ → результат | PASS |
| D-05 | Перенос задачи (27 мс), календарь, уведомления воркера | PASS |
| D-06 | КП со снапшотами → отправка; печатная A4 (создание КП 38 мс) | PASS |
| D-07 | Сделка 2 стороны + 2 комиссии → закрытие → постсделочные задачи | PASS |
| D-08 | Договор + PDF, архив; реклама с истекающим сроком (32 с — самая долгая) | PASS |
| D-09 | Отчёты manager/detail (71/58 мс) + drill-down, скриншоты | PASS |
| D-10 | Импорт workbook-like (0 строк, без утечек) + enterprise-workbook (dry-run+mapping 843 мс → commit → без дублей) | PASS |
| D-11 | Поиск + локации, лимиты AI, настройки бэкапов | PASS |
| D-12 | RBAC: чужой клиент/документы/поиск/архив/админка недоступны | PASS |
| D-13 | SQLite: 111 клиентов / 121 потребность / 145 объектов / 247 задач / 7 сделок | PASS |
| OPS-01 | Backup create (10,6 МБ) → verify → мутация → restore → сверка | PASS |
| OPS-02 | USB-копия (sha256 каталога = файлу, CRMBKP1) | PASS |
| OPS-03 | Перенос на второй профиль, compare=incoming → restore; дивергенция обеих копий → compare=conflict, обе версии сохранены | PASS |
| OPS-04 | Экспорты DOCX/XLSX/PDF/ZIP (сигнатуры PK/%PDF, zip 115 КБ) | PASS |
| OPS-05 | Поиск 3 запуска (success/partial/empty), все HTTP 200, вежливо | PASS |
| OPS-06 | AI-бюджет 2 ₽: 3 платных вызова (2 parse + 1 чат), дельта 0,33 ₽ | PASS |
| OPS-07 | Воркеры: 50 уведомлений, 5 логов, один supervisor pid | PASS |
| OPS-08 | Офлайн (битый прокси): login 200, локальные данные 200, AI 422 без утечек | PASS |
| OPS-09 | Рестарт: 111 клиентов / 247 задач сохранены, pid сменился | PASS |

Замеры: холодный старт supervisor→ready 3,6 с; login 1,2 с; перенос задачи 27 мс; создание КП 38 мс; отчёты 71/58 мс; dry-run+mapping 843 мс; backup create ~12 с (10,7 МБ); backup restore ~31 с; DB SQLite 4 МБ; архив `.crmbackup` 10,7 МБ (CRMBKP1, sha256 каталога = файлу).

## 3. Замеры

- Холодный старт supervisor→ready: 3,6 с (повторно 3,6 с).
- Ключевые операции: login 1,2 с; перенос задачи 27 мс; создание КП 38 мс; отчёты manager/detail 71/58 мс; dry-run+mapping импорта 843 мс; D-08 (договор+PDF+архив+реклама) 32 с — самая долгая операция UI-сценариев.
- Backup create ~12 с (архив 10,7 МБ); backup verify/restore цикл ~31 с на restore.
- Размер БД SQLite 4 МБ; каталог файлов профиля ~десятки МБ (240 синтетических фото + документы); архив `.crmbackup` 10,7 МБ.
- Полный прогон: `data-qa/desktop-qa-result.json` (gitignored).

## 4. Найденные дефекты и исправления

1. (Сборка, окружение) Turbopack `next build` падает с `Could not find the Next.js package` во вложенном worktree (только стенд; CI с чистым checkout не затронут). Обход: тот же `build-desktop-bundle.mjs`, но шаг сборки `next build --webpack` (как в серверном QA). См. §7.
2. (Сборка, окружение) `copy-vc-runtime.ps1` требует vswhere/VS — на стенде нет; системного CRT (System32) достаточно, дымовой тест bundled node + better-sqlite3/argon2/sharp пройден. См. §7.
3. (Harness, не продукт) Неверный формат `recoveryKey` в QA-harness приводил к 503 `RECOVERY_KEY_INVALID` на create — исправлен формат `CRM1-<64hex>-<12hex>` по `newRecoveryKey` (`scripts/qa/run-desktop-qa.mjs`).
4. (Harness, не продукт) Опрос статуса restore умирал на 401: сессии заменяются вместе с БД — добавлен перелогин (`authed`). Поведение продукта корректно.
5. (Harness, не продукт) Параллельный запуск `vitest --project unit` во время QA уморил голодом холодный старт второго профиля (READY_TIMEOUT 120 с). Регламент: регрессию гнать отдельно от QA-прогона.
6. (Harness, не продукт) `GET /api/v1/export` требует manager — в harness экспорт шёл от риелтора (403). Исправлено на manager-сессию.
7. (Harness, не продукт) AI-вызовы возвращали 422: в настройках профиля `aiEnabled=false` (дефолт сида), 422=`DomainError`. Для AI-проверки включается явно + бюджет 2 ₽ → 3 платных вызова, дельта 0,33 ₽ (PASS).
8. (Спеки) Дубли скриншотов `requests-list` (снимался чужой page) и `rbac-search` (маршрута `/search` нет — поиск в шапке), кадр бэкапов в состоянии «Загрузка». Исправлено: съёмка правильного page, UI-тест глобального поиска через `aria-label="Глобальный поиск"`, ожидание региона «Локально».
9. (Продукт, исправлено) Неверный ключ восстановления в `POST control` давал 503 «проверьте сеть…» (`RECOVERY_KEY_INVALID` тонул в generic `InfrastructureError`). Исправлено: маппинг в понятную 400 «Неверный ключ восстановления…» (`backup-control.ts`) + регрессионный тест `tests/sqlite/backup-runtime.test.ts`.

Продуктовый код менялся только в п.9; остальное — QA-стенд и тесты.

## 5. Регрессия

- `tsc --noEmit`: PASS (0 ошибок).
- `eslint` (новые/изменённые файлы: сид, harness, спеки, конфиг, отчёт): PASS.
- `vitest --project unit`: 2161 passed, 5 skipped (совпадает с серверным QA).
- `vitest --project integration-sqlite`: 476 passed, 2 skipped (предсуществующего падения AI-тарифа больше нет — исправлен в HEAD).
- `vitest --config tests/desktop-backup/vitest.config.ts`: 8 файлов, 49 passed, 2 skipped.
- `test:integration:sqlite`:
- `tests/desktop-backup` (свой vitest.config.ts):

## 6. Ограничения

- Live-поиск по внешним площадкам: только demo-сценарии (`SCRAPER_DEMO_FIXTURES=true`); вежливые прогоны success/partial/empty — все HTTP 200, выдача пустая (0) без внешних creds.
- AI: 3 платных вызова (2 parse + 1 чат), дельта committed 0,33 ₽ при потолке профиля 2 ₽; `offer-text` — 422 (контекст КП не подошёл), в бюджет не входит. Ключи только из окружения.
- Восстановление проверено на изолированных профилях A/B (supervisor-only, без окна Tauri, headless Chromium из пакета).
- Офлайн: `HTTPS_PROXY=http://127.0.0.1:9` у supervisor — вход и локальные данные работают, внешний AI отвечает 422 без утечек секретов в теле.
- Скриншоты — только синтетика (`[QA-D323]`), секретов/паролей/ключей в кадре нет.
- `tsconfig.json`, `prisma/sqlite/schema.prisma` (перегенерированы сборкой) и `tests/fixtures/synthetic/workbook-like.xlsx` (unit-тест `private-import-profiler` регенерирует фикстуру на месте) не коммитятся, откачены.
- Регрессию и QA-прогон нельзя гнать параллельно: фоновые 2000+ unit-тестов уморили холодный старт второго профиля (READY_TIMEOUT); повтор без нагрузки — PASS.

## 7. Отклонения стенда от `npm run desktop:bundle`

1. Turbopack root-detection падает в worktree, вложенном в другой checkout (`D:/CRM-for-Real-Estate-Agencies/.worktrees/qa-desktop` внутри `D:/CRM-for-Real-Estate-Agencies` с собственным `package-lock.json`): `Could not find the Next.js package (next/package.json), Resolved from: .../src/app`. Продуктовый скрипт не менялся; QA-копия `data-qa/build-desktop-bundle.webpack.mjs` (gitignored) вызывает `next build --webpack` вместо `npm run build`. Остальные шаги (standalone→app, `npm ci`, esbuild-рантаймы, supervisor, Node/SHASUMS, Chromium, manifest, SBOM, guard, `checkFinalRuntime`) — без изменений, `DESKTOP_BUNDLE_READY` + все `FINAL_RUNTIME_*_PASS` получены.
2. Webpack-standalone не создаёт hashed-алиасы `.next-desktop/node_modules` (особенность Turbopack-standalone): шаг `refreshRuntimeAliases` пропущен в QA-копии (сервер резолвит зависимости из `app/node_modules` напрямую; `checkFinalRuntime` подтверждает готовность).
3. `copy-vc-runtime.ps1` пропущен (нет VS/vswhere на стенде); системный CRT проверен дымовым тестом.

## 8. Артефакты

- Скриншоты: `docs/thesis/screenshots/desktop/01–30-*.png` (2880×1800, viewport 1440×900 deviceScaleFactor 2) + `captions.json` [{file, caption, scenario}].
- Сид: `scripts/demo/seed-realistic-desktop.ts` (100/110/120/110/50/~150/10/6/12/20/24 сущности, 240 фото, 278 документов).
- Прогон: `scripts/qa/run-desktop-qa.mjs` (lifecycle, setup, сид, Playwright, бэкапы, перенос, офлайн, рестарт; AI — `data-qa/ai-followup.mjs` — вне коммита, gitignored).
- Спеки: `tests/qa-desktop/` (конфиг `playwright.desktop.config.ts`, `desktop-helpers.ts`, `desktop-qa.spec.ts` D-01–D-13).
- Временные данные: `data-qa/` (gitignored): профили A/B, usb-stick, `desktop-qa-result.json`, логи supervisor, `build-desktop-bundle.webpack.mjs` + `resume-desktop-bundle.mjs` (QA-копии шагов сборки).
- Собранный пакет `src-tauri/resources/app/` (gitignored через `src-tauri/.gitignore`) оставлен для повторных прогонов.
