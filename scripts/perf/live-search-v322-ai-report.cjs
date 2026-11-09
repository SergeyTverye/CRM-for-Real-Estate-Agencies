const fs=require('node:fs');
const path=require('node:path');
const file=path.resolve('docs/vkr/live-search-v322-ai.json');
const e=JSON.parse(fs.readFileSync(file,'utf8'));
e.defects=e.defects.filter(d=>d.id!=='AI-04');
e.observations=[{id:'METRICS-01',description:'dateDetails.cacheHits=6/9 при requested=3. Это не доказательство дефекта: cacheHits и сетевые requested имеют разный смысл; дополнительная проверка не выполнялась.'}];
e.cleanup.harnessForceStoppedPid=38064;
e.cleanup.port3372ListenerAbsent=true;
e.cleanup.ownServerWorkerPidsAbsent=true;
e.cleanup.verifiedAt=new Date().toISOString();
const s=e.scenarios;
const delta=(a,b)=>(Number(b.committedRub)-Number(a.committedRub)).toFixed(6);
e.evaluations=[
 {id:'a',status:'FAIL',elapsedMs:e.parseOne.response.ms+s[0].elapsedMs,aiCostRub:delta(e.parseOne.usageBefore,e.parseOne.usageAfter),runId:s[0].id,reason:'AI-01: потеря priceTo. Поиск выполнен только после ручного восстановления 80000.'},
 {id:'b-3',status:'PASS',coverage:'PARTIAL',elapsedMs:e.parseTrio.response.ms+s[1].elapsedMs,aiCostRub:delta(e.parseTrio.usageBefore,e.parseTrio.usageAfter),runId:s[1].id,reason:'AI-разбор и подтверждение работают поверх исправленных условий; 10 объявлений, Яндекс требует действия.'},
 {id:'b-7',status:'PASS',coverage:'PARTIAL',elapsedMs:e.parseAll.response.ms+s[2].elapsedMs,aiCostRub:delta(e.parseAll.usageBefore,e.parseAll.usageAfter),runId:s[2].id,reason:'AI-разбор работает, частичные результаты и отказы источников показаны. Полный охват семи источников BLOCKED.'},
 {id:'c-analysis',status:'PASS',elapsedMs:e.analysis.response.ms,aiCostRub:delta(e.analysis.usageBefore,e.analysis.usageAfter),selectedIds:e.analysis.selectedIds,reason:'Три объявления, дополнительный критерий отдельного входа: unknown, не выдуман. Один платный grouped-вызов.'},
 {id:'c-compare-ranking',status:'FAIL',elapsedMs:e.comparison.elapsedMs,aiCostRub:delta(e.comparison.usageBefore,e.comparison.usageAfter),selectedIds:e.comparison.response.tradeoffs.map(x=>x.listingId),reason:'Сравнение выполнено, но неизвестные единицы цен превращены в total. Отдельное AI-ранжирование отсутствует; штатный match-sort возвращает пять score=0.'},
 {id:'d',status:'PASS',elapsedMs:e.budgetExhausted.elapsedMs+s[3].elapsedMs,aiCostRub:'0.000000',runId:s[3].id,reason:'422 AI_BUDGET_EXHAUSTED без нового AI-журнала; ручной поиск вернул 5.'},
 {id:'e',status:'FAIL',elapsedMs:e.providerUnavailable.elapsedMs,aiCostRub:'0.000000',reason:'Сценарий с указанным URL отвергается конфигурацией; ready и ручной поиск 500. Реальный сетевой отказ Yandex не был смоделирован.'},
 {id:'f',status:'PASS',elapsedMs:e.missingKey.bootMs+e.missingKey.aiRequest.ms+s[4].elapsedMs,aiCostRub:'0.000000',runId:s[4].id,reason:'credentials_missing, понятный UI; AI=409, ручной поиск вернул 5.'},
];
e.matrixPoints={2:['a'],7:['b-3','b-7'],13:['c-analysis','c-compare-ranking'],14:['d','e','f'],note:'Привязка по смыслу поручения; определения строк матрицы в исходном поручении не приложены.'};
e.sourceSummary=s.map(r=>({name:r.name,runId:r.id,elapsedMs:r.elapsedMs,total:r.results.total,counts:r.results.counts,sources:r.progress.sources.map(x=>({source:x.source,status:x.status,resultCount:x.resultCount,acceptedCount:x.acceptedCount,durationMs:x.durationMs,reason:x.reason}))}));
e.overall='FAIL';
e.limitations=['ТЗ.txt отсутствует; работа выполнена по конкретному поручению LIVE-проверки существующей ветки.','Проверен shallow LIVE-поиск maxPages=1, limit=5 на источник, не полнота рынка.','В вызовах runs confirmedPaid=false: платный AI разбор/анализ выполнен отдельными явными действиями, автоматический анализ каждой карточки и Web Search отключены.','b-3/b-7 стартуют с вручную исправленного набора условий, поэтому не опровергают AI-01.','Скриншоты результатов получены повторным открытием только что выполненных LIVE runId; метка REPLAY в UI честно обозначает сохранённую выдачу.','Расход — расчёт журнала CRM по настроенным тарифам, не независимая сверка счёта Yandex Cloud.'];
fs.writeFileSync(file,JSON.stringify(e,null,2)+'\n');
const secs=ms=>(ms/1000).toFixed(3);
const rows=e.evaluations.map(r=>`| ${r.id} | ${r.status} | ${secs(r.elapsedMs)} | ${r.aiCostRub} | ${r.reason} |`).join('\n');
const sources=e.sourceSummary.flatMap(r=>r.sources.map(x=>`| ${r.name} | ${x.source} | ${x.resultCount} / ${x.acceptedCount??'—'} | ${x.status} | ${x.durationMs==null?'—':secs(x.durationMs)} | ${x.reason??'—'} |`)).join('\n');
const ai=e.newPaidUsage.slice().reverse().map(r=>`| ${r.callType} | ${r.id} | ${r.inputTokens}/${r.outputTokens} | ${r.chargedCostRub} | ${r.durationMs} | ${r.status} |`).join('\n');
const shots=e.screenshots.map(r=>`- [${path.basename(r.file)}](../${r.file.replace(/^docs\//,'')}) — ${r.width}×${r.height}, ${r.capturedAt}`).join('\n');
const report=`# LIVE: поиск и AI v3.2.2

Итог: **FAIL** по полной совокупности сценариев. Найдены два предметных дефекта AI; заданный способ проверки недоступного провайдера блокируется конфигурацией. Бюджетный отказ и работа без ключа подтверждены.

Период: ${e.startedAt} — ${e.endedAt} (UTC). Ветка: feature/ux-search-v3.2.2, HEAD: ${e.environment.commit}, BUILD_ID: ${e.environment.buildId}. Сборка дождалась BUILD_ID, использована существующая .next-v322-rc; src, ветка и .env не менялись, коммитов нет.

Стенд: next start на 127.0.0.1:3372 и отдельный настоящий search worker (tsx src/worker/property-search-worker.ts), PostgreSQL crm_demo на 127.0.0.1:55432. Вход руководителя — из переменных процесса. Синтетическая демо-база, реальные внешние площадки и Yandex AI; SCRAPER_DEMO_FIXTURES=false. API через Playwright с сессионной cookie и Origin, сравнение/бюджетный отказ нажаты в UI. Глубина: 1 страница, до 5 объявлений на источник, deadline 55 с. Браузерный режим скрапера отключён для ограниченного сетевого прогона; интерактивную CAPTCHA не проходили.

## Сценарии

Точный запрос: «Аренда офиса 50–100 м² в Новосибирске до 80 000 в месяц». Настройки и ограничения менялись только через /api/v1/settings/ai — API форм /settings/ai и /settings/sources. Разбор /analysis/parse → /analysis/parse/confirm → /runs → /progress и /results. Источники и сохранённые записи доступны в полном JSON.

| Сценарий | Итог | Время, с | Новые расходы, ₽ | Фактический результат |
|---|---|---:|---:|---|
${rows}

Время a/b включает разбор и поиск, c — отдельный AI API запрос, d — отказ и ручной поиск, e — ожидание readiness и запросы, f — старт, AI-отказ и ручной поиск; UI-навигация и скриншоты в эти интервалы не включены. Сырые времена шагов есть в JSON.

b PASS означает корректную работу режима и отображение частичных результатов. Полный охват трёх/семи площадок не подтверждён: coverage=PARTIAL. Во всех новых выдачах подтверждённых совпадений 0. OnRealt: 5 требуют проверки; в трио/семи: 7 требуют проверки и 3 исключены. Неизвестный период ставки не позволяет подтвердить бюджет 80000 ₽/мес.

Для b использовались исправленные ручные фильтры с priceTo=80000; AI сохраняет их. Это проверка повторного разбора/подтверждения, а не независимое успешное извлечение цены с пустой формы. В runs confirmedPaid=false: AI действует отдельными явными операциями, автоматического платного анализа каждой карточки и Web Search нет.

## Источники по каждому поиску

Числа — получено / принято (принято = сохранено без rejected, а не подтверждено). Время — durationMs источника. CAPTCHA/блокировки не обходились, повторных массовых проб не было.

| Поиск | Площадка | Объявления | Статус | Время, с | Причина |
|---|---|---:|---|---:|---|
${sources}

В c новых внешних поисков нет: анализируются три OnRealt из a. В e объявления не получены, API не создал поиск из-за ошибки конфигурации. В d/f источник OnRealt success, AI расход 0. В остальных площадках d/f запросов нет.

## AI-журнал и контроль стоимости

До прогона: ${e.budget.baselineRub} ₽ — семь исторических записей синтетической базы, они исключены из затрат этого испытания. На прогон выставлен месячный потолок ${e.budget.monthlyLimitRub} ₽, то есть оставалось 4.995 ₽; лимит новых операций — 12, автоматический веб-резерв отключён. Фактически: **${e.budget.newPaidCalls} платных вызовов, ${e.budget.actualRunRub} ₽**, reservedRub=0; текущий итог журнала ${e.finalUsage.committedRub} ₽. Все пять записей success, без повторных оплат.

| Тип | ID записи AI-журнала | Токены in/out | Списано, ₽ | Время, мс | Статус |
|---|---|---:|---:|---:|---|
${ai}

Источник расходов: /api/v1/ai/usage. Это расчёт CRM по её тарифам; независимая сверка облачного биллинга не выполнялась. Для d лимит снижен до 4.42 ₽ при committed=4.423500 ₽: форма разрешает только две десятичные цифры, поэтому применено округление вниз. Отказ 422 AI_BUDGET_EXHAUSTED за ${e.budgetExhausted.elapsedMs} мс не создал запись и не увеличил расход. UI: «Не удалось подготовить черновик: проверьте лимиты ИИ или уточните исходные данные».

## Дефекты и ограничения

1. **AI-01, P1 — теряется верхняя цена.** Пустые текущие условия + точный заданный запрос дают rent, office, 50–100, rub_month, но без priceTo. /analysis/parse/confirm подтверждает потерю. Корень по коду: [listing-analysis.ts:26](../../src/modules/ai/domain/listing-analysis.ts#L26), preserveSearchConditions пропускает изменение цены только при словах «цен/бюджет/руб/стоим»; в данном запросе этих слов нет. Ожидание: priceTo=80000. Перед внешним поиском ограничение вручную восстановлено. Исходный ответ сохранён в parseOne; модель и post-processing отдельно не трассировались, поэтому источник ошибки до этого слоя не утверждается.
2. **AI-02, P1 — выдумывается совместимость периодов цены.** Snapshot у выбранных объявлений содержит priceUnit=null; ruleChecks признаёт цену/период unknown. Однако [persistListing:64](../../src/modules/property-search/application/search-service.ts#L64) записывает отсутствующий период как total; [draftSelectionText:191](../../src/modules/ai/application/listing-analysis-service.ts#L191) отдаёт его модели, а [строка 201](../../src/modules/ai/application/listing-analysis-service.ts#L201) сравнивает цены как совместимые. LIVE-ответ: «29670 единиц валюты (общая)» и «Цена ниже: остаётся больше бюджета». Ожидание: период неизвестен, ценовое сравнение невозможно до проверки. Адреса/площади/числа не выдуманы, предупреждение о непроверенности присутствует. Сравнение: 2.609 с, 0.066100 ₽; анализ отдельного входа трёх объявлений: 5.456 с, 0.116700 ₽, все unknown. Отдельного AI-ранжирования в текущей выдаче не найдено; проверенный серверный sort=match возвращает пять score=0, что не доказывает осмысленное AI-ранжирование.
3. **AI-03 — ограничение тестируемости сценария e.** При YANDEX_CLOUD_BASE_URL=http://127.0.0.1:9 приложение отвергает общую конфигурацию: [env.ts:80](../../src/shared/config/env.ts#L80); тот же allowlist есть в [клиенте Yandex:32](../../src/modules/ai/infrastructure/yandex-responses-client.ts#L32). /api/health/ready=500, POST /api/v1/property-search/runs=500 INTERNAL_ERROR. Указанный сценарий FAIL: ручной поиск не работает. Это **не** доказательство поведения при реальном сетевом отказе официального адреса; такой отказ не воспроизведён. Код не менялся, проверка не обходилась.

Наблюдение по cacheHits=6/9 при requested=3 оставлено в JSON без статуса дефекта: кеш и сетевые запросы — разные счётчики, их происхождение дополнительно не проверено.

## Скриншоты

Шесть подлинных PNG 1366×768, без подмены DOM/ответов и без ключей. Выдачи повторно открыты по свежим LIVE runId; UI пишет REPLAY для сохранённых данных, это не новый сетевой поиск и не фикстура. Скриншоты 04/05 показывают реальные UI ответы анализа/отказа; 06 — статус отсутствующего подключения.

${shots}

## Завершение и воспроизведение

Собственные server/worker и браузер остановлены, отсутствие слушателя 3372 и собственных server/worker PID проверено отдельной командой. Harness PID 38064 завершён после сохранения результатов. Исходные настройки источников, ИИ и браузерного режима восстановлены через API; месячный потолок 9.02 ₽ оставлен как безопасное ограничение. Чужие процессы не останавливались. Private-data и XLSX не читались; обнаруженные сторонние изменения рабочей копии не менялись.

Harness: scripts/perf/live-search-v322-ai.cjs, запуск node --env-file=.env scripts/perf/live-search-v322-ai.cjs; это операторский интерактивный инструмент, сам AI не вызывает, команды выполняются через stdin. Форматирование готовых доказательств: node scripts/perf/live-search-v322-ai-report.cjs (офлайн, без .env). Полный протокол: [live-search-v322-ai.json](live-search-v322-ai.json). Повтор LIVE требует новой квоты; этот отчёт фиксирует только выполненный прогон.

Автоматическая проверка отклонила первоначальную попытку поиска после потери цены как несоответствующую ограничению пользователя. Поиск без priceTo не выполнялся; продолжение прошло только с вручную восстановленными 80000.
`;
fs.writeFileSync(path.resolve('docs/vkr/live-search-v322-ai.md'),report);
console.log(JSON.stringify({overall:e.overall,spent:e.budget.actualRunRub,paidCalls:e.budget.newPaidCalls,screenshots:e.screenshots.length,evaluations:e.evaluations.map(r=>({id:r.id,status:r.status}))}));
