# Поиск v3.2.2: AI-01–03 и отдельное AI-ранжирование

Дата: 2026-11-08. Ветка: feature/ux-search-v3.2.2-search. Область: автоматические REPLAY/fake тесты, без платных AI-вызовов.

## Изменения

- AI-01: сохранение условий распознаёт «до 80 000», «от 50 тыс», «80к», «за 80 000 в месяц», «до 7 млн». REPLAY-ответ модели проходит decode → preservation → validation. Точный запрос аренды 50–100 м² с priceTo=80000 дополнительно проходит preview и confirm. Покрыты м2/м²/словесная площадь, этажи, «снять»/«сдам», сохранение несвязанных условий и периода аренды при уточнении только бюджета.
- AI-02: `ExternalListing.priceUnit` nullable в PG и SQLite. Неизвестный период сохраняется как NULL, UI показывает «период не указан», AI получает явное предупреждение «Период цены неизвестен — цены несопоставимы до проверки». Правило сравнения исключает неизвестные периоды, в том числе ошибочный legacy total при source snapshot null. [ADR 0011](../adr/0011-unknown-listing-price-period.md) объясняет миграции и backfill. Обновление заполненной SQLite сохраняет историю, FK и все 11 явных индексов.
- score=0 был ожидаемым результатом отсутствия preferredFeatures: оценка считает долю подтверждённых предпочтений. Это проверено тестом 0 без предпочтений / 100 при подтверждённой парковке. Название сортировки теперь «Совпадение предпочтений (без ИИ)».
- Добавлены кнопка «Ранжировать выбранные с ИИ» и POST `/api/v1/property-search/analysis/rank`: 2–10 выбранных объявлений, лимит руководителя, тот же offer_text budget/ledger и постоянный AiAnalysisCache. Ключ включает модель, фильтры и критерии; перестановка ID не сбрасывает кэш, изменение фактов сбрасывает. Параллельные запросы не оплачивают одно и то же дважды.
- Ответ модели содержит только упорядоченные ID и ссылки на критерии. Сервер до успешного settlement отклоняет неизвестные/повторные/пропущенные ID, отсутствующие критерии и лишние поля. Краткие русские основания формируются из результатов серверной проверки; модель не может добавить новый факт. Рекомендация визуально отделена от фактов, опубликованные данные не меняются.
- AI-03: реальный клиент Yandex с официальным разрешённым URL и синтетическими реквизитами получает injected fetch reject или abort/timeout. Сетевых обращений нет. AI-действие возвращает контролируемое AI_CALL_FAILED с понятным сообщением; ручной поиск без AI сохраняет результат, `/api/health/ready` отвечает 200 после возврата AI_ENABLED=true. Allowlist не менялся.

## Проверки

| Набор | Фактический результат |
|---|---|
| Unit: поиск/AI + UX + codebook | 46 файлов, 1298 PASS |
| Integration/authorization PostgreSQL, crm_test_e | 5 файлов, 47 PASS |
| Integration-sqlite, включая populated upgrade и lifecycle | 7 файлов, 50 PASS |
| tsc --noEmit | PASS, без ошибок |
| ESLint всех изменённых TS/TSX, --max-warnings=0 | PASS |
| git diff --check | PASS |

Тесты ранжирования: 2 и 10 объявлений, отклонение 1/11/дубликатов, ограничение руководителя, доступ к чужой Need, отсутствие сессии/disabled API, постоянный кэш, перестановка ID, изменение фактов, параллельный cache miss, исчерпанный бюджет без dispatch, чтение кэша при нулевом бюджете, ошибка провайдера без сохранения ложного результата и успешный повтор, недопустимый ID/критерий модели.

Последние итоговые протоколы в рабочей копии: unit-ai-fixes.log (20:34:18), pg-ai-fixes.log (20:35:52), sqlite-ai-fixes.log (20:35:51), tsc-ai-fixes.log, eslint-ai-fixes.log. Это игнорируемые технические логи; нормативные результаты зафиксированы в этой таблице. В PG есть существующий DeprecationWarning библиотеки pg о параллельных query в транзакции; ошибок тестов нет.

## Воспроизведение

Генерация клиентов без чтения .env:

```powershell
npx prisma generate --config prisma.test.config.ts
npm run desktop:generate
```

Unit:

```powershell
npx vitest run --project unit tests/unit/property-search tests/unit/ai tests/unit/ux-search-workspace.test.ts tests/unit/codebook-migration.test.ts
```

PG (изолированная тестовая база; global setup пересоздаёт только её public schema):

```powershell
$env:TEST_DATABASE_URL='postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_e'
npx vitest run --project integration --project authorization tests/integration/listing-analysis-v31.test.ts tests/integration/property-search-price-replay-v31.test.ts tests/integration/search-readiness-security-regressions.test.ts tests/integration/listing-duplicates.test.ts tests/authorization/listing-duplicates.test.ts
```

SQLite:

```powershell
npx vitest run --project integration-sqlite tests/sqlite/listing-price-period-upgrade.test.ts tests/sqlite/lifecycle.test.ts tests/integration/listing-analysis-v31.test.ts tests/integration/property-search-price-replay-v31.test.ts tests/integration/search-readiness-security-regressions.test.ts tests/integration/listing-duplicates.test.ts tests/authorization/listing-duplicates.test.ts
npx tsc --noEmit
```

Внедрение требует применения новых миграций PG либо штатного SQLite upgrade. Исторический [LIVE-отчёт](live-search-v322-ai.md) не переписывается: новый платный LIVE-прогон, build/installer и визуальная browser-приёмка в эту проверку не входили.
