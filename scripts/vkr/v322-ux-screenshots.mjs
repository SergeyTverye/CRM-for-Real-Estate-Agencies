import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [baseArgument, outputArgument] = process.argv.slice(2);
if (!baseArgument || !outputArgument) throw new Error('Укажите базовый URL и папку снимков.');
const base = new URL(baseArgument);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('Укажите http(s) URL корня CRM без учётных данных и параметров.');
}
const output = resolve(outputArgument);
const roles = ['MANAGER', 'REALTOR1'];
for (const role of roles) {
  if (!process.env[`SEED_${role}_LOGIN`] || !process.env[`SEED_${role}_PASSWORD`]) {
    throw new Error(`Задайте SEED_${role}_LOGIN и SEED_${role}_PASSWORD в окружении.`);
  }
}
await mkdir(output, { recursive: true });
const scriptRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const revision = process.env.CRM_SCREENSHOT_REVISION ?? null;
const viewports = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }];
const screens = [
  ['today', '/today'], ['request-new', '/requests/new'], ['clients', '/clients'],
  ['needs', '/needs'], ['need-new', '/needs/new'], ['collections', '/collections'],
  ['offers', '/offers'], ['offer-new', '/offers/new'], ['tasks', '/tasks'],
  ['task-new', '/tasks/new'], ['planner', '/calendar'], ['properties', '/properties'],
  ['advertisements-expiring', '/advertisements?view=expiring'], ['ad-new', '/advertisements/new'],
  ['agreements-expiring', '/agreements?view=expiring'],
];
const browser = await chromium.launch({ headless: true });
const manifest = [];
const skipped = [];
let plannedCount = 0;
try {
  for (const role of roles) {
    const context = await browser.newContext({ baseURL: base.origin });
    try {
      await context.route('**/*', route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin !== base.origin || !['GET', 'HEAD'].includes(req.method())) return route.abort();
        return route.continue();
      });
      const response = await context.request.post('/api/v1/auth/login', {
        headers: { origin: base.origin },
        data: { login: process.env[`SEED_${role}_LOGIN`], password: process.env[`SEED_${role}_PASSWORD`] },
      });
      if (!response.ok()) throw new Error(`Не удалось войти: ${role}, HTTP ${response.status()}.`);
      if ((await response.json()).mustChangePassword) throw new Error(`Учётная запись ${role} требует смены пароля. Подготовьте демонстрационную учётную запись до съёмки.`);
      const page = await context.newPage();
      let pageErrors = 0;
      page.on('pageerror', () => { pageErrors++; });
      const roleScreens = role === 'MANAGER' ? [...screens, ['employee-tasks', '/tasks?view=all'], ['reports', '/reports']] : [...screens];
      for (const [kind, listPath] of [['client', '/clients'], ['need', '/needs'], ['collection', '/collections'], ['offer', '/offers'], ['task', '/tasks']]) {
        await page.goto(listPath, { waitUntil: 'networkidle', timeout: 60_000 });
        const detail = await page.locator('a[href]').evaluateAll((links, prefix) => {
          return links.map(el => el.getAttribute('href')).find(href => href && new RegExp(`^${prefix}/[0-9a-f-]{36}$`, 'i').test(href)) ?? null;
        }, listPath);
        if (!detail) { skipped.push({role, screen: `${kind}-detail`, reason: 'Нет доступной синтетической записи в списке'}); continue; }
        roleScreens.push([`${kind}-detail`, detail]);
        if (kind === 'client') roleScreens.push(['client-history', `${detail}?tab=history`], ['client-needs', `${detail}?tab=needs`]);
        if (kind === 'need') roleScreens.push(['need-edit', `${detail}/edit`]);
      }
      plannedCount += roleScreens.length * viewports.length;
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        for (const [name, path] of roleScreens) {
          const beforeErrors = pageErrors;
          const response = await page.goto(path, { waitUntil: 'networkidle', timeout: 60_000 });
          if (!response?.ok() || new URL(page.url()).pathname !== new URL(path, base).pathname) {
            throw new Error(`Экран ${name} (${role}) недоступен или перенаправлен.`);
          }
          await page.locator('h1').first().waitFor({ state: 'visible' });
          await page.evaluate(async () => { await document.fonts.ready; });
          if (pageErrors > beforeErrors || await page.getByText(/Application error:|Internal Server Error/).count()) {
            throw new Error(`Ошибка отображения экрана ${name} (${role}).`);
          }
          const file = `${role.toLowerCase()}-${name}-${viewport.width}x${viewport.height}.png`;
          await page.screenshot({ path: join(output, file), animations: 'disabled', fullPage: false });
          manifest.push({ file, role, path, viewport, revision, scriptRevision, capturedAt: new Date().toISOString(), sha256: createHash('sha256').update(await readFile(join(output, file))).digest('hex') });
        }
      }
    } finally {
      await context.request.post('/api/v1/auth/logout', { headers: { origin: base.origin } }).catch(() => {});
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ complete: manifest.length === plannedCount && plannedCount > 0, skipped, screenshots: manifest }, null, 2) + '\n');
}
console.log(`Сохранено снимков: ${manifest.length}.`);
