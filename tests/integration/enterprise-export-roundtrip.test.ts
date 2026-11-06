import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDatabase, seedBase, type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise, commitEnterprise, exportEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile, loadEnterprise, parseEnterprise, type EnterpriseProfile } from '@/modules/import/domain/enterprise-workbook';
import { compareWorkbook } from '../../scripts/private-import/compare-workbook';

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
const file = (buffer: Buffer) => new File([new Uint8Array(buffer)], 'synthetic.xlsx');
async function commit(buffer: Buffer, profile: EnterpriseProfile) {
    const job = await uploadEnterprise(users.manager, file(buffer), profile);
    const result = await commitEnterprise(users.manager, job.id, { confirmed: true, acceptWarnings: true, expectedMappingVersion: (await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).mappingVersion });
    return { job, result };
}
async function roundtrip(wb: ExcelJS.Workbook, profile = buildProfile(wb)) {
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const before = await loadEnterprise(buffer);
    const { job, result } = await commit(buffer, profile);
    const output = await exportEnterprise(users.manager, job.id);
    const after = await loadEnterprise(output.buffer);
    const receipts = await db.importRowResult.findMany({ where: { importJobId: job.id, commitResult: 'imported' } });
    const imported = new Set(receipts.map(r => `${r.sheetName!.replace('sheet:', '')}:${r.sourceRowNumber}`));
    const counters = compareWorkbook(before, after, profile, imported);
    for (const [kind, counter] of Object.entries(counters)) expect(counter.mismatched, kind).toBe(0);
    return { before, after, output, profile, job, result };
}
describe('enterprise export synthetic roundtrip', () => {
    it.each(['default', 'custom', 'formatting-only XFD'] as const)('keeps a fully cleaned ignored sheet span with %s widths', async (widths) => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic clients');
        ws.addRow(['№', 'Клиент', 'Телефон', 'Дата', 'Запрос', 'Операция']);
        ws.addRow(['SYN-G1', 'Synthetic geometry client', '+7 (900) 000-00-31', null, 'Купить', 'Купить']);
        const ignored = wb.addWorksheet('Synthetic ignored geometry');
        ignored.getCell('F3').value = 'SYNTHETIC_IGNORED_DO_NOT_COPY';
        if (widths === 'custom') {
            ignored.getColumn(1).width = 23;
            ignored.getColumn(6).width = 41;
        }
        if (widths === 'formatting-only XFD') ignored.getColumn(16384).width = 19;
        const profile = buildProfile(wb);
        profile.sheets[1]!.target = 'ignore';
        const r = await roundtrip(wb, profile);
        expect(r.result.imported).toBe(1);
        const before = r.before.worksheets[1]!, after = r.after.worksheets[1]!;
        expect(before.columnCount).toBe(6);
        // columnCount only counts rows with values; geometry must survive even
        // though every value on this sheet has deliberately been removed.
        expect(after.columns.length).toBe(before.columns.length);
        expect(after.getRow(1).cellCount).toBe(6);
        expect(Array.from({ length: 6 }, (_, i) => after.getColumn(i + 1).width))
            .toEqual(Array.from({ length: 6 }, (_, i) => before.getColumn(i + 1).width));
        after.eachRow({ includeEmpty: true }, row => {
            expect(row.actualCellCount).toBe(0);
            row.eachCell({ includeEmpty: true }, cell => expect(cell.value).toBeNull());
        });
    });
    it('keeps absent received dates, source IDs, split raw phone columns and request/comment semantics', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic clients');
        ws.addRow(['№', 'Клиент', 'Телефон', 'Тел.', 'Дата', 'Запрос', 'Комментарий', 'Операция']);
        ws.addRow(['SYN-1', 'Synthetic One', '+7 (900) 000-00-11', '+7 (901) 000-00-12', null, 'Купить', 'Synthetic note', 'Купить']);
        ws.addRow(['SYN-2', 'Synthetic Two', '+7 (900) 000-00-13', null, new Date('2026-01-02T00:00:00Z'), 'Аренда', null, 'Аренда']);
        const r = await roundtrip(wb);
        expect(r.result.imported).toBe(2);
        expect(r.after.worksheets[0]!.getCell('E2').value).toBeNull();
        for (const address of ['A2', 'C2', 'D2', 'F2', 'G2', 'H2']) expect(r.after.worksheets[0]!.getCell(address).value).toEqual(ws.getCell(address).value);
        expect((await commit(r.output.buffer, r.profile)).result.imported).toBe(0);
        expect(await db.client.count()).toBe(2);
        const lead = await db.leadRequest.findFirstOrThrow({ where: { client: { displayName: 'Synthetic One' } } });
        await db.leadRequest.update({ where: { id: lead.id }, data: { occurredAt: new Date('2026-02-03T00:00:00Z') } });
        const changed = await loadEnterprise((await exportEnterprise(users.manager, r.job.id)).buffer);
        expect(changed.worksheets[0]!.getCell('E2').value).toEqual(new Date('2026-02-03T00:00:00Z'));
    });
    it('preserves mixed section operations and implicit price units without retaining rejected/ignored data', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic properties');
        ws.addRow(['№', 'Адрес', 'Площадь', 'Операция', 'Цена', 'Дата']);
        ws.addRow(['Продажа']).font = { bold: true };
        ws.addRow(['SYN-P1', 'Synthetic sale', 40, null, '2 млн', null]);
        ws.addRow(['Аренда']).font = { bold: true };
        ws.addRow(['SYN-P2', 'Synthetic rent', 50, 'Аренда', 12000, new Date('2026-01-03T00:00:00Z')]);
        ws.addRow(['SYN-REJECT', null, 60, 'Аренда', 900, null]);
        ws.addRow(['SYN-HIDDEN', 'Synthetic hidden', 60, 'Аренда', 800, null]).hidden = true;
        const ignored = wb.addWorksheet('Synthetic ignored');
        ignored.getColumn(1).width = 23; ignored.getColumn(4).width = 41;
        ignored.getCell('D3').value = 'SYNTHETIC_IGNORED_VALUE';
        ignored.getCell('D3').numFmt = '0.00';
        const profile = buildProfile(wb);
        profile.sheets[0]!.defaults.priceUnit = 'rub_month';
        profile.sheets[1]!.target = 'ignore';
        const r = await roundtrip(wb, profile);
        expect(r.result).toMatchObject({ imported: 2, skipped: 2 });
        expect(r.after.worksheets[1]!.getCell('D3').value).toBeNull();
        for (const rn of [6, 7]) expect(r.after.worksheets[0]!.getRow(rn).actualCellCount).toBe(0);
        expect(parseEnterprise(r.after, profile).rows.map(row => row.record.priceUnit)).toEqual(['rub_month', 'rub_month']);
        expect((await commit(r.output.buffer, profile)).result.imported).toBe(0);
        expect(await db.property.count()).toBe(2);
        expect(r.output.report.UNSUPPORTED_COLUMN).toBe(0);
    });
    it('reports explicitly ignored columns while still enforcing key/date preservation', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic');
        ws.addRow(['Адрес', 'Площадь', 'Операция', 'Unknown synthetic field']);
        ws.addRow(['Synthetic address', 20, 'Продажа', 'SYNTHETIC_DO_NOT_COPY']);
        const profile = buildProfile(wb);
        profile.sheets[0]!.columns['unknown synthetic field'] = 'ignore';
        const r = await roundtrip(wb, profile);
        expect(r.output.report.UNSUPPORTED_COLUMN).toBe(1);
        expect(r.after.worksheets[0]!.getCell('D2').value).toBeNull();
    });
    it('exports edited CRM operations, prices and contacts instead of replaying source payloads', async () => {
        const wb = new ExcelJS.Workbook(), properties = wb.addWorksheet('Synthetic property');
        properties.addRow(['Адрес', 'Площадь', 'Операция', 'Цена']);
        properties.addRow(['Synthetic edit', 20, 'Аренда', 100]);
        const clients = wb.addWorksheet('Synthetic client');
        clients.addRow(['Клиент', 'Телефон', 'Тел.', 'Запрос']);
        clients.addRow(['Synthetic edit client', '+7 (900) 000-00-21', '+7 (901) 000-00-22', 'Купить']);
        const profile = buildProfile(wb);
        profile.sheets[0]!.defaults.priceUnit = 'rub_month';
        const { job } = await commit(Buffer.from(await wb.xlsx.writeBuffer()), profile);
        const property = await db.property.findFirstOrThrow();
        await db.property.update({ where: { id: property.id }, data: { operationType: 'sale', price: '123456.78' } });
        const contact = await db.clientContact.findFirstOrThrow({ where: { normalizedValue: '+79000000021' } });
        await db.clientContact.update({ where: { id: contact.id }, data: { rawValue: '+7 (902) 000-00-23', normalizedValue: '+79020000023' } });
        const exported = await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer);
        const parsed = parseEnterprise(exported, profile);
        expect(parsed.rows[0]!.record).toMatchObject({ operationType: 'sale', price: '123456.78' });
        expect(parsed.rows[1]!.dedupe.phones.sort()).toEqual(['+79010000022', '+79020000023']);
        expect(exported.worksheets[1]!.getCell('C2').value).toBeNull();
    });
});
