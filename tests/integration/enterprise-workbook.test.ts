import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDatabase, seedBase, type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise, inspectEnterprise, commitEnterprise, exportEnterprise, remapEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile, loadEnterprise, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';
import { ForbiddenError } from '@/shared/errors';
import * as legacy from '@/modules/import/application/import-service';
let users: TestUsers;
const bytes = () => readFile('tests/fixtures/synthetic/enterprise-workbook.xlsx');
async function setup() { const data = await bytes(); const wb = await loadEnterprise(data); const p = buildProfile(wb); for (const s of p.sheets)
    s.defaults.priceUnit = 'rub_month'; for (const s of p.sheets)
    for (const k of Object.keys(s.columns))
        if (s.columns[k] === null)
            s.columns[k] = 'ignore'; return { data, p }; }
const file = (b: Buffer) => new File([new Uint8Array(b)], 'synthetic.xlsx');
async function confirm(id: string) { const job = await inspectEnterprise(users.manager, id); return commitEnterprise(users.manager, id, { confirmed: true, acceptWarnings: true, expectedMappingVersion: job.mappingVersion }); }
beforeEach(async () => { vi.restoreAllMocks(); await resetDatabase(); users = await seedBase(); });
describe('enterprise v2 PG/Prisma', () => {
    it('dry-run, checksum, unresolved gate, remap, commit, repeat and export roundtrip', async () => {
        const { data, p } = await setup();
        const initial = await uploadEnterprise(users.manager, file(data));
        expect(await db.property.count()).toBe(0);
        expect(initial.unresolved.length).toBeGreaterThan(0);
        await expect(confirm(initial.id)).rejects.toThrow('UNRESOLVED_COLUMNS');
        await remapEnterprise(users.manager, initial.id, p);
        const result = await confirm(initial.id);
        expect(result.imported).toBeGreaterThan(0);
        expect(await db.client.count()).toBe(10);
        expect(await db.property.count()).toBe(24);
        const counts = [await db.client.count(), await db.property.count(), await db.historicalDealArchive.count()];
        const repeat = await uploadEnterprise(users.manager, file(data), p);
        expect(repeat.checksumRepeated).toBe(true);
        expect((await confirm(repeat.id)).imported).toBe(0);
        expect((await confirm(initial.id)).status).toBe('completed');
        const exported = await exportEnterprise(users.manager, initial.id);
        const original = await loadEnterprise(data), after = await loadEnterprise(exported.buffer);
        expect(after.worksheets).toHaveLength(6);
        expect(after.definedNames.model).toHaveLength(4);
        expect(after.worksheets[1]!.getImages()).toHaveLength(15);
        for (let i = 0; i < 6; i++) {
            expect(after.worksheets[i]!.columns.map(c => c.width)).toEqual(original.worksheets[i]!.columns.map(c => c.width));
            expect(after.worksheets[i]!.views).toEqual(original.worksheets[i]!.views);
            expect(after.worksheets[i]!.autoFilter).toEqual(original.worksheets[i]!.autoFilter);
        }
        expect(exported.report.HYPERLINK_CLEARED).toBeGreaterThan(0);
        expect(JSON.stringify(after.worksheets[3]!.getRow(3).values)).not.toContain('POLICY_SECRET');
        const round = await uploadEnterprise(users.manager, file(exported.buffer), p);
        await confirm(round.id);
        expect([await db.client.count(), await db.property.count(), await db.historicalDealArchive.count()]).toEqual(counts);
    });
    it('failure halfway rolls back receipts and domain records; retry succeeds', async () => {
        const { data, p } = await setup();
        const job = await uploadEnterprise(users.manager, file(data), p);
        const original = legacy.commitRow;
        let n = 0;
        const spy = vi.spyOn(legacy, 'commitRow').mockImplementation(async (...args) => { if (++n === 5)
            throw new Error('SYNTHETIC_FAILURE'); return original(...args); });
        await expect(confirm(job.id)).rejects.toThrow('IMPORT_COMMIT_FAILED');
        expect(await db.property.count()).toBe(0);
        expect(await db.importRowResult.count({ where: { importJobId: job.id, commitResult: 'imported' } })).toBe(0);
        expect((await inspectEnterprise(users.manager, job.id)).status).toBe('dry_run_ready');
        spy.mockRestore();
        expect((await confirm(job.id)).imported).toBeGreaterThan(0);
    });
    it('half rejected, corruption, no forbidden fields in report', async () => {
        const { data, p } = await setup();
        const wb = await loadEnterprise(data);
        const parsed = parseEnterprise(wb, p);
        for (const [i, r] of parsed.rows.filter(r => r.target === 'property' && !r.hidden).entries())
            if (i % 2 === 0)
                wb.worksheets[r.sheetIndex - 1]!.getRow(r.rowNumber).getCell(3).value = null;
        const job = await uploadEnterprise(users.manager, file(Buffer.from(await wb.xlsx.writeBuffer())), p);
        expect(job.counts.invalid).toBe(12);
        await confirm(job.id);
        expect(await db.property.count()).toBe(12);
        expect(JSON.stringify(await inspectEnterprise(users.manager, job.id))).not.toContain('POLICY_SECRET');
        await expect(uploadEnterprise(users.manager, file(Buffer.from('broken')))).rejects.toThrow('INVALID_WORKBOOK');
    });
    it('concurrent distinct jobs serialize, existing property key includes area and operation', async () => {
        const { data, p } = await setup();
        const first = await uploadEnterprise(users.manager, file(data), p), second = await uploadEnterprise(users.manager, file(data), p);
        const results = await Promise.all([confirm(first.id), confirm(second.id)]);
        expect(results.reduce((sum, r) => sum + r.imported, 0)).toBe(62);
        expect(await db.property.count()).toBe(24);
        expect(await db.client.count()).toBe(10);
    });
    it('archive hidden rows and explicit source/responsible/status mapping', async () => {
        const { data, p } = await setup();
        for (const sh of p.sheets) {
            sh.hiddenRows = 'archive';
            sh.statusMap = { 'а': 'paused' };
            sh.responsibleMap = { 'тестовый сотрудник': users.realtor1.userId };
            sh.sourceMap = { 'тестовый источник': 'recommendation' };
        }
        const job = await uploadEnterprise(users.manager, file(data), p);
        await confirm(job.id);
        expect(await db.property.count({ where: { status: 'archived' } })).toBe(126);
        expect(await db.property.count({ where: { status: 'paused' } })).toBe(24);
        expect(await db.client.count({ where: { responsibleUserId: users.realtor1.userId } })).toBe(10);
        expect(await db.leadRequest.count({ where: { sourceCode: 'recommendation', responsibleUserId: users.realtor1.userId } })).toBe(10);
    });
    it('realtor cannot access upload, closed journal, mapping, commit or export', async () => { const { data, p } = await setup(); const job = await uploadEnterprise(users.manager, file(data), p); for (const actor of [users.realtor1, users.realtor2]) {
        await expect(uploadEnterprise(actor, file(data), p)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(inspectEnterprise(actor, job.id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(remapEnterprise(actor, job.id, p)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(commitEnterprise(actor, job.id, {})).rejects.toBeInstanceOf(ForbiddenError);
        await expect(exportEnterprise(actor, job.id)).rejects.toBeInstanceOf(ForbiddenError);
    } });
});
