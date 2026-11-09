import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDatabase, seedBase, type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise, inspectEnterprise, commitEnterprise, exportEnterprise, remapEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile, loadEnterprise, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';
import { ForbiddenError } from '@/shared/errors';

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
const file = (b: Buffer) => new File([new Uint8Array(b)], 'synthetic-control.xlsx');
async function fixture() {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Контроль договоров');
    ws.addRow(['Адрес', 'Площадь', 'Наличие договора', 'Причины, почему его нет', 'Комиссия от', 'Комиссия до', 'Что нужно исправить', 'Рекл. текст', 'Ссылка на рекламу', 'Задача', 'Паспорт', 'Кем выдан', 'Регистрация', 'Дата рождения']);
    ws.addRow(['SYNTHETIC_CONTROL_A', 40, 'Нет', 'Synthetic reason', 0, 1200, 'Synthetic fix', 'Synthetic ad', 'https://example.invalid/synthetic', 'Synthetic task', ...Array(4).fill('SYNTHETIC_EXCLUDED_SECRET')]);
    ws.addRow(['SYNTHETIC_HIDDEN', 41, 'Да']).hidden = true;
    const profile = buildProfile(wb);
    return { wb, ws, profile, bytes: Buffer.from(await wb.xlsx.writeBuffer()) };
}
async function confirm(id: string) {
    const job = await inspectEnterprise(users.manager, id);
    return commitEnterprise(users.manager, id, { confirmed: true, acceptWarnings: true, expectedMappingVersion: job.mappingVersion });
}
describe('enterprise control v2 synthetic normalized workflow', () => {
    it('dry-run writes no business rows; explicit commit, links, export edits and idempotent reimport', async () => {
        const f = await fixture(), job = await uploadEnterprise(users.manager, file(f.bytes), f.profile);
        for (const count of [await db.property.count(), await db.agreement.count(), await db.advertisement.count(), await db.task.count()]) expect(count).toBe(0);
        await expect(commitEnterprise(users.manager, job.id, { confirmed: false })).rejects.toThrow();
        await expect(commitEnterprise(users.manager, job.id, { confirmed: true, expectedMappingVersion: 'stale' })).rejects.toThrow('Повторите проверку');
        expect(await confirm(job.id)).toMatchObject({ imported: 1, skipped: 1 });
        expect(await confirm(job.id)).toMatchObject({ imported: 1 });
        const p = await db.property.findFirstOrThrow(), a = await db.agreement.findFirstOrThrow(), ad = await db.advertisement.findFirstOrThrow(), task = await db.task.findFirstOrThrow();
        expect(a).toMatchObject({ propertyId: p.id, status: 'no_agreement', absenceReasonCode: 'other', commissionNotes: 'Комиссия: от 0 до 1200', actionRequired: 'Synthetic fix' });
        expect(ad).toMatchObject({ propertyId: p.id, adText: 'Synthetic ad' });
        expect(await db.taskProperty.count({ where: { propertyId: p.id, taskId: task.id } })).toBe(1);
        expect(await db.taskAgreement.count({ where: { agreementId: a.id, taskId: task.id } })).toBe(1);
        expect(await db.taskAdvertisement.count({ where: { advertisementId: ad.id, taskId: task.id } })).toBe(1);
        const output = await exportEnterprise(users.manager, job.id);
        const parsed = parseEnterprise(await loadEnterprise(output.buffer), f.profile);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0]!.record).toMatchObject({ agreementPresent: false, absenceReason: 'Synthetic reason', commissionFrom: '0', commissionTo: '1200', taskText: 'Synthetic task', adText: 'Synthetic ad', fixNote: 'Synthetic fix' });
        const exported = await loadEnterprise(output.buffer);
        for (let col = 11; col <= 14; col++) expect(exported.worksheets[0]!.getCell(2, col).value).toBeNull();
        expect(JSON.stringify(await inspectEnterprise(users.manager, job.id))).not.toContain('SYNTHETIC_EXCLUDED_SECRET');
        expect(JSON.stringify(await db.importRowResult.findMany())).not.toContain('SYNTHETIC_EXCLUDED_SECRET');
        expect(JSON.stringify([p, a, ad, task])).not.toContain('SYNTHETIC_EXCLUDED_SECRET');
        const repeat = await uploadEnterprise(users.manager, file(output.buffer), f.profile);
        expect((await confirm(repeat.id)).imported).toBe(0);
        expect(await db.agreement.count()).toBe(1); expect(await db.task.count()).toBe(1);
        await db.agreement.update({ where: { id: a.id }, data: { actionRequired: 'Edited synthetic fix' } });
        await db.advertisement.update({ where: { id: ad.id }, data: { adText: 'Edited synthetic ad' } });
        const edited = parseEnterprise(await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer), f.profile);
        expect(edited.rows[0]!.record).toMatchObject({ fixNote: 'Edited synthetic fix', adText: 'Edited synthetic ad' });
    });
    it('does not overwrite an existing property and refuses ambiguous links atomically', async () => {
        const f = await fixture();
        const data = { addressText: 'SYNTHETIC_CONTROL_A', propertyType: 'commercial', operationType: 'rent', sourceType: 'agency_listing', status: 'paused', responsibleUserId: users.realtor1.userId, createdBy: users.manager.userId, area: '40' };
        const existing = await db.property.create({ data });
        const job = await uploadEnterprise(users.manager, file(f.bytes), f.profile);
        await confirm(job.id);
        expect(await db.property.count()).toBe(1);
        expect(await db.property.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ status: 'paused', responsibleUserId: users.realtor1.userId });
        await db.property.create({ data });
        f.ws.getCell('A2').value = 'SYNTHETIC_CONTROL_A '; 
        const other = f.wb.addWorksheet('Ignored'); other.getCell('A1').value = 'synthetic';
        await db.importRowResult.deleteMany();
        const nextProfile = buildProfile(f.wb); nextProfile.sheets[1]!.target = 'ignore';
        const next = await uploadEnterprise(users.manager, file(Buffer.from(await f.wb.xlsx.writeBuffer())), nextProfile);
        await expect(confirm(next.id)).rejects.toThrow('AMBIGUOUS_CONTROL_PROPERTY');
        expect(await db.agreement.count()).toBe(1);
        expect((await inspectEnterprise(users.manager, next.id)).status).toBe('dry_run_ready');
    });
    it('keeps mapping and manager authorization gates; present is draft, never fabricated signed', async () => {
        const f = await fixture(); f.ws.getCell('C2').value = 'Да'; f.ws.getCell('O1').value = 'Unknown synthetic column'; f.ws.getCell('O2').value = 'SYNTHETIC_IGNORE';
        const job = await uploadEnterprise(users.manager, file(Buffer.from(await f.wb.xlsx.writeBuffer())));
        await expect(confirm(job.id)).rejects.toThrow('UNRESOLVED_COLUMNS');
        const profile = buildProfile(f.wb); profile.sheets[0]!.columns['unknown synthetic column'] = 'ignore';
        await remapEnterprise(users.manager, job.id, profile);
        for (const actor of [users.realtor1, users.realtor2]) {
            await expect(uploadEnterprise(actor, file(f.bytes))).rejects.toBeInstanceOf(ForbiddenError);
            await expect(inspectEnterprise(actor, job.id)).rejects.toBeInstanceOf(ForbiddenError);
            await expect(remapEnterprise(actor, job.id, profile)).rejects.toBeInstanceOf(ForbiddenError);
            await expect(commitEnterprise(actor, job.id, {})).rejects.toBeInstanceOf(ForbiddenError);
            await expect(exportEnterprise(actor, job.id)).rejects.toBeInstanceOf(ForbiddenError);
        }
        await expect(commitEnterprise(users.manager, job.id, { confirmed: true, expectedMappingVersion: (await inspectEnterprise(users.manager, job.id)).mappingVersion })).rejects.toThrow('WARNINGS_REQUIRE_CONFIRMATION');
        await confirm(job.id);
        expect(await db.agreement.findFirstOrThrow()).toMatchObject({ status: 'draft', signedAt: null });
    });
});
