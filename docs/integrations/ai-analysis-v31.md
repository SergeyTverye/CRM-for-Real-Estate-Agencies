# Анализ выдачи ИИ — v3.1 SR-09 / AT-08

Модуль: `src/modules/ai/application/listing-analysis-service.ts`, домен `domain/listing-analysis.ts`.
Схема и миграции не изменялись. Переиспользованы Yandex Responses, SearchAi, AiGate, PrismaAiLedger, санитизация и проверка чисел P2.

## Контракт подключения UI

`ListingAnalysisPanel` из `src/ui/listing-analysis/listing-analysis-panel.tsx`: props `{listingIds:string[],filters:SearchFilters,needId?:string,labels?:Record<string,string>,enabled?:boolean}`. Передать реальные ID выделенных ExternalListing; labels — адреса/заголовки. Передавать `key` из выбранных ID и фильтров, чтобы смена поиска сбрасывала старый предпросмотр. Компонент самостоятельно вызывает API, показывает доказательства/источник/сомнения, сравнение, текст, вопросы и подтверждение задач. UUID не выводит.

`QueryRefinement` из `src/ui/listing-analysis/query-refinement.tsx`: `{currentFilters:SearchFilters,onConfirmed:(filters:SearchFilters)=>void,enabled?:boolean}`. Запрос → предложения/diff → явное подтверждение. Только `onConfirmed` меняет форму; поисковый запуск автоматически не выполняется. `key` по currentFilters сбрасывает старую локальную форму.

Все маршруты POST под `/api/v1/property-search/analysis`, штатные cookie-session, Origin/CSRF, active-instance guard, no-store и единый error envelope:

| Путь | Ввод | Вывод |
|---|---|---|
| `/batch` | `{listingIds,filters,needId?}` | `{items:[{listingId,source,url,ruleChecks,evidence,unresolved,cacheHit,warning}],limit,model,warning}` |
| `/compare` | тот же ввод; 2–4 разных ID | `{text,questions:[{listingId,questions}],tradeoffs:[{listingId,points:[{comparedListingId,area,price}]}],warning,draftOnly:true,model,usage,...}` |
| `/collection-text` | тот же ввод | тот же черновик, без записи КП/подборки |
| `/suggest-tasks` | тот же ввод | `{tasks,pendingActionId,confirmationRequired}`; Task ещё нет |
| `/suggest-tasks/confirm` | `{pendingActionId,confirmed:true,dueAt:UTC_ISO}` | `{tasks:[{id}],alreadyConfirmed}` |
| `/parse` | `{text,currentFilters}` | `{filters,clarificationQuestion,diff:[{field,before,after}],pendingActionId,confirmationRequired,...}` |
| `/parse/confirm` | `{pendingActionId,confirmed:true,currentFilters}` | `{filters,confirmed:true}` |

Прежний `/property-search/parse` сохранён совместимым; новый confirmation flow реализован в выделенном namespace и не требует изменения файлов параллельного агента поиска.

## Правила и защита

Общий публичный каталог ExternalListing доступен авторизованным сотрудникам согласно существующему listing-service. `needId` всегда проверяется через loadAccessibleNeed. Личные pending actions доступны только владельцу, включая руководителя; подтверждение повторно проверяет срок, состояние и доступ к потребности. Задачи создаёт штатный createTask в общей транзакции; блокировка pending-action предотвращает дубли. Изменившееся объявление/форма даёт STALE_UPDATE.

Перед моделью вычисляются evaluateListing, структурные и правиловые признаки. Предпочтения, собственник, доступность и уже известные признаки модели не передаются. Поддержаны requiredFeatures и неизвестные обязательные boolean=true из типизированного каталога. Числовые диапазоны и требования отсутствия признака остаются правилами/ручной проверкой: модель не изобретает измерения и не обращает отрицание в подтверждение. Пакеты группируются по одинаковым неизвестным обязательным признакам. Число выбранных объявлений ограничено `min(20, effective.perJobLimit)` из настроек руководителя и ENV/AiGate; дополнительных schema/ENV не требуется. Это сознательное переиспользование существующего лимита, отдельного поля количества кандидатов в схеме нет.

Ключ AiAnalysisCache = SHA-256(version, sanitized description, sorted unique criteria, configured model). Данные/порядок неизменны → кеш без платного вызова. Advisory transaction lock по ключу сериализует и межпроцессные одновременные промахи. Успешный оплаченный результат сохраняется отдельным commit под удерживаемой блокировкой: ошибка следующей группы не откатывает уже оплаченный кеш. Evidence не содержит ID исходного объявления, поэтому одинаковое описание переиспользуется безопасно с текущими source/url и пересчитанными ruleChecks. Usage FK ведёт к реальному AiUsageLog. В журнал не пишутся prompts/ответы/секреты. Ошибочный/оборванный анализ без результата не объявляется кешем.

Дословный quote проверяет существующий SearchAi; будущие обещания, отрицания и фрагменты с командами не становятся matched. Санитизация убирает контакты и запрещённые персональные поля. Описания передаются отдельными JSON-данными; существующая инструкция явно запрещает выполнять инструкции из них. ИИ не изменяет поиск, Property, owner verification или доступность.

Сравнение/текст получают только структурные сведения и успешные структурные проверки, без сырого описания; неизвестное вынесено в серверные вопросы и вообще не передаётся модели как факт. Проверка чисел P2 отклоняет придуманные числа/агрегированные диапазоны/сокращения. Сервер также возвращает попарные качественные компромиссы по Decimal-площадям и сопоставимым единицам цены, без вычисленных сумм и выдуманных чисел. Каждый черновик содержит обязательную оговорку. Внешние структурные сведения являются сведениями источника, а не доказательством прав собственности или актуальности. Для сохранения текста существующего КП использовать штатный P2 confirm с snapshots, здесь текст остаётся черновиком.

Отключение ИИ даёт AI_DISABLED с ручным запасным сценарием. Бюджет/квоты учитываются через прежний durable AiGate, никаких web_search и автоматических вызовов при открытии страницы.

## Проверки

05.11.2026: `node node_modules/vitest/vitest.mjs run tests/unit/ai/listing-analysis.test.ts tests/integration/listing-analysis-v31.test.ts tests/unit/property-search/quality-baseline.test.ts` — **28 PASS**, 3 файла (5 unit домена, 16 integration/API, 7 REPLAY). Тестовая БД строго `crm_test_d`, global setup заново применяет миграции. Проверены долговечный кеш и изменение описания, конкурентные cache misses и сохранение оплаченного кеша при сбое следующей группы, единый batch, предпочтения/собственник/доступность, типизированные признаки, нулевая стоимость структурных проверок, лимит руководителя, бюджет, отключение ИИ, injection/поддельная цитата/обещание, need RBAC, чужой draft (включая manager), идемпотентное/конкурентное подтверждение задач и stale version, сохранение фильтров/diff/подтверждение, контроль чисел, cookie-auth/API.

ESLint целевых файлов — PASS без предупреждений. `tsc --noEmit` — PASS на совместном срезе после появления файлов параллельного UI-агента. Первые прогоны выявили исправленные собственные ошибки типизации, API test helper и отсутствие обязательного SearchRun FK для прежних callType=parse/description; первоначальное прерывание теста оставляло асинхронную транзакцию и блокировало следующий truncate. Финальный прогон чистый. Чужие файлы не исправлялись.

`npx tsx scripts/search-quality/evaluate.ts` выполнен без `--write` и без AI: 49 карточек × 4 запроса = **196** случаев. Текущий REPLAY: falseInclusions **12**, falseConfirmed **0**, falseExclusions **1**, exactVerdictErrors **18**; baseline соответственно **21/1/1/27**. Тест «не хуже» по каждому запросу/источнику и дублям PASS. Пороги/фикстуры не изменены. Улучшения принадлежат совместному домену поиска; модуль анализа сам вердикты не меняет.

## LIVE — 05.11.2026, crm_demo, порт 3412

Выполнялся `tests/fixtures/listing-analysis/live.ts --live`, с AI_ENABLED=true и NEXT_DIST_DIR=.next-3412 на процессе Next webpack. Только существующие сохранённые реальные OnRealt-объявления: [86529082](https://onrealt.ru/novosibirsk/kypit-ofis/86529082) и второе помещение того же адреса из crm_demo; никаких новых запросов к площадкам. Пакет — одно объявление, согласно исходному perJobLimit=1; сравнение/текст — два. Для визуального QA создан отдельный replay-run из существующих snapshots, без фиктивного нового сбора.

Через `/api/v1/settings/ai` временно выставлены бюджет **100 ₽**, aiEnabled=true, perUserDailyLimit=30, dailyLimit=100. Последние два лимита требовались, поскольку исходная дневная квота 3 уже была исчерпана предыдущими проверками. Все исходные значения, включая perJobLimit=1, восстановлены в finally после каждого запуска; проверка восстановления PASS. До платных вызовов отдельно проверены реальные отказы AI_ANALYSIS_LIMIT и AI_RATE_LIMIT — **0 вызовов**. Исходный бюджет 1000 ₽ восстановлен.

Модель всех пяти платных вызовов — `aliceai-llm-flash/latest`, без web_search. Цены — точный chargedCost из durable CRM ledger, не внешний счёт провайдера:

| UTC | Операция | Вход / выход | Стоимость ₽ | Результат |
|---|---|---|---|---|
| 18:06:44 | description | 453 / 89 | 0.063100 | unknown без доказательства — корректно; кеш сохранён |
| 18:07:22 | comparison | 317 / 182 | 0.068100 | корректные исходные числа и вопросы |
| 18:07:31 | collection text | 309 / 85 | 0.047900 | выявлено продвижение unknown-планировки в утверждение; исправлено |
| 18:08:31 | comparison после исправления | 316 / 100 | 0.051600 | PASS, неизвестные признаки отсутствуют в model facts |
| 18:08:36 | collection text после исправления | 308 / 79 | 0.046600 | PASS, только исходные площади/цены и оговорка |

Итого **5/8 вызовов**, **1703 входных + 535 выходных токенов**, **0.277300 ₽**, запас бюджета 99.722700 ₽. Первый paid description единственный; все последующие повторные batch (API и UI, включая повторную сессию) дали cacheHit=true, число AiUsageLog не увеличилось. Первоначальный текст не объявляется семантически корректным лишь на основании 200/ledger success: находка и повторная проверка сохранены в [полном журнале](ai-analysis-v31-live.json).

Просмотрены оба настоящих скриншота компонента после исправления, без cookies/ключей/UUID в UI: [batch из кеша](../screenshots/vkr/live-ai/v31-analysis-batch.png), [сравнение и вопросы](../screenshots/vkr/live-ai/v31-analysis-compare.png). Последующие серверные deterministic tradeoffs проверены integration-тестом; дополнительных платных вызовов ради них не выполнялось.

## Передача координатору

UI-агент уже подключил QueryRefinement и ListingAnalysisPanel в своей зоне поиска. Новых зависимостей, schema/migrations и ENV нет. tsconfig не является результатом этого модуля; добавления .next-3412 удалены/отсутствуют в итоговом diff. Dev-сервер 3412 остановлен после проверки. Общий build/e2e всего параллельного изменения остаётся у координатора; текущие проверки не заменяют общий release gate.
