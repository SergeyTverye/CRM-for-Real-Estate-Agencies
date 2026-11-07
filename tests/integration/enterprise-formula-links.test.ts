import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { beforeEach, expect, it } from 'vitest';
import { db, resetDatabase, seedBase, type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise, commitEnterprise, exportEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile, loadEnterprise, type EnterpriseProfile } from '@/modules/import/domain/enterprise-workbook';

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
async function commit(bytes: Buffer, profile: EnterpriseProfile) {
    const job = await uploadEnterprise(users.manager, new File([new Uint8Array(bytes)], 'synthetic-formulas.xlsx'), profile);
    const stored = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    const result = await commitEnterprise(users.manager, job.id, { confirmed: true, acceptWarnings: true, expectedMappingVersion: stored.mappingVersion });
    return { job, result };
}
it('preserves safe identity/cache, rejects excluded refs and links, exports edited CRM values and reimports without duplicates', async () => {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic property');
    ws.addRow(['Адрес', 'Площадь', 'Цена', 'Операция', 'Описание', 'Паспорт', 'Ignored']);
    const formulas = ['SUM($B$2:B2)*2', '[external.xlsx]Sheet1!B2', 'F4+1', 'B5*2', 'B8*2', 'G7+1', 'B2*2', 'B2*2', 'B2*2'];
    for (let i = 0; i < formulas.length; i++) {
        const n = i + 2;
        ws.addRow([`SYNTHETIC_FORMULA_${n}`, 20, { formula: formulas[i]!, result: 40 }, 'Продажа', { text: 'Synthetic description', hyperlink: 'https://example.invalid/property' }, 'SYNTHETIC_FORBIDDEN', 39]);
        ws.getCell(n, 3).numFmt = '#,##0.00';
    }
    ws.getRow(8).hidden = true;
    ws.getCell('C9').value = { sharedFormula: 'C8', result: 40 };
    const shared = { formula: 'B2*2', result: 40, shareType: 'shared', ref: 'C8:C9' };
    ws.getCell('C8').value = shared;
    ws.getCell('H1').value = { formula: 'WEBSERVICE("SYNTHETIC_FORBIDDEN")', result: 'Ignored formula header' };
    ws.getColumn(2).width = 23;
    const ignored = wb.addWorksheet('Synthetic ignored'); ignored.getCell('A1').value = { formula: '1+1', result: 'SYNTHETIC_FORBIDDEN' };
    const profile = buildProfile(wb); profile.sheets[0]!.columns.ignored = 'ignore'; profile.sheets[0]!.columns['ignored formula header'] = 'ignore'; profile.sheets[1]!.target = 'ignore';
    const { job, result } = await commit(Buffer.from(await wb.xlsx.writeBuffer()), profile);
    expect(result.imported).toBe(8);
    const p = await db.property.findFirstOrThrow({ where: { addressText: 'SYNTHETIC_FORMULA_2' } });
    await db.property.update({ where: { id: p.id }, data: { area: '30', price: '60', description: '=SUM(B2:B2)' } });
    const unsafe = await db.property.findFirstOrThrow({ where: { addressText: 'SYNTHETIC_FORMULA_3' } });
    await db.property.update({ where: { id: unsafe.id }, data: { sourceUrl: 'https://user:pass@example.invalid' } });
    const output = await exportEnterprise(users.manager, job.id), exported = await loadEnterprise(output.buffer), sheet = exported.worksheets[0]!;
    expect(sheet.getCell('C2').value).toMatchObject({ formula: 'SUM($B$2:B2)*2', result: 60 });
    expect(sheet.getCell('B2').value).toBe(30);
    expect(sheet.getCell('C2').numFmt).toBe('#,##0.00'); expect(sheet.getColumn(2).width).toBe(23);
    expect(sheet.getCell('E2').value).toMatchObject({ text: '=SUM(B2:B2)', hyperlink: 'https://example.invalid/property' });
    expect(sheet.getCell('E3').hyperlink).toBeUndefined();
    for (const addr of ['C3', 'C4', 'C6', 'C7', 'C9']) expect(sheet.getCell(addr).type).not.toBe(6);
    expect(sheet.getCell('C5').value).toMatchObject({ formula: 'B5*2', result: 40 });
    expect(sheet.getCell('H1').value).toBeNull(); expect(sheet.getCell('F2').value).toBeNull();
    expect(output.report).toMatchObject({ FORMULA_PRESERVED: 2, FORMULA_VALUE_MISMATCH: 1, FORMULA_SHARED_UNSUPPORTED: 2, FORMULA_RECALC_ON_LOAD: 2 });
    const xml = Object.values(unzipSync(output.buffer)).map(value => strFromU8(value)).join('');
    expect(strFromU8(unzipSync(output.buffer)['xl/workbook.xml']!)).toContain('fullCalcOnLoad="1"');
    for (const forbidden of ['SYNTHETIC_FORBIDDEN', 'external.xlsx', 'WEBSERVICE', 'user:pass']) expect(xml).not.toContain(forbidden);
    expect(JSON.stringify(await db.importRowResult.findMany())).not.toContain('SYNTHETIC_FORBIDDEN');
    expect(JSON.stringify(output.report)).not.toContain('SYNTHETIC_FORBIDDEN');
    expect((await commit(output.buffer, profile)).result.imported).toBe(0); expect(await db.property.count()).toBe(8);
});

it('supports authoritative control adUrl only as validated http(s) links', async () => {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic control');
    ws.addRow(['Адрес', 'Площадь', 'Наличие договора', 'Ссылка на рекламу', 'Рекл. текст', 'Операция']);
    ws.addRow(['SYNTHETIC_LINK_CONTROL', 20, 'Нет', 'https://example.invalid/ad', '=1+2', 'Аренда']);
    const profile = buildProfile(wb), { job, result } = await commit(Buffer.from(await wb.xlsx.writeBuffer()), profile);
    expect(result.imported, JSON.stringify(await db.importRowResult.findMany())).toBe(1);
    let output = await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer);
    expect(output.worksheets[0]!.getCell('D2').hyperlink).toBe('https://example.invalid/ad');
    expect(output.worksheets[0]!.getCell('E2').value).toBe('=1+2');
    const ad = await db.advertisement.findFirstOrThrow();
    await db.advertisement.update({ where: { id: ad.id }, data: { url: 'javascript:alert(1)' } });
    output = await loadEnterprise((await exportEnterprise(users.manager, job.id)).buffer);
    expect(output.worksheets[0]!.getCell('D2').hyperlink).toBeUndefined();
});

it('never preserves formulas depending on hidden columns, rejected rows or formula cells', async () => {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic dependencies');
    ws.addRow(['Адрес', 'Площадь', 'Цена', 'Операция']);
    ws.addRow(['SYNTHETIC_DEP_A', 20, { formula: 'B2*2', result: 40 }, 'Продажа']);
    ws.addRow(['SYNTHETIC_DEP_B', 20, { formula: 'B5*2', result: 40 }, 'Продажа']);
    ws.addRow(['SYNTHETIC_DEP_C', 20, { formula: 'C2', result: 40 }, 'Продажа']);
    ws.addRow([null, 20, { formula: '1+1', result: 'SYNTHETIC_REJECTED_CACHE' }, 'Продажа']);
    ws.getColumn(2).hidden = true;
    const profile = buildProfile(wb), { job } = await commit(Buffer.from(await wb.xlsx.writeBuffer()), profile);
    const output = await exportEnterprise(users.manager, job.id), exported = await loadEnterprise(output.buffer);
    expect(output.report.FORMULA_DEPENDENCY_REJECTED).toBe(3);
    expect(output.report.FORMULA_CELL_NOT_ALLOWED).toBe(1);
    expect(exported.worksheets[0]!.getColumn(2).hidden).toBe(true);
    for (let n = 2; n <= 4; n++) expect(exported.worksheets[0]!.getCell(n, 3).value).toBe(40);
    expect(Object.values(unzipSync(output.buffer)).map(value => strFromU8(value)).join('')).not.toContain('SYNTHETIC_REJECTED_CACHE');
});
