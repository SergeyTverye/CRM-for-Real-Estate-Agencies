# QA этапа 2 — 05.11.2026

- Beam: PDF timeout закрывает Chromium, наблюдает поздний reject и освобождает слот; регрессия `tests/unit/html-pdf.test.ts` PASS.
- Beam: `/clients/pick` валидирует q до 120 символов и ограничивает выдачу 20; интеграционная проверка границ/RBAC PASS.
- Prisma generate PASS; TypeScript и ESLint проверены без ослабления правил.
- Unit: **577/577**, 35 файлов; дополнительно изменённые проверки PDF/codebook **73/73**.
- Integration + authorization: **190/190**, 32 файла, отдельная `crm_test_g`, миграции с нуля.
- Playwright: **16/16**, `crm_e2e`, один webpack dev-сервер; лог `data/qa2-e2e-isolated.log`, HTML-отчёт `playwright-report/index.html`.
- Новые browser-проверки: скачивание PDF с MIME `application/pdf` и несколькими страницами; диалог переноса вместо prompt; серия по будням; нижняя панель и список при 390 px.
- Сквозной сценарий сохраняет обращение → подборку → каталог → предложение → КП → показ → сделку → постсделочные задачи/уведомление.
- UI: действия задачи на мобильном перенесены под текст; DEMO-метка включается при фикстурах; индикатор dev-сборки отключён.
- ВКР: **22 PNG** просмотрены; manifest и SHA256SUMS сверены, **0 несовпадений**; PDF демонстрационного КП — **5 страниц A4**.
- Кадр 07: FakeResponsesProvider отработал, но синтетический URL отклонён текущей проверкой AI как `CATALOGUE_NOT_LISTING`; показаны реальные 0 пригодных карточек. AI/property-search не изменялись.
- **BLOCKED:** `npx next build` со стандартной `.next` получает EPERM на `server/app/api/v1/notifications/preferences/route/app-paths-manifest.json`; у файла явный Deny ACL. Автоматическая проверка безопасности отклонила его удаление (`blocked by policy`); ACL не изменялся. Обычный `npx playwright test` не стартует без production build. Dev E2E не является production-приёмкой; при его работе встречаются диагностические сообщения Next о router initialization/stream.
- Схема/миграции и зависимости не менялись; npm install и Git-операции записи не выполнялись. DEMO-серверы остановлены, E2E-сервер завершён Playwright.
