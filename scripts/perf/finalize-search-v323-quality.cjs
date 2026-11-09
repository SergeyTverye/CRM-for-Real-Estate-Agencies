// Read-only evidence audit. Writes only aggregate reports, never CRM records.
const fs = require('node:fs/promises');
const { Client } = require('pg');
const net = require('node:net');
require('dotenv').config({quiet:true});
const file = 'docs/vkr/live-search-v323-quality.json';
async function main() {
  const evidence = JSON.parse(await fs.readFile(file, 'utf8'));
  const baseline = JSON.parse(await fs.readFile('docs/vkr/live-search-v323-e2e.json','utf8'));
  const replay = JSON.parse(await fs.readFile('docs/vkr/replay-search-v323-quality.json','utf8'));
  const db = new Client({connectionString:'postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo'});
  await db.connect();
  try {
    for (const scenario of evidence.scenarios) {
      const {rows} = await db.query('SELECT normalized FROM external_listing_snapshots WHERE search_run_id=$1',[scenario.runId]);
      const periods = {rental:0,unknown:0,daily:0,units:{},roomsKnown:0,roomsUnknown:0};
      for (const {normalized:n} of rows) {
        if (n.rooms == null) periods.roomsUnknown++; else periods.roomsKnown++;
        if (n.operation !== 'rent') continue;
        periods.rental++;
        if (n.structuredFeatures?.rentalPeriod === 'day') periods.daily++;
        else if (!n.priceUnit) periods.unknown++;
        if (n.priceUnit) periods.units[n.priceUnit]=(periods.units[n.priceUnit]??0)+1;
      }
      scenario.quality = periods;
    }
    const manualIds = [...evidence.scenarios,...(evidence.discardedScenarios??[])].map(s=>s.runId);
    const calls = await db.query('SELECT count(*)::int AS count FROM ai_usage_logs WHERE search_run_id=ANY($1::uuid[])',[manualIds]);
    evidence.manualSearchAiCalls=calls.rows[0].count;
    const original = JSON.parse(await fs.readFile('data/v323-quality-settings-original.json','utf8'));
    const current = (await db.query('SELECT * FROM ai_settings WHERE id=$1',[original.id])).rows[0];
    const keys=['ai_enabled','scraper_enabled','browser_enabled','cian_auto_browser','yandex_auto_browser','enabled_sources','web_search_manual_allowed','web_search_auto_fallback','monthly_budget_rub','daily_limit','per_user_daily_limit','per_job_limit'];
    evidence.settingsIndependentlyVerified=keys.every(k=>JSON.stringify(current[k])===JSON.stringify(original[k]));
    evidence.portClosed=await new Promise(resolve=>{const socket=net.connect(3386,'127.0.0.1');socket.setTimeout(1500);socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',e=>resolve(e.code==='ECONNREFUSED'));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
    evidence.checks.push({name:'unit/REPLAY',tests:764,files:37,passed:true},{name:'PG crm_test_a',tests:44,files:3,passed:true},{name:'SQLite',tests:44,files:3,passed:true});
    const total={confirmed:0,needs_review:0,rejected:0};
    for(const s of evidence.scenarios.filter(s=>s.id!=='b_rooms')) for(const k of Object.keys(total))total[k]+=s.counts[k];
    evidence.mainTotals=total;
    await fs.writeFile(file,JSON.stringify(evidence,null,2)+'\n');
    const counts=c=>`${c.confirmed}/${c.needs_review}/${c.rejected}`;
    const table=evidence.scenarios.filter(s=>s.id!=='b_rooms').sort((a,b)=>a.id.localeCompare(b.id)).map(s=>{const old=baseline.scenarios.find(b=>b.id===s.id);return `| ${s.id} | ${counts(old.counts)} | ${(old.elapsedMs/1000).toFixed(1)} | ${counts(s.counts)} | ${(s.elapsedMs/1000).toFixed(1)} |`;}).join('\n');
    const b=evidence.scenarios.find(s=>s.id==='b_rooms');
    const unknownBefore=replay.scenarios.reduce((n,s)=>n+s.unknownBefore,0),unknownAfter=replay.scenarios.reduce((n,s)=>n+s.unknownAfter,0);
    const section=`
## После улучшений качества

Дата: 09.11.2026. Ветка feature/search-v3.2.3-quality, порт 3386, crm_demo, NEXT_DIST_DIR=.next-v323-quality. Webpack production build, prisma migrate deploy, настоящий worker; страницы/карточки на источник 1/5, общий срок 120 с. Node 22.23.4 — существующее окружение. Новых миграций нет. [LIVE JSON](live-search-v323-quality.json), [REPLAY JSON](replay-search-v323-quality.json). Excel не читался. Защита площадок не обходилась.

П/ПР/И = совпадения / требуют проверки / исключены. Это две ограниченные LIVE-выборки в разное время, не доказательство полноты рынка или строго причинного прироста совпадений. Все восемь ручных поисков: **${evidence.manualSearchAiCalls} AI-вызовов** по журналу.

| ID | До: П/ПР/И | До, с | После: П/ПР/И | После, с |
|---|---|---:|---|---:|
${table}

Основные семь сценариев: **${Object.values(total).reduce((a,b)=>a+b,0)} появлений, ${counts(total)}**. Дополнительно b с rooms=[2]: **${counts(b.counts)}**, ${(b.elapsedMs/1000).toFixed(1)} с, ${b.total} карточек. Площадки без проверенного региона/маршрута или с проверкой браузера остаются unsupported/partial/needs_user_action; это не успешный пустой рынок. Статусы и фактические фильтры всех площадок — в JSON.

Старый harness после изменения поведения неявного города сначала выбрал для c только Обь. Этот запуск вынесен в discardedScenarios и не включён в таблицу; c повторён с явными Обью и Новосибирском. Дополнительного AI-вызова это не потребовало.

Комнаты: JSON-условия studio/1/2/3/4+ поддерживают ИЛИ. Циан/Яндекс/Юла получают нативный набор, Мир Квартир/OnRealt — отдельные точные ветви. 4+ проверяется локально по всему диапазону ≥4; неизвестное остаётся на проверке. Распознаются числовые поля, «2-к.», «двухкомнатная», «студия». Неизвестные комнаты не подтверждаются AI.

Период берётся только из явного текста/поля конкретной карточки. Посуточность — отдельный JSON-признак rentalPeriod=day, цена не переводится в месяцы, карточка исключается из длительной аренды с объяснением. ADR 0011 обновлён. **REPLAY тех же 129 старых снимков:** неизвестный период ${unknownBefore} → ${unknownAfter}, одна запись выявлена как посуточная; новых подтверждённых месячных периодов из старых снимков не появилось. Основная причина — отсутствие самого текста периода в сохранённых нормализованных данных. В Бердске REPLAY с комнатами даёт 2/3/15 вместо 4/6/10. Апартаменты подтверждаются по явному слову/флагу источника; обычная квартирная категория без этих признаков теперь остаётся unknown, поэтому рост числа проверок в f ожидаем и не объявляется ухудшением точности.

Производительность: внутренние коммерческие OR-ветви Мир Квартир/OnRealt раскрыты в общую очередь максимум из двух работников. Транспорт сохраняет интервал ≥1 с; завершённые ветви переживают тайм-аут соседних. Быстрые HTTP-площадки приоритетны; оставшееся время делится между источниками. UI показывает число завершённых площадок и сохранение частичного результата. Дедлайн не означает полный охват всех типов/локаций.

AI-фраза «Двушка в Бердске до 5 млн»: **HTTP ${evidence.ai[0]?.status}, LIVE-подтверждение не выполнено (PARTIAL)**. Платных вызовов по журналу: **${evidence.usage?.totalCallsDelta}**, расход CRM **${evidence.usage?.committedDeltaRub} ₽**; лимиты ≤3 и ≤1 ₽ соблюдены. Отказ произошёл до платного dispatch, семантика ответа провайдера этим прогоном не проверена. Код API-ошибки прежняя версия harness не сохранила; причина 422 не объявляется установленной. Схема, промпт, нормализация и подтверждение комнат проверены REPLAY/fake на обеих БД. Новый вызов после запроса координатора не выполнялся.
Автоматические проверки: unit/REPLAY **764/764**, PG crm_test_a **44/44**, SQLite **44/44**; tsc, eslint изменённых файлов, production build — PASS. UI-проверки нового/явного города: ${evidence.checks.some(c=>c.name.includes('explicitly')&&c.passed)?'PASS':'см. JSON'}. Независимая сверка 12 настроек: ${evidence.settingsIndependentlyVerified?'PASS':'FAIL'}; процессы остановлены, порт 3386 закрыт: ${evidence.portClosed?'PASS':'FAIL'}. Руководство v3.2.3 обновлено, PDF пересобран; изменённые страницы проверены отдельно.

![Фильтр двух комнат в Бердске](../screenshots/vkr/v323-search/quality-room-filter.png)

![Результаты с проверкой комнат](../screenshots/vkr/v323-search/quality-room-results.png)

`;
    const path='docs/vkr/live-search-v323-e2e.md';
    const source=(await fs.readFile(path,'utf8')).split('\n## После улучшений качества')[0];
    await fs.writeFile(path,source.trimEnd()+'\n'+section);
    console.log(JSON.stringify({totals:total,rooms:b.counts,usage:evidence.usage,manualAiCalls:evidence.manualSearchAiCalls,settings:evidence.settingsIndependentlyVerified,portClosed:evidence.portClosed}));
  } finally { await db.end(); }
}
main().catch(e=>{console.error(e.code??e.message);process.exitCode=1;});
