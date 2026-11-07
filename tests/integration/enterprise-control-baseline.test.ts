import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDatabase, seedBase, type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise, commitEnterprise, exportEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile, loadEnterprise, parseEnterprise, type EnterpriseProfile } from '@/modules/import/domain/enterprise-workbook';

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
async function commit(bytes: Buffer, profile: EnterpriseProfile) {
    const job = await uploadEnterprise(users.manager, new File([new Uint8Array(bytes)], 'synthetic-baseline.xlsx'), profile);
    const result = await commitEnterprise(users.manager, job.id, { confirmed: true, acceptWarnings: true,
        expectedMappingVersion: (await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).mappingVersion });
    return { job, result };
}
describe('synthetic control source-row property baseline', () => {
    it.each([null, '73.5'])('roundtrips multiple rows sharing existing property with area %s, without overwrites or duplicates', async area => {
        const property = await db.property.create({ data: { addressText: 'Synthetic Nebula Lane 17', area, price: '98765432109876.54',
            district: 'Synthetic CRM district', propertyType: 'commercial', operationType: 'rent', sourceType: 'external_market',
            status: 'paused', responsibleUserId: users.manager.userId, createdBy: users.manager.userId,
            description: 'Synthetic CRM description', attributesJsonb: { priceUnit: 'rub_month' } } });
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Контроль договоров');
        ws.addRow(['№', 'Адрес', 'Площадь', 'Цена', 'Операция', 'Наличие договора', 'Комиссия', 'Рекл. текст', 'Площадка', 'Статус рекламы', 'Район', 'Актуальность', 'Единица цены']);
        ws.addRow(['SYN-N1', 'Synthetic  Nebula Lane 17', null, null, 'Аренда', 'Нет', 0, 'Synthetic copy one', 'Авито', 'Не опубликовано', null, null]);
        ws.addRow(['SYN-N2', 'Synthetic Nebula  Lane 17', area === null ? null : Number(area), '12345678901234.56', 'Аренда', 'Нет', 0, 'Synthetic copy two', 'Авито', 'Не опубликовано', null, null]);
        ws.addRow(['SYN-N3', 'Synthetic   Nebula Lane 17', null, 0, 'Аренда', 'Нет', 0, 'Synthetic copy three', 'Авито', 'Не опубликовано', null, null]);
        for (let rn = 2; rn <= 4; rn++) {
            ws.getCell(rn, 12).value = 'active';
            ws.getCell(rn, 13).value = 'rub_month';
        }
        // Row keys intentionally identify address/area within a sheet. Distinct
        // control sheets allow several approved controls of the same property.
        for (let rn = 3; rn <= 4; rn++) {
            const other = wb.addWorksheet(`Контроль договоров ${rn}`);
            other.addRow(ws.getRow(1).values);
            other.addRow(ws.getRow(rn).values);
        }
        for (const rn of [3, 4]) ws.getRow(rn).eachCell(cell => { cell.value = null; });
        const profile = buildProfile(wb), bytes = Buffer.from(await wb.xlsx.writeBuffer());
        for (const sheet of profile.sheets) sheet.statusMap = { active: 'active', closed: 'closed' };
        const original = parseEnterprise(await loadEnterprise(bytes), profile);
        expect(original.unresolved).toEqual([]);
        expect(original.rows).toHaveLength(3);
        expect(original.rows.every(r => r.target === 'property_agreement_control')).toBe(true);
        expect(original.rows.map(r => r.errorCodes)).toEqual([[], [], []]);
        const { job, result } = await commit(bytes, profile);
        expect(result).toMatchObject({ imported: 3, skipped: 0 });
        expect(await db.property.findUniqueOrThrow({ where: { id: property.id } })).toEqual(property);
        const receipts = await db.importRowResult.findMany({ where: { importJobId: job.id } });
        expect(receipts.every(r => r.targetEntityId === property.id)).toBe(true);
        const output = await exportEnterprise(users.manager, job.id), exported = await loadEnterprise(output.buffer);
        const parsed = parseEnterprise(exported, profile);
        expect(parsed.rows.map(r => r.recordKey)).toEqual(original.rows.map(r => r.recordKey));
        for (let si = 0; si < 3; si++) {
            for (const col of [1, 2, 3, 4, 5, 7, 8, 11, 12, 13])
                expect(exported.worksheets[si]!.getCell(2, col).value).toEqual(wb.worksheets[si]!.getCell(2, col).value);
        }
        expect((await commit(output.buffer, profile)).result).toMatchObject({ imported: 0, skipped: 3 });
        expect(await db.property.count()).toBe(1);
        expect(await db.agreement.count()).toBe(3);
        expect(await db.advertisement.count()).toBe(3);
        // Unrelated edits must not replace per-row source differences.
        await db.property.update({ where: { id: property.id }, data: { description: 'Synthetic edited description', addressText: 'Synthetic  Nebula   Lane 17' } });
        const partial = parseEnterprise(await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer), profile);
        expect(partial.rows.map(r => r.record.price)).toEqual([null, '12345678901234.56', '0']);
        expect(partial.rows.map(r => r.recordKey)).toEqual(original.rows.map(r => r.recordKey));
        expect(partial.rows.map(r => r.record.addressText)).toEqual(original.rows.map(r => r.record.addressText));
        // All actual edited fields, including explicit zero and NULL, are authoritative.
        await db.property.update({ where: { id: property.id }, data: { addressText: 'Synthetic Quasar Road 91', area: area === null ? '0' : null,
            price: '0', district: 'Synthetic edited district', operationType: 'sale', status: 'closed', attributesJsonb: { priceUnit: 'rub_total' } } });
        const edited = parseEnterprise(await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer), profile);
        for (const row of edited.rows) expect(row.record).toMatchObject({ addressText: 'Synthetic Quasar Road 91', area: area === null ? '0' : null,
            price: '0', district: 'Synthetic edited district', operationType: 'sale', status: 'closed', priceUnit: 'rub_total' });
        await db.property.update({ where: { id: property.id }, data: { price: '76543210987654.32' } });
        const exact = parseEnterprise(await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer), profile);
        expect(exact.rows.every(r => r.record.price === '76543210987654.32')).toBe(true);
        await db.property.update({ where: { id: property.id }, data: { price: null } });
        const cleared = parseEnterprise(await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer), profile);
        expect(cleared.rows.every(r => r.record.price === null)).toBe(true);
    });
});
