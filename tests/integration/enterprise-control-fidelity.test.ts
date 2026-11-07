import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDatabase, seedBase, type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise, inspectEnterprise, commitEnterprise, exportEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile, loadEnterprise, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
async function synthetic(amount: string | number = 0, status = 'Не опубликовано') {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Контроль договоров');
    ws.addRow(['Адрес', 'Площадь', 'Наличие договора', 'Комиссия', 'Площадка', 'Статус рекламы', 'Комиссия от', 'Комиссия до', 'Паспорт', 'Кем выдан', 'Регистрация', 'Дата рождения']);
    ws.addRow(['SYNTHETIC_FIDELITY', 40, 'Нет', amount, 'Авито', status, 0, 100, ...Array(4).fill('SYNTHETIC_EXCLUDED')]);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    return { wb, ws, bytes, profile: buildProfile(wb) };
}
const file = (bytes: Buffer) => new File([new Uint8Array(bytes)], 'synthetic-fidelity.xlsx');
async function confirm(id: string) {
    const job = await inspectEnterprise(users.manager, id);
    return commitEnterprise(users.manager, id, { confirmed: true, acceptWarnings: true, expectedMappingVersion: job.mappingVersion });
}
describe('synthetic persisted scalar commission and closed advertising codes', () => {
    it.each([0, '12345678901234.56'])('persists and backexports exact scalar %s without DealCommission; supports edited codes and reimport', async amount => {
        const f = await synthetic(amount), job = await uploadEnterprise(users.manager, file(f.bytes), f.profile);
        expect(await db.agreement.count()).toBe(0); expect(await db.property.count()).toBe(0); expect(await db.advertisement.count()).toBe(0);
        await expect(commitEnterprise(users.manager, job.id, { confirmed: false })).rejects.toThrow();
        expect(await confirm(job.id)).toMatchObject({ imported: 1 });
        const a = await db.agreement.findFirstOrThrow(), ad = await db.advertisement.findFirstOrThrow();
        expect(a.commissionValue?.toString()).toBe(String(amount));
        expect(a).toMatchObject({ commissionType: 'fixed', commissionNotes: 'Комиссия: от 0 до 100' });
        expect(ad).toMatchObject({ platformCode: 'avito', status: 'draft', url: null });
        expect(await db.dealCommission.count()).toBe(0);
        const output = await exportEnterprise(users.manager, job.id);
        const wb = await loadEnterprise(output.buffer), parsed = parseEnterprise(wb, f.profile);
        expect(parsed.unresolved).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ validationStatus: 'ready', record: { commissionAmount: String(amount), commissionFrom: '0', commissionTo: '100', adPlatform: 'avito', adStatus: 'draft' } });
        expect(JSON.stringify(parsed)).not.toContain('SYNTHETIC_EXCLUDED');
        expect(JSON.stringify(await db.importRowResult.findMany())).not.toContain('SYNTHETIC_EXCLUDED');
        for (let col = 9; col <= 12; col++) expect(wb.worksheets[0]!.getCell(2, col).value).toBeNull();
        const repeat = await uploadEnterprise(users.manager, file(output.buffer), f.profile);
        expect(await confirm(repeat.id)).toMatchObject({ imported: 0 });
        expect(await db.agreement.count()).toBe(1);
        // New source identity exercises a real reimport rather than only receipt/idempotency.
        wb.worksheets[0]!.getCell('A2').value = 'SYNTHETIC_REIMPORT';
        const next = await uploadEnterprise(users.manager, file(Buffer.from(await wb.xlsx.writeBuffer())), f.profile);
        expect(await confirm(next.id)).toMatchObject({ imported: 1 });
        const nextAgreement = await db.agreement.findFirstOrThrow({ where: { id: { not: a.id } } });
        expect(nextAgreement.commissionValue?.toString()).toBe(String(amount));
        expect(await db.advertisement.count({ where: { status: 'active' } })).toBe(0);
        await db.agreement.update({ where: { id: a.id }, data: { commissionValue: '47.25' } });
        await db.advertisement.update({ where: { id: ad.id }, data: { platformCode: 'cian', status: 'removed' } });
        const edited = parseEnterprise(await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer), f.profile);
        expect(edited.rows[0]!.record).toMatchObject({ commissionAmount: '47.25', adPlatform: 'cian', adStatus: 'removed' });
    });
    it('keeps missing amounts null and text-only advertisements draft with a visible warning', async () => {
        const f = await synthetic('');
        f.ws.getCell('E2').value = null; f.ws.getCell('F2').value = null;
        f.ws.getCell('M1').value = 'Рекл. текст'; f.ws.getCell('M2').value = 'SYNTHETIC_AD_COPY';
        const profile = buildProfile(f.wb), bytes = Buffer.from(await f.wb.xlsx.writeBuffer());
        const parsed = parseEnterprise(f.wb, profile);
        expect(parsed.rows[0]!.warningCodes).toContain('AD_DETAILS_REQUIRED');
        const job = await uploadEnterprise(users.manager, file(bytes), profile);
        await expect(commitEnterprise(users.manager, job.id, { confirmed: true, expectedMappingVersion: (await inspectEnterprise(users.manager, job.id)).mappingVersion })).rejects.toThrow('WARNINGS_REQUIRE_CONFIRMATION');
        await confirm(job.id);
        expect(await db.agreement.findFirstOrThrow()).toMatchObject({ commissionValue: null, commissionType: null });
        expect(await db.advertisement.findFirstOrThrow()).toMatchObject({ platformCode: 'other', status: 'draft' });
    });
    it('rejects ambiguous property matches atomically', async () => {
        const f = await synthetic();
        const data = { addressText: 'SYNTHETIC_FIDELITY', propertyType: 'commercial', operationType: 'rent', sourceType: 'agency_listing', status: 'active', area: '40', createdBy: users.manager.userId };
        await db.property.create({ data }); await db.property.create({ data });
        const job = await uploadEnterprise(users.manager, file(f.bytes), f.profile);
        await expect(confirm(job.id)).rejects.toThrow('AMBIGUOUS_CONTROL_PROPERTY');
        expect(await db.agreement.count()).toBe(0); expect(await db.advertisement.count()).toBe(0);
    });
    it('requires explicit source-value mapping and exports stable codes through the same profile', async () => {
        const f = await synthetic(0, 'SYNTHETIC_STATUS_LABEL');
        f.ws.getCell('E2').value = 'SYNTHETIC_PLATFORM_LABEL';
        // A generic legacy advertising column can explicitly represent platform, not URL.
        f.ws.getCell('E1').value = 'Реклама';
        const profile = buildProfile(f.wb), sheet = profile.sheets[0]!;
        sheet.columns['реклама'] = 'adPlatform';
        sheet.columns['статус рекламы'] = 'adStatus';
        // Both headers initially classify as status, so resolve the duplicate slots too.
        sheet.columns['@1:5'] = 'adPlatform'; sheet.columns['@1:6'] = 'adStatus';
        const bytes = Buffer.from(await f.wb.xlsx.writeBuffer());
        const invalid = await uploadEnterprise(users.manager, file(bytes), profile);
        await confirm(invalid.id);
        expect(await db.agreement.count()).toBe(0); expect(await db.advertisement.count()).toBe(0);
        expect(parseEnterprise(f.wb, profile).rows[0]).toMatchObject({ validationStatus: 'invalid', errorCodes: ['UNMAPPED_AD_PLATFORM', 'UNMAPPED_AD_STATUS'] });
        sheet.adPlatformMap = { synthetic_platform_label: 'cian' };
        sheet.adStatusMap = { synthetic_status_label: 'paused' };
        const mapped = await uploadEnterprise(users.manager, file(bytes), profile);
        expect(await confirm(mapped.id)).toMatchObject({ imported: 1 });
        expect(await db.advertisement.findFirstOrThrow()).toMatchObject({ platformCode: 'cian', status: 'paused' });
        const parsed = parseEnterprise(await loadEnterprise((await exportEnterprise(users.manager, mapped.id)).buffer), profile);
        expect(parsed.rows[0]).toMatchObject({ validationStatus: 'ready', record: { commissionAmount: '0', adPlatform: 'cian', adStatus: 'paused' } });
    });
});
