# Yandex AI, ТЗ v2.4.1 §§3–5

Реализованы серверный fetch-клиент Responses API, извлечение JSON с проверкой Zod, анализ описаний, web_search, Prisma ledger/резервы/тарифы/настройки, manager API и экран `/settings/ai`. После упрощения provider schema живой parse подтверждён тремя сценариями; все 8 integration/authorization-проверок прошли на мигрированной crm_test_d. Протоколы первоначальной проверки и повторной приёмки приведены ниже.

## Официальный HTTP-контракт

Проверено 05.11.2026 по [Responses createResponse](https://aistudio.yandex.ru/ru/docs/ai-studio/api/Responses/createResponse), [Web Search](https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/agents/tools/websearch), [примеру подключения](https://aistudio.yandex.ru/ru/docs/ai-studio/operations/generation/create-prompt).

POST https://ai.api.cloud.yandex.net/v1/responses. Authorization: Api-Key; project=folder отображается в OpenAI-Project; также передаётся x-folder-id из официального JS-примера. Модель gpt://{folder}/{model}. store=false принудительно (ENV true запрещён). Нет SDK, автоматических повторов, previous_response_id или записи тела ответа/запроса в журнал. Ограничены выходные токены, время включая чтение тела и размер ответа (2 MB); HTTP redirects запрещены. Endpoint фиксирован, чтобы ключ нельзя было отправить произвольному серверу.

Инструмент: tools:[{type:'web_search',search_context_size:'low',filters:{allowed_domains:[...],user_location:{region:'65'}}}]. До пяти доменов; регион Москвы 213, Новосибирска 65; для другого города user_location не задаётся до добавления проверенного region mapping, city остаётся в условиях запроса. Нельзя незаметно ограничивать другой город Новосибирском. IP сотрудника не используется. max_tool_calls=1 дополнительно ограничивает инструменты; фактически возвращённые web_search_call учитываются независимо от оценки. Контекст high/medium может стоить больше low; оценка зависит от проверенного тарифа и его webInputTokenAllowance, ограничение output не ограничивает входной поисковый контекст.

## Подключение к application и агенту поиска

`createSearchAi(config, {ledger, settings, tariffs}, optionalProvider)` — серверная точка сборки. В production передавать постоянные репозитории; `InMemoryAiLedger` допустим только в unit/demo и одноразовом smoke. Нет скрытого переключения live → fake. Fake всегда возвращает mode=test/testingMode=true; UI обязан явно показывать «Режим тестирования».

Схема SearchFilters уже появилась у параллельного агента в `src/modules/property-search/domain/types.ts` (не в первоначально предполагаемом filters.ts). AI импортирует её напрямую, отдельной расходящейся схемы нет. Денежные границы — строки; operation/rent priceUnit проверяются общей схемой.

Методы SearchAi:

- parseSearchQuery(context, {query, currentFilters?}) → {filters|null, clarificationQuestion|null, mode, testingMode, model, usage, webSearchCalls}. Возвращает полные предложенные фильтры, с учётом предыдущих; никаких инструментов. Неясные критические условия → уточнение. Ответ требует подтверждения/правки сотрудником.
- analyzeDescriptions(context, {listings:[{id,publicDescription}], unresolvedCriteria}) → evidence с listingId/criterion/result/quote/source=ai. Телефоны/email удаляются до вызова, непрошенные критерии и чужие id отвергаются. Неточное/отсутствующее доказательство, будущая установка и отрицание в положительном выводе понижаются до unknown. Отсутствующие пары также unknown. Это адаптируется к DescriptionAnalyzer поиска через `{criterion,state:result,source:'ai',evidence:quote??''}`; application выделяет requestId для каждого платного batch. Детерминированные проверки предшествуют AI.
- webSearch(context, filters) → кандидаты с originalUrl/sourceMethod=web_search/sourceCited/fetchedAt/verdict=needs_review/primarySourceVerified=false. Аннотация подтверждает происхождение ссылки, не истинность объявления. Нет автоматических confirmed, переноса Property или предложения клиенту. Следующий модуль делает SSRF-safe загрузку первоисточника, нормализацию и обычную проверку критериев/собственника. Синтаксическая проверка URL здесь не заменяет DNS/IP/redirect-проверку SSRF.

Контекст создаёт только сервер: user из сессии, jobId и ownerUserId из разрешённой записи задания, requestId — идемпотентный ключ конкретного вызова. Gate проверяет активность и принадлежность задания, но не подменяет RBAC потребности/клиента. Не передавать Client/ClientNeed DTO, ФИО, внутренние заметки или owner contacts: только вручную подтверждённые условия поиска и публичные описания. Strict Zod отвергает лишние поля, текстовые условия дополнительно очищаются от телефонов/email. Редактор не является универсальным детектором ФИО/секретов в произвольном тексте: application не должен формировать query из клиентских заметок. Публичный текст — недоверенный; инструкция модели запрещает исполнение команд из данных. Инструментов изменения CRM у модели нет. Ошибки провайдера полностью заменяются стабильными кодами; тела/ключи не журналируются. getConfig и createSearchAi нельзя импортировать в клиентские компоненты, возвращать config браузеру запрещено.

## Расходы и атомарный контракт persistence

`AiGate.check(callType,user,job)` атомарно проверяет и резервирует оценку **до** провайдера. `settle` сверяет фактические tokens и число web-вызовов, сохраняет известную фактическую стоимость отдельно от оценки. При неизвестном usage/тайм-ауте сохраняется не менее резерва, без платного retry. Уже reserved/settled requestId → AI_ALREADY_RESERVED, повторная оплата и повторный запрос не выполняются. Повторный settle — no-op. Другой fingerprint/пользователь/задание с тем же ключом → конфликт. Неопределённый исход нельзя автоматически «освобождать»: его мог оплатить провайдер.

Все суммы — bigint micro-RUB (10⁶ = 1 ₽), округление вверх до micro-RUB, тариф за миллион токенов + за web-call. Проверенные коммерческие тарифы намеренно не выдуманы и не зашиты: без активной строки тарифа вызов запрещён. TariffRepository.findEffective(model,at) обязан возвращать единственную действующую версию. Оценка input = UTF-8 bytes инструкций и JSON + запас 1024 + webInputTokenAllowance; output — максимальное число. Для тарифа webInputTokenAllowance должен покрывать консервативный размер платного поискового контекста выбранного режима. Это оценка, не гарантия точного счёта провайдера; фактический расход сверх резерва учитывается полностью и блокирует следующие вызовы.

ENV — жёсткие потолки; UI может уменьшить, но не увеличить лимиты и не включить ENV-disabled режим. Пустые UI значения сохраняют ENV. Общий месячный бюджет — на всех сотрудников, не на пользователя. Час — скользящие 60 минут; сутки/месяц в APP_TIMEZONE=Asia/Novosibirsk. ТЗ не задаёт ENV для общего суточного числа вызовов и общего числа вызовов задания: приняты потолки 8 × hourly и 10 соответственно, UI может уменьшить. Web: отдельный лимит вызовов задания и число уникальных заданий пользователя за локальные сутки. Автоматический fallback требует отдельного разрешения и полного технического отказа; application использует decideFallback поиска, не ставит fullTechnicalFailure при успешном пустом ответе/отсутствии включённых источников.

Исходный контракт адаптеров (реализация без изменения схемы описана ниже):

1. AiLedgerRepository.atomic(work) — одна SERIALIZABLE-транзакция, общая блокировка budget/counters и retries serialization/deadlock внутри адаптера. `find/usage/insert/update` из gate.ts работают на одном tx. UNIQUE(requestId); атомарный snapshot + insert; параллельные процессы должны делить блокировки, process-local mutex недостаточен.
2. Таблица AI-вызовов: requestId, fingerprint (SHA-256 безопасного payload), userId, jobId, callType, model, tariff snapshot/id, createdAt, finishedAt, durationMs, local dayKey/monthKey, estimated input/output tokens/search calls, estimatedMicros, usage input/output, actual search calls, actualMicros nullable, chargedMicros, estimated flag, reserved/settled, outcome. Индексы userId+createdAt, userId+dayKey, jobId+callType, monthKey; история сохраняется. Деньги BIGINT/NUMERIC без float; timestamps timestamptz. Тексты/ключи/контакты в ledger не писать.
3. AiUsageSnapshot: userHourCalls/userDayCalls/jobCalls включают reserved и settled, jobWebCalls — не менее зарезервированного числа, userDayWebJobIds — уникальные web jobs, monthCommittedMicros — сумма chargedMicros всех сотрудников. Нельзя забывать незавершённые резервирования.
4. TariffRepository: id, model, effectiveFrom/effectiveUntil, input/outputMicrosPerMillion, webSearchMicrosPerCall, webInputTokenAllowance; не допускать пересекающихся периодов. Gate дополнительно проверяет применимость модели и даты.
5. AiSettingsRepository.getLimits() — серверные настройки руководителя. Авторизация записи/просмотра расходов — application. Дополнительно нужны audit настроек и связи AI-вызова с существующим SearchJob (агент модели определяет имена Prisma). Сохранение результата для идемпотентного повторного чтения — репозиторий поиска, не ledger. Не выдавать результат по одному requestId без проверки прав.

В схеме используются существующие AiSetting/AiUsageLog/AiTariff/AiBudgetReservation и SearchRun. Схема и миграции не менялись. Метаданные, точность и идемпотентность обеспечены адаптером ниже.

## Проверки и smoke

Unit: `npx vitest run tests/unit/ai tests/unit/config.test.ts`. Проверяются контракт HTTP, схемы, контакты, injection/evidence, ограничения, бюджет при конкурентных запросах, отсутствие двойной оплаты, тарифы, ENV-приоритет и явный fake. Реальный провайдер не вызывается.

Каждый запуск `npx tsx --env-file=.env scripts/ai-smoke.ts --live` выполняет один synthetic parse; `--live --web` вместо него выполняет один запрос с web_search. Требуются AI_ENABLED=true, ключ, месячный потолок, AI_SMOKE_INPUT_RUB_PER_MILLION, AI_SMOKE_OUTPUT_RUB_PER_MILLION, AI_SMOKE_TARIFF_EFFECTIVE_FROM (ISO date); для web также YANDEX_WEB_SEARCH_ENABLED=true. Вывод исключительно status/tokens/model. Максимум 1800 output tokens и один tool call, без повторов. Это административный smoke с process-local ledger, а не production учёт. Не запускать параллельно рабочим платным заданиям. Дальнейшие живые вызовы требуют нового разрешённого бюджета.

## Персистентность и настройки, 05.11.2026

- `PrismaAiLedger.atomic`: READ COMMITTED + `pg_advisory_xact_lock(241005)`, одна транзакция на read/check/insert либо settle/release. Чтение выполняется после получения блокировки и видит commit предыдущего процесса. Настройки, seed и резервы делят этот lock. Это сериализация операций бюджета без snapshot-проблемы ожидания lock в SERIALIZABLE; process-local mutex не используется.
- Singleton создаётся под lock; больше одной строки — явный отказ `AI_SETTINGS_NOT_SINGLETON`. Сторонние SQL-writers обязаны соблюдать тот же контракт (DB singleton constraint не добавлялся по запрету изменения схемы).
- Уникальность запроса использует существующий PK `AiUsageLog.id`: детерминированный UUID из SHA-256 requestId. Исходный requestId, fingerprint, локальные day/month keys, snapshot тарифа, оценки, charged/actual micro-RUB строками, state, finishedAt хранятся в `result` JSONB, `ledgerVersion=1`. Текстов запросов/ответов и секретов там нет. Коллизия/другой fingerprint приводит к отказу, а не повторной оплате.
- `AiUsageLog` и связанный `AiBudgetReservation` создаются атомарно до отправки. SearchRun должен принадлежать активному пользователю. Денежные колонки Decimal(16,2) округляются **вверх**; бюджет и API используют точные micro-RUB из JSONB. Стандартные прямые SQL SUM этих колонок дают консервативную копеечную оценку, а не точный ledger.
- Успех и ошибки JSON учитывают известные tokens; неизвестный расход/timeout сохраняет полный резерв. Release разрешён только при доказанном `not_dispatched`; счётчик попыток остаётся израсходованным. Повторный settle/release не меняет завершённую запись.
- perUserDailyLimit = все AI-вызовы сотрудника/сутки и дополнительный потолок уникальных web-заданий (ENV webJobs остаётся жёстче при меньшем значении); perJobLimit = все AI-вызовы задания и дополнительный потолок web calls; dailyLimit = все вызовы агентства/локальные сутки. Часовой, web и месячный потолки берутся также из ENV. Незавершённые резервы участвуют в подсчёте. Настройки повторно проверяются под lock перед insert.
- Модель выбирается в UI; ENV-boolean выключает режим независимо от UI. Контекст UI не превышает ENV low/medium/high. `createPersistentSearchAi` применяет сохранённую модель/контекст; точечное подключение сделано в composition seam поиска. Скрейпер применяет сохранённые переключатели через собственный searchSettings.
- Тариф — полная версия из трёх unit-строк с общей effectiveFrom, callType=parse используется как каноническая группа цен модели для всех трёх типов вызова (сам журнал сохраняет фактический callType). Ввод поштучных token units также поддержан. Новая версия только добавляется с более поздней датой; предыдущая заканчивается на границе следующей. Отсутствующая/неполная/нулевая цена запрещает вызов. Search context allowance = 128000 входных токенов на запрос для всех режимов — консервативная оценка, не гарантия биллинга; перерасход учитывается полностью.
- Seed включён в существующий `prisma/seed.ts`; не запускался на рабочей БД. [Официальный прайс Yandex AI Studio](https://aistudio.yandex.ru/ru/docs/ai-studio/pricing), проверено 05.11.2026: Flash 100/200 ₽ за миллион входных/выходных токенов; YandexGPT Pro 5.1 800/800; web tool 0.915 ₽/вызов. Токены инструментов считаются консервативно по обычной входной цене. В аудите seed сохраняются источник, дата и «Требует подтверждения руководителем»; UI показывает эту пометку. Дата действия seed = дата проверки, без ретроактивного приписывания цены январю.
- API: manager GET/PUT `/api/v1/settings/ai` (expectedUpdatedAt, аудит); manager GET `/api/v1/ai/usage?month=YYYY-MM&page=1` (50 строк, суммы всего месяца); authenticated GET `/api/v1/ai/limits` (только остаток текущего сотрудника, разрешённые режимы, без журнала/общей суммы). Экран содержит переключатели семи площадок, лимиты, версии тарифов, ENV-ограничения, журнал, loading/error/empty/pending/conflict и предупреждение о несохранённом.

## Живой smoke 05.11.2026: ровно 5 parse + 1 web

Модель всех шести запросов: `aliceai-llm-flash/latest`. Синтетический запрос без клиентских данных. Лимит повторов исчерпан, автоматических retry нет.

| Вызов | Режим | Результат | Input / output tokens |
|---|---|---|---|
| parse 1 | text.format.json_schema, output ≤500 | failed (санитизированный исходный вывод) | неизвестно |
| parse 2 | text.format.json_schema, output ≤500 | AI_INCOMPLETE_RESPONSE | неизвестно |
| parse 3 | text.format.json_schema, output ≤1800 | AI_INCOMPLETE_RESPONSE | неизвестно |
| parse 4 | text.format.json_schema, output ≤1800, обработка пустого error object | AI_INCOMPLETE_RESPONSE | неизвестно |
| parse 5 | text.format.json_schema, диагностический status/tokens | HTTP 200, body status=failed | 0 / 0 |
| web 1 | без text.format, tools=[web_search], output ≤1800 | completed; JSON прошёл Zod | 434 / 654 |

По [Responses createResponse](https://aistudio.yandex.ru/ru/docs/ai-studio/api/Responses/createResponse) правильное поле — `text.format={type:"json_schema",name,schema,strict}`, а не `response_format` или вложенное `json_schema`. Доступность схемы описана для поддерживающих моделей; HTTP 200 не гарантирует status=completed. В нашем live схема дала failed на Flash; причина внутри провайдера не установлена (полный ответ не печатался и не сохранялся), делать вывод о несовместимости всех JSON schemas нельзя. В production вызовах схема остаётся инструкцией, `responseSchema` в клиенте опционален и не включается автоматически. Финальный parse без text.format повторно не проверялся: разрешённые пять вызовов уже израсходованы.

Извлечение принимает один полный JSON-object внутри Markdown ` ```json `, BOM и пояснений, корректно считает скобки/escape внутри строк. Несколько объектов, обрыв, ошибочные типы/enum, неизвестные поля и нарушение правил аренды отвергаются Zod; бизнес-значения не исправляются и платный повтор не запускается. Исходный AI_INVALID_JSON_RESULT совместим с лишней обёрткой/текстом или несоответствием схеме; без сохранения исходного ответа точную первоначальную причину утверждать нельзя.

Web-запрос с Flash принят и завершён, поэтому менять YANDEX_CLOUD_WEB_MODEL по признаку несовместимости не требуется. Smoke не печатает число tool calls: подтверждены принятие tools и валидный ответ, но не отдельный счётчик фактических вызовов инструмента. Production ledger хранит этот счётчик. При несовместимости в другом deployment можно явно задать YANDEX_CLOUD_WEB_MODEL=yandexgpt/latest после отдельной проверки, без скрытого переключения. Стоимость известных токенов web smoke по выбранным 100/200 ₽/миллион = 0.174200 ₽ плюс фактически выполненные web calls; неизвестный расход первых четырёх parse не объявляется нулевым.

## Первоначальная проверка persistence (история; повторная приёмка ниже)

`npx vitest run --config tests/ai.vitest.config.mts tests/unit/ai` — PASS: 52 tests, 4 files. Целевой ESLint — PASS (exit 0); `git diff --check` — PASS. Общий `npx tsc --noEmit` сначала прошёл, но повтор после параллельных изменений выявил ошибки вне AI в `scripts/demo/seed-demo.ts` и `tests/integration/p1a-workflow.test.ts` (включая обязательное Task.priority). Последний запуск: exit 2, диагностик в AI/settings/API/smoke/новых тестах — 0. Чужие файлы не исправлялись. UI браузером не проверялся.

Integration/authorization: `TEST_DATABASE_URL=postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_d npx vitest run --config tests/ai.vitest.config.mts tests/integration/ai-persistence.test.ts tests/authorization/ai-settings.test.ts` — **BLOCKED**, все 8 сценариев упали при seed: `public.dictionary_items` не существует. Read-only проверка information_schema показала 0 таблиц в выделенной БД. Схема/миграции/generate не запускались по прямому запрету заказчика. Тестовый конфиг намеренно не использует global-setup, который в основном vitest-конфиге запускает migrate. Для PASS требуется подготовленная другим агентом БД и повтор этих тестов. Параллельность, settle/release, аудит, ENV, тарифы, ролевые API и собственный остаток покрыты сценариями, но успешность SQL-прогона пока не подтверждена.

## Повторная приёмка 05.11.2026, после подготовки crm_test_d координатором

Этот протокол заменяет прежние BLOCKED и неподтверждённый parse выше; ранние результаты оставлены как история испытаний.

### Исправления

1. После миграции тестовой БД первый прогон дал 1 PASS / 7 FAIL: `$queryRaw SELECT pg_advisory_xact_lock(...)` возвращает PostgreSQL `void`, который PrismaPg не десериализует. Исправлено на `SELECT pg_advisory_xact_lock(241005::bigint)::text`. Транзакционная advisory lock и атомарность сохранены. Повтор отдельного прогона — **8/8 PASS**.
2. По наблюдению координатора, простая strict JSON Schema работает с Flash, поэтому прежние failed не доказывают несовместимость модели со structured outputs. Добавлена отдельная плоская provider schema в `domain/provider-parse.ts`: простые scalar types, nullable через `type:[...,"null"]`, массивы строк; без `$ref`, `anyOf/oneOf`, format, minimum, default, enum и вложенных объектов. В запросе `text.format={type:"json_schema",name:"crm_result",schema,strict:true}`. Полная сгенерированная Zod JSON Schema для parse больше не отправляется ни в format, ни в instructions. Enum/business rules остаются в короткой инструкции и в обязательной полной Zod-валидации.
3. Плоский wire result преобразуется в прежний публичный `{filters,clarificationQuestion}`: null необязательные границы удаляются, неясное критическое условие даёт filters=null. Невалидные enum, числа вместо денежных строк, отрицательная площадь, неизвестные поля и аренда без единицы цены отвергаются полной canonical Zod schema. Старый canonical result оставлен для fixtures/text-only responses; JSON в Markdown поддерживается. Повторных платных запросов при ошибке нет. В бюджетную оценку включён также UTF-8 размер provider schema.
4. При status=failed/incomplete клиент пишет structured warning: status, model, `error.code`, `incomplete_details.reason`. Значения codes/reasons пропускаются через allowlist; неизвестные заменяются на unrecognized_code/unrecognized_reason. error.message, arbitrary details, prompts, ответы, credentials не журналируются. Unit-тест проверяет отсутствие синтетического ключа и текста запроса в warning. Ошибка по-прежнему сохраняет консервативный резерв при неизвестном расходе.

### Живой parse: 3 из разрешённых 4 вызовов

Все вызовы выполнены последовательно, без tools, с `store=false`, `strict=true`, max_output_tokens≤1800, модель **aliceai-llm-flash/latest**, только синтетические данные. Дополнительного web_search в этой итерации не было.

| Сценарий / команда после `scripts/ai-smoke.ts` | Provider status | Проверка результата | Input / output tokens |
|---|---|---|---|
| `--live` (продажа офиса, площадь/цена) | completed | PASS, canonical Zod, status=ok | 319 / 132 |
| `--live --case=rent` (помесячная аренда, первый этаж) | completed | PASS, canonical Zod, status=ok | 322 / 132 |
| `--live --case=clarification` (неизвестная единица аренды) | completed | PASS, filters=null, вопрос уточнения | 320 / 138 |

Всего **961 входной + 402 выходных токена**, оценка по использованным в smoke 100/200 ₽ за миллион = **0.176500 ₽**, без web calls. Вывод содержит только status/tokens/model. Четвёртый разрешённый вызов не потребовался. Причина старого failed точно не локализована до конкретного keyword, но плоский provider contract устраняет наблюдавшийся сбой; утверждения о полной несовместимости Flash с json_schema неверны.

### Проверки

- `TEST_DATABASE_URL=.../crm_test_d npx vitest run --config tests/ai.vitest.config.mts tests/integration/ai-persistence.test.ts tests/authorization/ai-settings.test.ts`: **8 PASS**, 2 файла. Включает 12 конкурентных попыток резервирования через независимые экземпляры репозиториев, общий бюджет, точный settle/release и идемпотентность, консервативный расход при ошибке, суточный лимит агентства, ENV/audit/concurrency, тарифы и запреты API/собственный остаток.
- Финальный совместный прогон той же конфигурацией `tests/unit/ai tests/integration/ai-persistence.test.ts tests/authorization/ai-settings.test.ts`: **70 PASS**, 7 файлов (62 unit + 8 integration/authorization).
- Целевой ESLint src/modules/ai, scripts/ai-smoke.ts и AI-тестов: **PASS**, exit 0.
- `tsc --noEmit`: общий прогон остановлен на чужом `scripts/demo/seed-demo.ts(19,147): TS1005 ';' expected`; AI-диагностик нет, но полный semantic typecheck всего проекта этим запуском не подтверждён. Чужой файл не изменялся.
- Схема, миграции и Prisma generate не менялись/не запускались. UI браузером в этой итерации не проверялся.

Все переменные §5 добавлены в серверную Zod-валидацию и .env.example. Ключ пустой, AI/web/scraper выключены; APP_TIMEZONE по умолчанию Asia/Novosibirsk, UTC-данные не менялись. Проверки календаря/отчётных суток существующей CRM вне зоны данного модуля.
