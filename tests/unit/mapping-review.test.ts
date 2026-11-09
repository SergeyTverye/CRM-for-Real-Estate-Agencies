import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserServer, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createMappingReview, prepareMappingReview, renderMappingReview } from '../../scripts/private-import/prepare-mapping-review.mjs';
import { enterpriseProfileSchema, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';

const run = promisify(execFile);
const script = resolve('scripts/private-import/prepare-mapping-review.mjs');
const maliciousHeader = '</script><img src="https://example.invalid/private" onerror="globalThis.__xss=1">';
let directory: string;
let browser: Browser;
let browserServer: BrowserServer;
const browserTest = it.runIf(process.env.MAPPING_REVIEW_BROWSER_TEST === '1');

function synthetic() {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('<img src=x onerror=alert(1)>');
    ws.addRow(['Адрес объекта', 'Площадь (м²)', 'Ставка руб./м²/мес.', maliciousHeader, 'Паспорт', 'Кем выдан', 'Регистрация', 'Дата рождения']);
    ws.addRow(['SYNTHETIC_ADDRESS_NEVER_RENDERED', 45, 100, 'SYNTHETIC_BODY_NEVER_RENDERED', 'SYNTHETIC_POLICY_PASSPORT', 'SYNTHETIC_POLICY_ISSUER', 'SYNTHETIC_POLICY_REGISTRATION', '1980-12-19']);
    return wb;
}
async function openReview(wb: ExcelJS.Workbook) {
    const review = await createMappingReview(wb);
    const html = renderMappingReview(review);
    const path = join(directory, `review-${randomUUID()}.html`);
    await writeFile(path, html);
    const context = await browser.newContext({ offline: true, acceptDownloads: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    const requests: string[] = [], errors: string[] = [];
    page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path).href);
    await page.locator('#target-1').waitFor();
    return { review, html, context, page, requests, errors };
}
async function downloadedProfile(page: Page) {
    const waiting = page.waitForEvent('download');
    await page.locator('#download').click();
    const downloaded = await waiting;
    expect(downloaded.suggestedFilename()).toBe('enterprise-profile-confirmed.json');
    const path = join(directory, `confirmed-${randomUUID()}.json`);
    await downloaded.saveAs(path);
    return enterpriseProfileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'crm-synthetic-mapping-review-'));
    if (process.env.MAPPING_REVIEW_BROWSER_TEST === '1') {
        browserServer = await chromium.launchServer({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--disable-background-networking', '--disable-background-mode'] });
        browser = await chromium.connect(browserServer.wsEndpoint());
    }
}, 30000);
afterAll(async () => {
    if (browserServer) {
        const child = browserServer.process();
        if (child.exitCode === null && child.pid) {
            if (process.platform === 'win32') await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, windowsHide: true });
            else child.kill('SIGKILL');
        }
    }
    if (directory) {
        if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('INVALID_SYNTHETIC_CLEANUP');
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}, 30000);

describe('local owner mapping confirmation (synthetic only)', () => {
    browserTest('contains only header/structure metadata, escapes script breakers and uses nonced CSP', async () => {
        const { page, context, html, requests, errors } = await openReview(synthetic());
        try {
            expect(html).not.toContain('SYNTHETIC_BODY_NEVER_RENDERED');
            expect(html).not.toContain('SYNTHETIC_ADDRESS_NEVER_RENDERED');
            expect(html).not.toContain('SYNTHETIC_POLICY_');
            expect(html).not.toContain('1980-12-19');
            expect(html).not.toContain(maliciousHeader);
            expect(html).toContain('\\u003c/script\\u003e');
            expect(await page.locator('h2').first().textContent()).toContain('<img src=x onerror=alert(1)>');
            expect(await page.locator('td').allTextContents()).toContain(maliciousHeader);
            expect(await page.locator('img').count()).toBe(0);
            expect(await page.evaluate(() => '__xss' in globalThis)).toBe(false);
            const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
            expect(csp).toMatch(/default-src 'none'; script-src 'nonce-[^']+';/);
            expect(csp).toContain("connect-src 'none'");
            expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
            expect(requests).toEqual([]);
            expect(errors).toEqual([]);
            expect(await page.locator('select:disabled').count()).toBe(4);
        } finally { await context.close(); }
    });

    browserTest('blocks unresolved columns/defaults/unconfirmed ownership and downloads parser-compatible JSON', async () => {
        const wb = synthetic(), { page, context, errors } = await openReview(wb);
        try {
            expect(await page.locator('#download').isDisabled()).toBe(true);
            expect(await page.locator('#errors').textContent()).toContain('COLUMN_UNRESOLVED');
            expect(await page.locator('#errors').textContent()).toContain('OPERATION_REQUIRED');
            await page.locator('#field-1-0-4').selectOption('ignore');
            await page.locator('#operation-1').selectOption('rent');
            expect(await page.locator('#errors').textContent()).toContain('RENT_PRICE_UNIT_REQUIRED');
            await page.locator('#price-unit-1').selectOption('rub_m2_month');
            expect(await page.locator('#download').isDisabled()).toBe(true);
            await page.locator('#owner-confirmed').check();
            expect(await page.locator('#download').isEnabled()).toBe(true);
            const profile = await downloadedProfile(page);
            expect(profile.sheets[0]!.defaults).toMatchObject({ operationType: 'rent', priceUnit: 'rub_m2_month' });
            expect(Object.values(profile.sheets[0]!.columns)).not.toContain(null);
            expect(JSON.stringify(profile)).not.toMatch(/паспорт|выдан|регистрац|рождени|SYNTHETIC_POLICY/i);
            const parsed = parseEnterprise(wb, profile);
            expect(parsed.unresolved).toEqual([]);
            expect(parsed.rows).toHaveLength(1);
            expect(parsed.rows[0]!.errorCodes).toEqual([]);
            expect(parsed.rows[0]!.record).toMatchObject({ operationType: 'rent', area: '45', priceUnit: 'rub_m2_month' });
            await page.locator('#operation-1').selectOption('sale');
            expect(await page.locator('#owner-confirmed').isChecked()).toBe(false);
            expect(await page.locator('#download').isDisabled()).toBe(true);
            expect(errors).toEqual([]);
        } finally { await context.close(); }
    });

    browserTest('requires a decision for unknown targets; explicit ignore exports no unresolved fields', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic unknown');
        ws.addRow(['SYNTHETIC_HEADER_A', 'SYNTHETIC_HEADER_B']);
        ws.addRow(['SYNTHETIC_BODY_A', 'SYNTHETIC_BODY_B']);
        const { page, context, html } = await openReview(wb);
        try {
            expect(html).not.toContain('SYNTHETIC_BODY_A');
            expect(html).not.toContain('SYNTHETIC_HEADER_A');
            expect(await page.locator('#errors').textContent()).toContain('TARGET_UNRESOLVED');
            await page.locator('#owner-confirmed').check();
            expect(await page.locator('#download').isDisabled()).toBe(true);
            await page.locator('#target-1').selectOption('ignore');
            await page.locator('#owner-confirmed').check();
            const profile = await downloadedProfile(page);
            expect(profile.sheets[0]).toMatchObject({ target: 'ignore', columns: {}, blockTargets: {} });
            expect(parseEnterprise(wb, profile).unresolved).toEqual([]);
        } finally { await context.close(); }
    });

    browserTest('allows explicit manual header-row confirmation without embedding unrecognized source values', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic manual');
        ws.addRow([]); ws.addRow(['SYNTHETIC_COLUMN_A', 'SYNTHETIC_COLUMN_B']);
        ws.addRow(['SYNTHETIC_ADDRESS', 'SYNTHETIC_BODY']);
        const { page, context } = await openReview(wb);
        try {
            await page.locator('#target-1').selectOption('historical_deal_archive');
            await page.locator('#header-row-1').fill('2');
            await page.locator('#field-1-0-1').selectOption('addressText');
            await page.locator('#field-1-0-2').selectOption('ignore');
            await page.locator('#owner-confirmed').check();
            expect(await page.locator('#errors').textContent()).toContain('HEADER_CONFIRMATION_REQUIRED');
            await page.locator('#header-confirmed-1').check();
            await page.locator('#owner-confirmed').check();
            const profile = await downloadedProfile(page);
            expect(profile.sheets[0]!.headerRow).toBe(2);
            expect(profile.sheets[0]!.columns).toMatchObject({ '@2:1': 'addressText', '@2:2': 'ignore' });
            expect(parseEnterprise(wb, profile).unresolved).toEqual([]);
            expect(parseEnterprise(wb, profile).rows).toHaveLength(1);
        } finally { await context.close(); }
    });

    browserTest('preserves per-table targets on mixed sheets and requires a sheet decision', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic mixed');
        ws.addRow(['Адрес', 'Площадь', 'Операция']); ws.addRow(['SYNTHETIC_PROPERTY', 45, 'Продажа']);
        ws.addRow([]); ws.addRow(['ФИО', 'Тел.', 'Запрос']); ws.addRow(['SYNTHETIC_CLIENT', '+7 (900) 000-00-01', 'Аренда']);
        const { page, context } = await openReview(wb);
        try {
            expect(await page.locator('#errors').textContent()).toContain('TARGET_UNRESOLVED');
            await page.locator('#target-1').selectOption('property');
            await page.locator('#owner-confirmed').check();
            const profile = await downloadedProfile(page);
            expect(profile.sheets[0]!.blockTargets).toEqual({ '1': 'property', '4': 'client_request_need' });
            const parsed = parseEnterprise(wb, profile);
            expect(parsed.unresolved).toEqual([]);
            expect(parsed.rows.map(r => r.target)).toEqual(['property', 'client_request_need']);
        } finally { await context.close(); }
    });

    it('exclusive CLI writer creates private HTML and a new candidate, prints only fixed codes/counts, refuses overwrite', async () => {
        const root = join(directory, 'writer'); await mkdir(root);
        const input = join(root, 'synthetic.xlsx'); await synthetic().xlsx.writeFile(input);
        const source = await readFile(input);
        const result = await run(process.execPath, [script, input], { cwd: root, timeout: 30000 });
        expect(result.stderr).toBe('');
        const report = JSON.parse(result.stdout);
        expect(report).toMatchObject({ code: 'MAPPING_REVIEW_READY', sheets: 1, blocks: 1, excludedColumns: 4, unresolvedColumns: 1 });
        expect(Object.entries(report).every(([key, value]) => key === 'code' ? value === 'MAPPING_REVIEW_READY' : Number.isSafeInteger(value))).toBe(true);
        expect(result.stdout).not.toMatch(/SYNTHETIC|Адрес|паспорт|example|writer/i);
        const files = await readdir(join(root, 'private-data'));
        expect(files).toHaveLength(2);
        expect(files).toContain('mapping-review.html');
        const candidate = files.find(n => /^enterprise-profile-candidate-[0-9a-f-]+\.json$/.test(n))!;
        enterpriseProfileSchema.parse(JSON.parse(await readFile(join(root, 'private-data', candidate), 'utf8')));
        const originalHtml = await readFile(join(root, 'private-data/mapping-review.html'));
        await expect(prepareMappingReview(input, { workspaceRoot: root })).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(join(root, 'private-data/mapping-review.html'))).toEqual(originalHtml);
        expect(await readdir(join(root, 'private-data'))).toEqual(files);
        expect(await readFile(input)).toEqual(source);
    }, 35000);

    it('CLI failures suppress source paths and raw exceptions and clean only newly created output', async () => {
        const root = join(directory, 'failed-writer'); await mkdir(root);
        const input = join(root, 'SYNTHETIC_PRIVATE_FILENAME.xlsx'); await writeFile(input, 'SYNTHETIC_CORRUPT_PRIVATE_BODY');
        try {
            await run(process.execPath, [script, input], { cwd: root, timeout: 30000 });
            throw new Error('EXPECTED_CLI_FAILURE');
        } catch (error) {
            const failed = error as { stdout: string; stderr: string; code: number };
            expect(failed.code).toBe(1);
            expect(failed.stderr).toBe('');
            expect(JSON.parse(failed.stdout)).toEqual({ code: 'MAPPING_REVIEW_FAILED' });
        }
        expect(await readdir(join(root, 'private-data'))).toEqual([]);
    }, 35000);
});
