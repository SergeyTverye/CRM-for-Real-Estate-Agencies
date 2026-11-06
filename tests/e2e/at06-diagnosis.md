# AT-06: гонка с завершением DEMO-задания

Диагностика 06.11.2026, production `next start`, `NEXT_DIST_DIR=.next-build`,
изолированная БД `crm_e2e`, один Playwright worker, retries=0.

## Воспроизведение

Первые четыре полных `npx playwright test` прошли (25 PASS, 1 opt-in REPLAY skip).
Пятый полный прогон: 24 PASS, 1 FAIL (AT-06), 1 skip.
Локальный игнорируемый журнал: `tests/e2e/at06-diagnostic-full-5.log`.
Без cookies, паролей, заголовков авторизации и тел бизнес-запросов.

| Время UTC | Наблюдение |
|---|---|
| 05:36:17.257 | progress: running, cancelRequested=false, source queued |
| 05:36:17.354 | браузер отправил POST /cancel |
| 05:36:17.364 | Playwright click завершился успешно |
| 05:36:17.424 | progress: running, cancelRequested=false, source success |
| 05:36:17.486 | cancel HTTP 200: completed, cancelRequested=false |
| 05:36:17.551–31.715 | progress: completed, cancelRequested=false, source success |

Capture-события pointerdown/pointerup/click все пришли на кнопку «Остановить».
Гидратация, промах указателя, Origin/CSRF и потеря cancel worker-ом не объясняют
этот сбой: успешное завершение опередило изменение строки в cancelSearch.
Для завершённого задания cancel закономерно не меняет статус и не устанавливает
cancelRequested. Прежняя защита теста учитывала terminal только до появления
кнопки; при stopShown=true она требовала флаг даже после успешного завершения.

## Исправление тестовой фикстуры

AT-06 резервирует настоящий PostgreSQL durable claim slot (advisory lock 310105)
до постановки задания и отмены. Worker остаётся штатным; записи БД и ответы API
не подменяются. Изолированный crm_e2e проверяется до подключения. Закрытие
соединения в finally освобождает lock и при ошибке.

Тест требует queued до клика, реальный POST из браузера, HTTP 200,
cancelRequested=true, status=partial и source=cancelled; проверяет прогресс
после освобождения worker. Убраны подавление ошибок клика и terminal fallback.
Диагностика статусов и cancel-ответа прилагается к отчёту Playwright как JSON.

Интеграционные проверки дополнительно фиксируют queued cancel → невозможность
последующего claim и completed → cancel no-op с сохранением результатов.
Существующий тест running cancel проверяет AbortSignal и сохранение снимков.

## Проверки после исправления

- Три подряд полных production-прогона `NEXT_DIST_DIR=.next-build npx playwright test`:
  каждый **25 PASS, 1 штатный opt-in REPLAY skip, 0 FAIL**, exit 0, retries=0.
  Локальные журналы: `tests/e2e/at06-fixed-full-1.log`, `at06-fixed-full-2.log`,
  `at06-fixed-full-3.log`. Каждый запуск заново готовил crm_e2e и поднимал
  production next start + штатный search worker. AT-06 во всех трёх получил
  HTTP 200, partial, cancelRequested=true, cian=cancelled.
- `npx vitest run --project integration tests/integration/property-search-server-v31.test.ts`
  на crm_test_d: **23/23 PASS**, включая обе добавленные регрессии и running cancel.
- `npx tsc --noEmit --pretty false`: PASS.
- Scoped ESLint двух изменённых TS-файлов с `--max-warnings=0`: PASS.
- `git diff --check` изменённых тестов: PASS; tsconfig.json без diff.
- Изменены только E2E-тест, две integration-регрессии и этот протокол.
  Product queue/UI/worker, схема и зависимости не менялись; `.next` не изменялся.
  Коммиты не создавались. Процессы production E2E завершены Playwright.
