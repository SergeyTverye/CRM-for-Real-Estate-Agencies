const fs=require('node:fs');const file='docs/vkr/live-search-v322-ai.json',all=JSON.parse(fs.readFileSync(file,'utf8')),e=all.retest;const s=e.scenarios;
const cost=(a,b)=>(Number(b.committedRub)-Number(a.committedRub)).toFixed(6);
const paid=e.newPaidUsage;const pc=type=>paid.filter(x=>x.callType===type);const first=pc('parse').find(x=>x.id==='cc1af11c-c730-4612-a366-a8393dca5233');const second=pc('parse').find(x=>x.id==='0eeb9df6-5ab5-4677-a02a-669c2da36c24');
e.sourceSummary=s.map(r=>({name:r.name,runId:r.id,startedAt:r.startedAt,elapsedMs:r.elapsedMs,total:r.results.total,counts:r.results.counts,sources:r.progress.sources.map(x=>({source:x.source,status:x.status,resultCount:x.resultCount,acceptedCount:x.acceptedCount,durationMs:x.durationMs,reason:x.reason}))}));
const detail=i=>s[i].progress.sources.map(x=>`${x.source}: ${x.resultCount} (${x.status})`).join('; ');
e.evaluations=[
{id:'a / AI-01',status:e.parseOne.confirm.body.filters.priceTo==='80000'?'PASS':'FAIL',startedAt:e.parseOne.startedAt,elapsedMs:e.parseOne.response.ms+e.parseOne.confirm.ms+s[0].elapsedMs,costRub:first.chargedCostRub,reason:'priceTo=80000 без ручной правки; rent, office, 50–100 м², rub_month. '+detail(0)},
{id:'b / 7 площадок',status:'PASS',coverage:'PARTIAL',startedAt:e.parseAll.startedAt,elapsedMs:e.parseAll.response.ms+e.parseAll.confirm.ms+s[1].elapsedMs,costRub:second.chargedCostRub,reason:'AI: sale, retail, priceTo=30000000, rub_total; все 7 источников запрошены. '+detail(1)},
{id:'c / AI-02',status:'PASS',startedAt:e.comparison.startedAt,elapsedMs:e.comparison.response.ms,costRub:cost(e.comparison.usageBefore,e.comparison.usageAfter),reason:'3 LIVE объявления (OnRealt 2, mirkvartir 1), snapshot.priceUnit=null. UI: период не указан; AI: период неизвестен, цены несопоставимы; все 6 попарных tradeoffs запрещают ценовое сравнение.'},
{id:'d / AI-ранжирование',status:'FAIL',startedAt:e.ranking.startedAt,elapsedMs:e.ranking.response.ms,costRub:cost(e.ranking.usageBefore,e.ranking.usageAfter),reason:'UI-кнопка нажата на тех же 3 объявлениях. HTTP 422 AI_INVALID_JSON_RESULT; порядок не показан; ledger status=error, списание 0.090300 ₽. Одна попытка, без повтора.'},
{id:'e / бюджет',status:'PASS',startedAt:e.budgetExhausted.startedAt,elapsedMs:e.budgetExhausted.parse.ms+e.budgetExhausted.rank.ms+e.budgetExhausted.compare.ms+s[2].elapsedMs,costRub:cost(e.budgetExhausted.usageBefore,e.budgetExhausted.usageAfter),reason:'Потолок '+e.budgetExhausted.limitRub+' ₽ ниже committed 4.729400 ₽. parse/rank/compare: 422 AI_BUDGET_EXHAUSTED, новых записей/списаний нет. Ручной поиск: '+detail(2)},
{id:'f / без ключа',status:'PASS',startedAt:e.missingKey.startedAt,elapsedMs:e.missingKey.bootMs+e.missingKey.aiRequest.ms+s[3].elapsedMs,costRub:cost(e.preMissingUsage,e.finalUsage),reason:'Ключ пуст только в окружении собственных server/worker; readiness=200, credentials_missing, AI=409 AI_CREDENTIALS_MISSING; UI подключения понятен. Ручной поиск: '+detail(3)}];
e.overall='FAIL';e.defects=[{id:'AI-RANK-LIVE-01',status:'OPEN',httpStatus:422,code:'AI_INVALID_JSON_RESULT',correlationId:e.ranking.response.body.error.correlationId,description:'LIVE-ранжирование трёх объявлений не сформировало рекомендацию; оплаченный ответ отклонён серверной валидацией.',rootCause:'Не установлена: сырой ответ провайдера не снимался, src не менялся.'}];
e.cleanup.port3374ListenerAbsent=true;e.cleanup.ownServerWorkerPidsAbsent=true;e.cleanup.checkedAt=new Date().toISOString();e.limitations=['ТЗ.txt отсутствует; выполнено конкретное поручение ретеста существующего приложения.','Синтетическая crm_demo; LIVE площадки, реальные Yandex AI-вызовы; private-data и XLSX не читались.','Глубина 1 страница, до 5 карточек на источник, deadline 55 с, browserEnabled=false, confirmedPaid=false в runs; платные действия выполнены отдельно.','Скриншоты сохранённых свежих LIVE runId честно помечены REPLAY; не новые поиски и не подмена ответа.','Стоимость рассчитана журналом CRM, облачный счёт независимо не сверялся; неуспешный ответ ранжирования включён в расходы.','AI-03: ссылка на ранее выполненный автотест, LIVE отказ провайдера не моделировался.'];
fs.writeFileSync(file,JSON.stringify(all,null,2)+'\n');
const sec=ms=>(ms/1000).toFixed(3);const table=e.evaluations.map(x=>`| ${x.id} | ${x.startedAt} | ${sec(x.elapsedMs)} | ${x.costRub} | ${x.status}${x.coverage?' / охват PARTIAL':''} | ${x.reason} |`).join('\n');
const sourceRows=e.sourceSummary.flatMap(r=>r.sources.map(x=>`| ${r.name} | ${x.source} | ${x.resultCount} / ${x.acceptedCount??'—'} | ${x.status} | ${sec(x.durationMs??0)} | ${x.reason??'—'} |`)).join('\n');
const ai=paid.slice().reverse().map(x=>`| ${x.id} | ${x.callType} | ${x.inputTokens}/${x.outputTokens} | ${x.chargedCostRub} | ${x.status} |`).join('\n');
const text=`

## Повторная проверка после исправлений (0b8edb4)

Итог повторной проверки: **FAIL** из-за LIVE-ранжирования. AI-01 и AI-02 подтверждены как исправленные. Сценарии a, b, c, e, f — PASS; охват рынка в b — PARTIAL из-за ограничений площадок. Исторический протокол выше сохранён без изменений.

Период ${e.startedAt} — ${e.endedAt} UTC. HEAD ${e.environment.commit}; готовая сборка .next-v322-rc2, отдельный next start 127.0.0.1:3374 и search worker с одинаковым окружением: DATABASE_URL указывает на crm_demo/55432, APP_ORIGIN=3374, AI_ENABLED=true, SCRAPER_ENABLED=true, SCRAPER_DEMO_FIXTURES=false. Порт 3373 не использовался. Вход руководителя через переменные процесса; ключ не выводился и не сохранялся. Исходные файлы src, .env и ветка не менялись; коммитов нет.

### Сценарии и время

Точный запрос a: «Аренда офиса 50–100 м² в Новосибирске до 80 000 в месяц». До разбора priceTo отсутствовал; после /analysis/parse и /parse/confirm получен 80000 без коррекции. Запрос b: «Продажа торгового помещения в Новосибирске до 30 млн рублей» с отдельными пустыми ценовыми условиями. UI-кнопки сравнения и ранжирования нажимались Playwright; сырой request/response сохранён в retest.comparison и retest.ranking.

| Сценарий | Начало UTC | Время, с | Расход, ₽ | PASS/FAIL | Объявления по площадкам, статусы и результат |
|---|---|---:|---:|---|---|
${table}

Время a/b: AI-разбор + подтверждение + очередь/поиск; c/d: запрос из UI; e: три отказа API + ручной поиск; f: readiness нового процесса + отказ AI + ручной поиск. Навигация/скриншоты и операторские паузы исключены. Общие timestamps и длительности отдельных этапов — в JSON.

В a/e/f: 10 полученных, 7 требуют проверки, 3 исключены, подтверждённых совпадений 0. В b: 12 полученных, 4 подтверждены, 7 требуют проверки, 1 исключён. «Принято» ниже означает сохранено без rejected, а не подтверждённое совпадение. OnRealt для торговли использует ПСН и сообщает неполный охват. CAPTCHA и блокировки не обходились.

### Площадки

| Поиск | Площадка | Получено / принято | Статус | Время, с | Причина/ограничение |
|---|---|---:|---|---:|---|
${sourceRows}

### Бюджет и LIVE-дефект ранжирования

Базовый расход ${e.budget.baselineRub} ₽; потолок на прогон установлен 7.42 ₽ (новый резерв менее 3 ₽). Итог **${e.budget.actualRunRub} ₽, ${e.budget.newPaidCalls} платных вызова**, включая неуспешное ранжирование, reservedRub=${e.finalUsage.reservedRub}. Финальный committed=${e.finalUsage.committedRub} ₽. Все три запроса при исчерпанном бюджете и запрос без ключа не создали новых записей AI-журнала. Автоматический Web Search отключён. Это учёт CRM по настроенным тарифам, не независимая сверка биллинга Yandex Cloud.

| AI usage ID | Тип | Токены in/out | Списано, ₽ | Статус |
|---|---|---:|---:|---|
${ai}

**AI-RANK-LIVE-01: FAIL.** Кнопка «Ранжировать выбранные с ИИ» существует и доступна на трёх выбранных объявлениях. Ответ за 3.248 с: HTTP 422, AI_INVALID_JSON_RESULT, correlationId=${e.ranking.response.body.error.correlationId}. Рекомендованный порядок не показан. UI выводит «Не удалось подготовить черновик: проверьте лимиты ИИ или уточните исходные данные». Предыдущий текст сравнения остаётся виден. Ответ провайдера отклонён сервером. точная причина без сырого ответа не установлена. Повторных платных попыток не было. Пройденные fake/REPLAY тесты не заменяют этот LIVE-результат.

**AI-03: только ссылка на автотест.** Согласно [протоколу исправлений](v322-ai-fixes.md), [search-readiness-security-regressions.test.ts](../../tests/integration/search-readiness-security-regressions.test.ts) проверяет injected fetch reject/abort реального Yandex-клиента с официальным URL: контролируемый AI_CALL_FAILED, работающий ручной поиск и readiness=200. В этом ретесте тест не запускался заново. недоступность провайдера LIVE не моделировалась.

### Скриншоты 1366×768

${e.screenshots.map(x=>`- [${x.file.split('/').pop()}](../screenshots/vkr/v322-search-ai/${x.file.split('/').pop()}) — ${x.capturedAt}.`).join('\n')}

01 — сравнение и запрет ценовых выводов; 02 — ошибка ранжирования после нажатия кнопки; 03 — сохранённая выдача продажи (часть блока источников вне кадра; полный статус всех семи в таблице/JSON); 04 — понятный статус отсутствующего ключа и доступный ручной поиск. Подлинные UI, без подмены DOM/ответов.

### Завершение

Исходные настройки ИИ/источников восстановлены через API (HTTP 200), включая потолок 9.02 ₽. Собственные server/worker остановлены; отдельной проверкой подтверждены отсутствие слушателя 3374 и PID 26816/28076/14768/28676. Браузер закрыт. Первый запуск внутри sandbox вернул EACCES; его собственные PID 35724/34288 с дочерними процессами остановлены перед успешным запуском вне sandbox. Секреты оставались в окружении процессов. Private-data и *.xlsx не читались. Сторонние изменения рабочей копии сохранены.

Доказательства добавлены отдельным ключом retest в [JSON](live-search-v322-ai.json); прежние результаты не заменены. Операторский harness: scripts/perf/live-search-v322-ai-retest.cjs; запуск через node --env-file=.env, повтор требует отдельной квоты. Отчёт сформирован офлайн scripts/perf/live-search-v322-ai-retest-report.cjs.
`;
fs.appendFileSync('docs/vkr/live-search-v322-ai.md',text);console.log(JSON.stringify({overall:e.overall,cost:e.budget.actualRunRub,calls:e.budget.newPaidCalls,checks:e.evaluations.map(x=>({id:x.id,status:x.status}))}));
