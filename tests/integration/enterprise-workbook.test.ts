import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDatabase, seedBase, type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise, inspectEnterprise, commitEnterprise, exportEnterprise, remapEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile, loadEnterprise, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';
import { ForbiddenError } from '@/shared/errors';
import * as legacy from '@/modules/import/application/import-service';
import ExcelJS from 'exceljs';
let users: TestUsers;
const bytes = () => readFile('tests/fixtures/synthetic/enterprise-workbook.xlsx');
async function setup() { const data = await bytes(); const wb = await loadEnterprise(data); const p = buildProfile(wb); for (const s of p.sheets)
    { if (s.target === null) s.target = 'ignore'; s.defaults.priceUnit = 'rub_month'; } for (const s of p.sheets)
    for (const k of Object.keys(s.columns))
        if (s.columns[k] === null)
            s.columns[k] = 'ignore'; return { data, p }; }
const file = (b: Buffer) => new File([new Uint8Array(b)], 'synthetic.xlsx');
async function confirm(id: string) { const job = await inspectEnterprise(users.manager, id); return commitEnterprise(users.manager, id, { confirmed: true, acceptWarnings: true, expectedMappingVersion: job.mappingVersion }); }
beforeEach(async () => { vi.restoreAllMocks(); await resetDatabase(); users = await seedBase(); });
describe('enterprise v2 PG/Prisma', () => {
    async function synthetic(rows: unknown[][]) {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic');
        ws.addRow(['Адрес объекта', 'Площадь (м²)', 'Операция', 'Назначение', 'Источник', 'Ответственный']);
        for (const row of rows) ws.addRow(row);
        return { wb, ws, p: buildProfile(wb) };
    }
    it('skipped invalid/hidden/duplicate rows with invalid references do not block eligible rows; scaled Decimal duplicates', async () => {
        const prior = await synthetic([['SYNTHETIC_DUPLICATE', '500.00', 'Продажа']]);
        const job0 = await uploadEnterprise(users.manager, file(Buffer.from(await prior.wb.xlsx.writeBuffer())), prior.p);
        expect((await confirm(job0.id)).imported).toBe(1);
        const existing = await db.property.findFirstOrThrow();
        // Verify the review hypothesis against the actual backend before changing Decimal logic.
        expect(existing.area!.toString()).toBe('500');
        // Isolate the existing-property check from receipt-based idempotency.
        await db.importRowResult.deleteMany({ where: { importJobId: job0.id } });
        await db.dictionaryItem.create({ data: { category: 'commercial_purpose', code: 'synthetic_inactive', displayName: 'Synthetic inactive', isActive: false } });
        await db.user.update({ where: { id: users.realtor2.userId }, data: { isActive: false } });
        const bad = ['SYNTHETIC_BAD_PURPOSE', 'SYNTHETIC_BAD_SOURCE', 'SYNTHETIC_BAD_RESPONSIBLE'];
        const current = await synthetic([
            ['SYNTHETIC_VALID', 45, 'Продажа'],
            [null, 45, 'Продажа', ...bad],
            ['SYNTHETIC_HIDDEN', 46, 'Продажа', ...bad],
            ['SYNTHETIC_DUPLICATE', 500, 'Продажа', ...bad],
        ]);
        current.ws.getRow(4).hidden = true;
        current.p.sheets[0]!.purposeMap = { synthetic_bad_purpose: 'synthetic_inactive' };
        current.p.sheets[0]!.sourceMap = { synthetic_bad_source: 'synthetic_missing' };
        current.p.sheets[0]!.responsibleMap = { synthetic_bad_responsible: users.realtor2.userId };
        const job = await uploadEnterprise(users.manager, file(Buffer.from(await current.wb.xlsx.writeBuffer())), current.p);
        const inspected = await inspectEnterprise(users.manager, job.id);
        expect(inspected.rows.find(r => r.sourceRowNumber === 5)!.warningCodes).toContain('probable_duplicate');
        expect(await confirm(job.id)).toMatchObject({ imported: 1, skipped: 3 });
        expect(await db.property.count()).toBe(2);
    });
    it.each(['purpose', 'responsible', 'source'] as const)('eligible rows still validate %s references atomically', async kind => {
        const current = await synthetic([['SYNTHETIC_VALID', 45, 'Продажа'], ['SYNTHETIC_BAD', 46, 'Продажа', 'SYNTHETIC_PURPOSE', 'SYNTHETIC_SOURCE', 'SYNTHETIC_RESPONSIBLE']]);
        const sheet = current.p.sheets[0]!;
        if (kind === 'purpose') sheet.purposeMap = { synthetic_purpose: 'synthetic_missing' };
        if (kind === 'source') sheet.sourceMap = { synthetic_source: 'synthetic_missing' };
        if (kind === 'responsible') {
            await db.user.update({ where: { id: users.realtor2.userId }, data: { isActive: false } });
            sheet.responsibleMap = { synthetic_responsible: users.realtor2.userId };
        }
        const job = await uploadEnterprise(users.manager, file(Buffer.from(await current.wb.xlsx.writeBuffer())), current.p);
        await expect(confirm(job.id)).rejects.toThrow(kind === 'purpose' ? 'INVALID_PURPOSE_CODE' : kind === 'source' ? 'INVALID_SOURCE_CODE' : 'INVALID_RESPONSIBLE');
        expect(await db.property.count()).toBe(0);
    });
    it('retains raw permitted contacts and normalized keys separately', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic');
        ws.addRow(['Ф.И.О.', 'Тел.', 'E-mail', 'Запрос']);
        ws.addRow(['SYNTHETIC_CLIENT', '+7 (900) 000-00-01; +7 (901) 000-00-02', 'Synthetic@Example.Invalid', 'Купить']);
        const job = await uploadEnterprise(users.manager, file(Buffer.from(await wb.xlsx.writeBuffer())));
        expect((await confirm(job.id)).imported).toBe(1);
        const contacts = await db.clientContact.findMany();
        expect(contacts).toEqual(expect.arrayContaining([
            expect.objectContaining({ rawValue: '+7 (900) 000-00-01', normalizedValue: '+79000000001' }),
            expect.objectContaining({ rawValue: '+7 (901) 000-00-02', normalizedValue: '+79010000002' }),
            expect.objectContaining({ rawValue: 'Synthetic@Example.Invalid', normalizedValue: 'synthetic@example.invalid' }),
        ]));
        expect((await db.leadRequest.findFirstOrThrow()).rawContact).toBe('+7 (900) 000-00-01');
        const exported = await exportEnterprise(users.manager, job.id);
        const profile = buildProfile(wb);
        const after = parseEnterprise(await loadEnterprise(exported.buffer), profile);
        expect(after.rows[0]!.record.contacts).toEqual(parseEnterprise(wb, profile).rows[0]!.record.contacts);
    });
    it('merged two-level headers survive export and reimport without duplicate properties', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic merged');
        ws.mergeCells('A1:A2'); ws.getCell('A1').value = 'Адрес объекта';
        ws.mergeCells('B1:C1'); ws.getCell('B1').value = 'Характеристики';
        ws.getCell('B2').value = 'Площадь (м²)'; ws.getCell('C2').value = 'Операция';
        ws.addRow(['SYNTHETIC_MERGED_ADDRESS', 45, 'Продажа']);
        const p = buildProfile(wb);
        const job = await uploadEnterprise(users.manager, file(Buffer.from(await wb.xlsx.writeBuffer())), p);
        expect((await confirm(job.id)).imported).toBe(1);
        const exported = await exportEnterprise(users.manager, job.id);
        const after = await loadEnterprise(exported.buffer);
        for (const address of ['A1', 'B1', 'B2', 'C2']) expect(after.worksheets[0]!.getCell(address).value).toEqual(ws.getCell(address).value);
        expect([...after.worksheets[0]!.model.merges].sort()).toEqual([...ws.model.merges].sort());
        const round = await uploadEnterprise(users.manager, file(exported.buffer), p);
        expect((await confirm(round.id)).imported).toBe(0);
        expect(await db.property.count()).toBe(1);
    });
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
