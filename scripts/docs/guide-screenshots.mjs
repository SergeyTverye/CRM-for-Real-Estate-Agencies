/** Synthetic demo ONLY. Run from repo root:
 * node --env-file=.env scripts/docs/guide-screenshots.mjs http://127.0.0.1:3373
 * Optional: --run-id UUID (must belong to manager or realtor1).
 * Never starts searches, AI, probes, backups or imports. Creates one synthetic
 * client and draft agreement with two tiny synthetic PDFs for document screens.
 * No credentials, response bodies, browser storage or HTML dumps are persisted.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const base = new URL(argv[0] || 'http://127.0.0.1:3373');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
    base.pathname !== '/' || base.search || base.hash) throw Error('Expected root http(s) URL without credentials.');
const explicitRun = argv.includes('--run-id') ? argv[argv.indexOf('--run-id') + 1] : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (explicitRun && !uuid.test(explicitRun)) throw Error('Invalid --run-id UUID.');
for (const role of ['MANAGER', 'REALTOR1']) for (const field of ['LOGIN', 'PASSWORD']) {
  if (!process.env[`SEED_${role}_${field}`]) throw Error(`Missing SEED_${role}_${field}`);
}
const out = resolve('docs/user-guide/v3.2.2/images/live');
await mkdir(out, { recursive: true });
const report = { baseURL: base.origin, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
  startedAt: new Date().toISOString(), screenshots: [], steps: [], created: [], blocked: {}, complete: false };
const countBlock = reason => { report.blocked[reason] = (report.blocked[reason] || 0) + 1; };
const browser = await chromium.launch({ headless: true });
let currentRole;
const errors = [];
let savedResultsCaptured = false;
let checkpoint = 'initialization';
const checkpointAt = name => { checkpoint = name; console.log(`STAGE ${name}`); };

async function step(name, fn) {
  checkpoint = name;
  try { await fn(); report.steps.push({ name, role: currentRole, status: 'PASS' }); console.log(`OK ${name}`); }
  catch (error) {
    // Locator/HTTP failures only: never serialize complete Playwright errors,
    // response bodies or call arguments (they could contain credentials).
    const reason = error.name === 'TimeoutError' ? 'UI timeout; inspect the related screenshot/selector' : 'Step failed; check page availability and demo data';
    errors.push(name); report.steps.push({ name, role: currentRole, status: 'FAIL', checkpoint, reason }); console.log(`FAIL ${name} at ${checkpoint}: ${reason}`);
  }
}

async function go(page, path) {
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw Error('External navigation denied');
  const res = await page.goto(url.href, { waitUntil: 'networkidle', timeout: 60000 });
  if (!res?.ok() || new URL(page.url()).pathname !== url.pathname) throw Error('Page unavailable or redirected');
  await page.evaluate(() => document.fonts.ready);
}

async function capture(page, name, targets = [], extra = {}) {
  await page.evaluate(() => document.fonts.ready);
  // Defense in depth for the AI connection screen: mask all text-entry values.
  // Labels/budget status stay visible; no secrets are read into this process.
  const secretPage = new URL(page.url()).pathname === '/settings/ai';
  const mask = secretPage ? page.locator('input:not([type=checkbox]):not([type=radio]), textarea') : page.locator('input[type=password]');
  const file = `${name}.png`;
  await page.screenshot({ path: join(out, file), fullPage: false, animations: 'disabled', mask: [mask], maskColor: '#CBD5E1' });
  const elements = [];
  const defaults = [['heading', page.getByRole('heading', { level: 1 }).first()],
    ['navigation', page.getByRole('navigation').first()]];
  for (const [label, locator] of [...defaults, ...targets]) {
    if (!await locator.count()) { elements.push({ label, found: false }); continue; }
    const box = await locator.first().boundingBox();
    const visible = box && box.x < 1440 && box.y < 900 && box.x + box.width > 0 && box.y + box.height > 0;
    elements.push({ label, found: true, visible: Boolean(visible), cssBox: box,
      pixelBox: box ? Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 2)])) : null });
  }
  // A compact inventory of visible controls gives annotators useful boxes even
  // when UI labels changed. Values and general page text are never collected.
  const controls = await page.locator('button,summary,h1,h2,[role=tab]').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.top >= 900 || r.bottom <= 0) return null;
    return { label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 140),
      tag: el.tagName.toLowerCase(), cssBox: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }).filter(Boolean));
  const metadata = { file, role: currentRole, path: new URL(page.url()).pathname,
    query: new URL(page.url()).search, viewport: report.viewport, deviceScaleFactor: 2,
    scroll: await page.evaluate(() => ({ x: scrollX, y: scrollY })), capturedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(await readFile(join(out, file))).digest('hex'),
    elements, controls, ...extra };
  await writeFile(join(out, `${name}.json`), JSON.stringify(metadata, null, 2) + '\n');
  report.screenshots.push(metadata);
}

async function clickVisible(page, role, name) {
  const target = page.getByRole(role, { name, exact: true }).first();
  await target.scrollIntoViewIfNeeded(); await target.click(); return target;
}

async function discover(page, list, kind) {
  await go(page, list);
  return page.locator('a[href]').evaluateAll((els, prefix) => els.map(e => e.getAttribute('href'))
    .find(h => new RegExp(`^${prefix}/[0-9a-f-]{36}$`, 'i').test(h)) || null, `/${kind}`);
}

function pdfFile(name) {
  // Minimal actual PDF, ASCII contents and byte-correct xref; synthetic only.
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
  const text = 'BT /F1 14 Tf 30 130 Td (Synthetic CRM guide example only) Tj ET';
  objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(body) };
}

try {
  const ready = await fetch(new URL('/api/health/ready', base), { signal: AbortSignal.timeout(15000) });
  if (ready.status !== 200) throw Error('Readiness not 200');
  for (const role of ['REALTOR1', 'MANAGER']) {
    currentRole = role;
    const context = await browser.newContext({ baseURL: base.origin, viewport: report.viewport,
      deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Asia/Novosibirsk', serviceWorkers: 'block' });
    let documentWrites = false, uploadNumber = 0, syntheticClientId = null;
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== base.origin) { countBlock('external'); return route.abort('blockedbyclient'); }
      // Deny paid/side-effecting paths regardless of HTTP verb, including probes.
      if (/\/analysis(?:\/|$)|\/ai\/(?:generate|chat)|\/web-search|\/browser-sessions/.test(url.pathname)) {
        countBlock('AI/external-operation'); return route.abort('blockedbyclient');
      }
      if (['GET', 'HEAD'].includes(request.method())) return route.continue();
      if (documentWrites && request.method() === 'POST' && url.pathname === '/api/v1/agreements') {
        const data = request.postDataJSON();
        if (data.clientId === syntheticClientId && String(data.agreementNumber || '').startsWith('Пример ')) return route.continue();
      }
      if (documentWrites && request.method() === 'POST' && url.pathname === '/api/v1/documents') {
        uploadNumber++;
        // Explicitly labelled simulated failure for the failed-only retry screenshot.
        if (uploadNumber === 2) {
          report.steps.push({name:'injected-document-failure',role,status:'INFO',httpStatus:503,uploadNumber,source:'Playwright route.fulfill; not CRM server'});
          console.log('INJECTED учебный HTTP 503: second document upload; not CRM server');
          return route.fulfill({ status: 503, json: { error: {
          code: 'UNAVAILABLE', message: 'Пример: учебный сбой загрузки. Повторите только этот файл.' } } });
        }
        return route.continue();
      }
      countBlock('unapproved-mutation'); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('response', response => {
      const req=response.request(), path=new URL(response.url()).pathname;
      if(req.method()==='POST' && ['/api/v1/agreements','/api/v1/documents'].includes(path)) {
        report.steps.push({name:'document-http',role,checkpoint,method:'POST',path,status:response.status()});
        console.log(`HTTP POST ${path} ${response.status()}`);
      }
    });
    // Never save trace/HAR/storageState: they can contain credentials/sessions.
    page.on('dialog', dialog => void dialog.accept());
    if (role === 'REALTOR1') await step('login', async () => {
      await go(page, '/login'); await capture(page, 'login', [['login-form', page.locator('form')]]);
    });
    const auth = await context.request.post('/api/v1/auth/login', { headers: { origin: base.origin },
      data: { login: process.env[`SEED_${role}_LOGIN`], password: process.env[`SEED_${role}_PASSWORD`] } });
    if (!auth.ok() || (await auth.json()).mustChangePassword) throw Error('Prepare demo account before capture');
    const pages = role === 'REALTOR1' ? [
      ['today','/today'], ['request-new','/requests/new'], ['clients','/clients'], ['client-new','/clients/new'],
      ['needs','/needs'], ['need-new','/needs/new'], ['collections','/collections'], ['offers','/offers'],
      ['offer-new','/offers/new'], ['tasks','/tasks'], ['task-new','/tasks/new'], ['calendar','/calendar'],
      ['notifications','/notifications'], ['agreements','/agreements'],
    ] : [['import','/import'], ['backup-settings','/settings/backups'], ['search-sources','/settings/sources'], ['ai-settings','/settings/ai']];
    for (const [name,path] of pages) await step(name, async () => {
      await go(page,path); await capture(page,name,[['main-form',page.locator('form').first()],['table',page.locator('table').first()]]);
    });
    if (role === 'REALTOR1') for (const kind of ['client','need','collection','offer','task']) {
      await step(`${kind}-detail`, async () => {
        const path = await discover(page, `/${kind === 'need' ? 'needs' : kind === 'offer' ? 'offers' : kind === 'collection' ? 'collections' : kind === 'task' ? 'tasks' : 'clients'}`,
          kind === 'need' ? 'needs' : kind === 'offer' ? 'offers' : kind === 'collection' ? 'collections' : kind === 'task' ? 'tasks' : 'clients');
        if (!path) throw Error('No accessible demo record');
        await go(page,path); await capture(page,`${kind}-detail`);
        if (kind === 'offer') { await go(page,`${path}/print`); await capture(page,'offer-print'); }
      });
    }
    await step(`search-filters-${role.toLowerCase()}`, async () => {
      await go(page,'/property-search');
      if (role === 'MANAGER') return; // realtor filter screens avoid duplicate filenames
      await capture(page,'search-expanded',[['collapse',page.getByRole('button',{name:'Свернуть фильтры',exact:true})]]);
      await clickVisible(page,'button','Расширенные фильтры');
      await capture(page,'search-advanced',[['advanced',page.getByRole('button',{name:'Скрыть расширенные фильтры',exact:true})]]);
      await clickVisible(page,'button','Свернуть фильтры');
      await page.evaluate(()=>scrollTo(0,0)); await capture(page,'search-collapsed');
      await clickVisible(page,'tab','Мои поиски');
      await page.getByRole('heading',{name:'Мои поиски',exact:true}).scrollIntoViewIfNeeded();
      await capture(page,'saved-searches');
    });
    // GET only: savedSearch.lastSuccessfulRunId points at an already finished run.
    // Access is verified by the API under the same role, never copied across users.
    if (!savedResultsCaptured) await step(`saved-results-${role.toLowerCase()}`, async () => {
      const savedResponse = await context.request.get('/api/v1/property-search/saved-searches');
      if (!savedResponse.ok()) throw Error('Cannot read saved searches');
      const saved = await savedResponse.json();
      // A later successful-but-empty fallback may replace lastSuccessfulRunId.
      // Reuse historical DEMO IDs from the screenshot evidence registry as
      // read-only fallbacks, verifying ownership and >=2 results via current API.
      const registry=JSON.parse(await readFile(resolve('docs/screenshots/vkr/manifest.json'),'utf8'));
      const recorded=registry.filter(s=>/DEMO|синтетич|ТЕСТОВ/i.test(`${s.mode||''} ${s.scenario||''}`))
        .map(s=>s.runId || (s.url ? new URL(s.url,base).searchParams.get('runId') : null));
      // Current v3.2.2 evidence uses a separate registry. Read only run IDs,
      // never re-execute harnesses or inspect .env/database/private-data.
      const moreRecorded=[];
      const collectIds=value=>{
        if(!value || typeof value!=='object') return;
        for(const [key,item] of Object.entries(value)) {
          if(['runId','searchRunId','lastSuccessfulRunId'].includes(key) && typeof item==='string' && uuid.test(item)) moreRecorded.push(item);
          else if(item && typeof item==='object') collectIds(item);
        }
      };
      for(const file of ['docs/vkr/live-search-v322-ai.json','docs/screenshots/vkr/v322-ux/after/manifest.json']) {
        try { collectIds(JSON.parse(await readFile(resolve(file),'utf8'))); } catch { /* Optional evidence registry. */ }
      }
      recorded.push(...moreRecorded);
      const candidates = [...new Set([explicitRun, ...saved.map(s=>s.lastSuccessfulRunId), ...recorded].filter(id=>id && uuid.test(id)))];
      let runId;
      const discovery={name:'saved-run-candidates',role,status:'INFO',savedSearches:saved.length,checked:[]};
      for (const id of candidates) {
        const result = await context.request.get(`/api/v1/property-search/runs/${id}`);
        const count=result.ok() ? (await result.json()).results?.length||0 : null;
        discovery.checked.push({id,httpStatus:result.status(),resultCount:count});
        if (count >= 2) { runId=id; break; }
      }
      report.steps.push(discovery);
      if (!runId) {
        report.steps.push({name:`saved-run-discovery-${role.toLowerCase()}`,status:'SKIP',reason:'No owned saved run with 2+ results; next role will be tried. Optional --run-id UUID.'});
        return;
      }
      const prefix=role==='MANAGER'?'manager-':'';
      await go(page,`/property-search?runId=${runId}`);
      const collapse=page.getByRole('button',{name:'Свернуть фильтры',exact:true});
      if (await collapse.count()) await collapse.click();
      const view=page.getByRole('combobox',{name:'Вид',exact:true});
      await view.selectOption('cards');
      const select=page.getByRole('button',{name:'Выделить страницу',exact:true});
      await select.waitFor({state:'visible'}); await select.click({trial:true});
      // needs_review is valid saved evidence too; never start a new search.
      if (!await page.getByRole('button',{name:'К сравнению',exact:true}).count()) {
        const review=page.getByRole('tab',{name:/^Требуют проверки/});
        if (await review.count()) await review.click();
      }
      await select.scrollIntoViewIfNeeded(); await capture(page,`${prefix}search-cards`,[['selection-toolbar',select]]);
      await view.selectOption('table'); await select.scrollIntoViewIfNeeded();
      await capture(page,`${prefix}search-table`,[['table',page.locator('table').first()]]);
      await clickVisible(page,'button','Экспорт XLSX / CSV');
      await capture(page,`${prefix}search-export`,[['export-dialog',page.getByRole('dialog')]]);
      await page.keyboard.press('Escape');
      const compareButtons=page.getByRole('button',{name:'К сравнению',exact:true});
      if (await compareButtons.count() >= 2) { await compareButtons.nth(0).click(); await compareButtons.nth(0).click(); }
      else {
        const checks=page.locator('[data-listing-id] input[type=checkbox]');
        await checks.nth(0).check(); await checks.nth(1).check();
      }
      const ranking=page.getByRole('button',{name:'Ранжировать выбранные с ИИ',exact:true});
      await ranking.waitFor({state:'visible'}); await ranking.scrollIntoViewIfNeeded();
      await capture(page,`${prefix}search-ai-ranking`,[['analysis-panel',page.getByRole('region',{name:'Анализ объявлений ИИ'})],['rank-with-ai',ranking]],{aiInvoked:false});
      await clickVisible(page,'button','Сравнить 2–4');
      await capture(page,`${prefix}search-comparison`,[['comparison',page.getByRole('dialog')]],{aiInvoked:false});
      await page.keyboard.press('Escape');
      savedResultsCaptured=true;
    });
    if (role === 'REALTOR1') await step('agreement-files-and-documents', async () => {
      const created=await context.request.post('/api/v1/clients',{headers:{origin:base.origin},data:{
        displayName:'Пример Клиент руководства',clientKind:'person',contacts:[{contactType:'email',value:`guide-${Date.now()}@example.test`}],
      }});
      if (created.status()!==201) throw Error('Cannot create synthetic client');
      syntheticClientId=(await created.json()).id;
      report.created.push({kind:'client',id:syntheticClientId,synthetic:true});
      await go(page,`/agreements/new?clientId=${syntheticClientId}`);
      checkpointAt('agreement-number');
      await page.getByLabel('Номер',{exact:true}).fill(`Пример договор ${Date.now()}`);
      await capture(page,'agreement-new',[['form',page.locator('form')]]);
      checkpointAt('agreement-select-files');
      await page.getByLabel('Выбрать файлы договора').setInputFiles([pdfFile('Пример договор.pdf'),pdfFile('Пример приложение.pdf')]);
      checkpointAt('agreement-file-type');
      // The wrapping label includes select option text in its accessible name.
      // Exact getByLabel(..., exact:true) therefore times out despite visible UI.
      await page.getByRole('combobox',{name:/^Тип файла Пример приложение\.pdf/}).selectOption('agreement_attachment');
      checkpointAt('agreement-files-screenshot');
      await page.getByText('Документы договора',{exact:true}).scrollIntoViewIfNeeded();
      await capture(page,'agreement-files',[['file-picker',page.getByLabel('Выбрать файлы договора')],['save',page.getByRole('button',{name:'Создать договор',exact:true})]]);
      documentWrites=true;
      checkpointAt('agreement-submit');
      await clickVisible(page,'button','Создать договор');
      const retry=page.getByRole('button',{name:'Повторить загрузку',exact:true});
      await retry.waitFor({state:'visible',timeout:60000}); await retry.scrollIntoViewIfNeeded();
      checkpointAt('agreement-retry-screenshot');
      await capture(page,'agreement-upload-retry',[['retry-failed-only',retry]],{simulatedFailure:true,note:'Second upload returned an intentional synthetic HTTP 503; no application defect implied.'});
      await retry.click();
      checkpointAt('agreement-wait-documents');
      await page.waitForURL(/\/agreements\/[0-9a-f-]{36}#documents$/,{timeout:60000});
      const region=page.getByRole('region',{name:'Документы договора'});
      await region.getByRole('link',{name:'Пример приложение.pdf',exact:true}).waitFor({state:'visible'});
      await region.scrollIntoViewIfNeeded(); await capture(page,'agreement-documents',[['documents',region]]);
      console.log(`VERIFIED agreement retry: ${uploadNumber} upload attempts; two documents visible; navigation completed`);
      report.created.push({kind:'agreement',path:new URL(page.url()).pathname,synthetic:true});
      documentWrites=false;
    });
    await context.request.post('/api/v1/auth/logout',{headers:{origin:base.origin}}).catch(()=>{});
    await context.close();
  }
  if (!savedResultsCaptured) {
    errors.push('saved-results-required');
    report.steps.push({name:'saved-results-required',status:'FAIL',reason:'No complete saved-result sequence. Supply --run-id for an owned recorded run with at least two results. No external search was started.'});
  }
  report.complete=errors.length===0;
} catch {
  errors.push('setup-or-login'); report.steps.push({name:'setup-or-login',status:'FAIL',reason:'Check readiness, credentials, required password change and Chromium installation; secrets intentionally omitted.'});
} finally {
  await browser.close(); report.finishedAt=new Date().toISOString();
  await writeFile(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Screenshots: ${report.screenshots.length}; failed steps: ${errors.length}. Manifest: ${join(out,'manifest.json')}`);
  if(errors.length) process.exitCode=1;
}
