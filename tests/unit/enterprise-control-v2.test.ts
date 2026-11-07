import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildProfile, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';

function synthetic() {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Контроль договоров');
    ws.addRow(['Адрес', 'Площадь', 'Наличие договора', 'Комиссия от', 'Комиссия до', 'Задача', 'Паспорт', 'Кем выдан', 'Регистрация', 'Дата рождения']);
    ws.addRow(['SYNTHETIC_CONTROL', 40, 'Нет', 0, 1200, 'Check synthetic contract', ...Array(4).fill('SYNTHETIC_EXCLUDED_SECRET')]);
    return { wb, ws, profile: buildProfile(wb) };
}
describe('enterprise control v2 policy and structure', () => {
    it('recognizes the versioned target; excluded columns cannot be remapped back in', () => {
        const { wb, profile } = synthetic();
        expect(profile.sheets[0]!.target).toBe('property_agreement_control');
        for (const key of ['паспорт', 'кем выдан', 'регистрация', 'дата рождения']) profile.sheets[0]!.columns[key] = 'adText';
        const parsed = parseEnterprise(wb, profile);
        expect(parsed.unresolved).toEqual([]);
        expect(parsed.rows[0]!.record).toMatchObject({ agreementPresent: false, commissionFrom: '0', commissionTo: '1200', taskText: 'Check synthetic contract' });
        expect(JSON.stringify(parsed)).not.toContain('SYNTHETIC_EXCLUDED_SECRET');
    });
    it('requires explicit resolution rather than silently dropping unsupported target fields', () => {
        const { wb, ws, profile } = synthetic();
        ws.getCell('K1').value = 'Клиент'; ws.getCell('K2').value = 'SYNTHETIC_UNSUPPORTED';
        profile.sheets[0]!.columns['клиент'] = 'name';
        expect(parseEnterprise(wb, profile).unresolved).toContainEqual({ sheet: 1, row: 1, column: 11 });
    });
    it('rejects ambiguous presence and invalid commission ranges, retains hidden-row policy', () => {
        const { wb, ws, profile } = synthetic();
        ws.getCell('C2').value = 'Да наверное'; ws.getCell('D2').value = 2000;
        expect(parseEnterprise(wb, profile).rows[0]!.errorCodes).toEqual(expect.arrayContaining(['INVALID_AGREEMENT_PRESENCE', 'INVALID_COMMISSION_RANGE']));
        ws.getRow(2).hidden = true;
        expect(parseEnterprise(wb, profile).rows[0]!.validationStatus).toBe('skipped_policy');
    });
    it('rejects nonnumeric commissions and unsafe URLs; archive policy remains explicit', () => {
        const { wb, ws, profile } = synthetic();
        ws.getCell('D2').value = '10%';
        ws.getCell('K1').value = 'Реклама'; ws.getCell('K2').value = 'https://user:secret@example.invalid/ad';
        profile.sheets[0]!.columns['реклама'] = 'adUrl';
        expect(parseEnterprise(wb, profile).rows[0]!.errorCodes).toEqual(expect.arrayContaining(['INVALID_COMMISSION', 'INVALID_AD_URL']));
        ws.getCell('D2').value = 0; ws.getCell('K2').value = null; ws.getRow(2).hidden = true;
        profile.sheets[0]!.hiddenRows = 'archive';
        expect(parseEnterprise(wb, profile).rows[0]).toMatchObject({ validationStatus: 'warning', record: { status: 'archived' } });
    });
    it('detects shifted/repeated blocks structurally, not by row ordinal', () => {
        const { wb, ws } = synthetic();
        ws.spliceRows(1, 0, [], []);
        ws.addRow([]); ws.addRow(['Адрес', 'Наличие договора']); ws.addRow(['SYNTHETIC_SECOND', 'Да']);
        const parsed = parseEnterprise(wb, buildProfile(wb));
        expect(parsed.blocks).toHaveLength(2);
        expect(parsed.rows.map(r => r.target)).toEqual(['property_agreement_control', 'property_agreement_control']);
    });
});
