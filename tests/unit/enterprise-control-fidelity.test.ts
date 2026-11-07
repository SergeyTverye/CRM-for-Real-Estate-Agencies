import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildProfile, classifyEnterpriseHeader, enterpriseProfileSchema, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';

function fixture(amount: string | number = 0, platform = 'Авито', status = 'Не опубликовано') {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Контроль договоров');
    ws.addRow(['Адрес', 'Площадь', 'Наличие договора', 'Сумма комиссии', 'Рекламная площадка', 'Реклама', 'Комиссия от', 'Комиссия до', 'Паспорт', 'Регистрация', 'Дата рождения']);
    ws.addRow(['SYNTHETIC_FIDELITY', 40, 'Нет', amount, platform, status, 0, 100, 'SYNTHETIC_EXCLUDED', 'SYNTHETIC_EXCLUDED', 'SYNTHETIC_EXCLUDED']);
    return { wb, ws, profile: buildProfile(wb) };
}
describe('synthetic control scalar and advertising fidelity', () => {
    it.each([0, '0.00', '12345678901234.56', '1 250,50', '1,25 тыс'])('accepts exact scalar %s with independent range semantics', amount => {
        const f = fixture(amount), parsed = parseEnterprise(f.wb, f.profile);
        expect(parsed.unresolved).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ validationStatus: 'ready', errorCodes: [], record: {
            commissionAmount: amount === '12345678901234.56' ? amount : typeof amount === 'string' && amount.startsWith('1') ? amount.includes('тыс') ? '1250' : '1250.5' : '0',
            commissionFrom: '0', commissionTo: '100', adPlatform: 'avito', adStatus: 'draft',
        } });
        expect(JSON.stringify(parsed)).not.toContain('SYNTHETIC_EXCLUDED');
    });
    it.each(['10%', '100-200', '1/2', '100000000000000', '-1', '1.001'])('rejects unsupported scalar %s', value => {
        const f = fixture(value);
        expect(parseEnterprise(f.wb, f.profile).rows[0]!.errorCodes).toContain('INVALID_COMMISSION');
    });
    it('accepts old profiles without new maps and keeps explicitly mapped URL columns', () => {
        const f = fixture();
        const old = JSON.parse(JSON.stringify(f.profile));
        delete old.sheets[0].adPlatformMap; delete old.sheets[0].adStatusMap;
        const profile = enterpriseProfileSchema.parse(old);
        expect(profile.sheets[0]).toMatchObject({ adPlatformMap: {}, adStatusMap: {} });
        f.ws.getCell('F2').value = 'https://example.invalid/synthetic';
        profile.sheets[0]!.columns['реклама'] = 'adUrl';
        const row = parseEnterprise(f.wb, profile).rows[0]!;
        expect(row.errorCodes).toEqual([]);
        expect(row.warningCodes).toContain('AD_DETAILS_REQUIRED');
        expect(row.record).toMatchObject({ adUrl: 'https://example.invalid/synthetic', adStatus: null });
    });
    it('requires user resolution for unknown values; mappings can only target closed codes', () => {
        const f = fixture(0, 'SYNTHETIC_PLATFORM_LABEL', 'SYNTHETIC_STATUS_LABEL');
        expect(parseEnterprise(f.wb, f.profile).rows[0]!.errorCodes).toEqual(['UNMAPPED_AD_PLATFORM', 'UNMAPPED_AD_STATUS']);
        const sheet = f.profile.sheets[0]!;
        sheet.adPlatformMap = { synthetic_platform_label: 'cian' };
        sheet.adStatusMap = { synthetic_status_label: 'paused' };
        expect(parseEnterprise(f.wb, f.profile).rows[0]).toMatchObject({ validationStatus: 'ready', record: { adPlatform: 'cian', adStatus: 'paused' } });
        expect(enterpriseProfileSchema.safeParse({ ...f.profile, sheets: [{ ...sheet, adStatusMap: { synthetic: 'probably_active' } }] }).success).toBe(false);
        expect(enterpriseProfileSchema.safeParse({ ...f.profile, sheets: [{ ...sheet, adPlatformMap: { synthetic: 'arbitrary_platform' } }] }).success).toBe(false);
    });
    it.each(['draft', 'active', 'paused', 'expired', 'removed', 'not published'])('recognizes explicit status %s, never property-status inference', value => {
        const f = fixture(0, 'cian', value);
        expect(parseEnterprise(f.wb, f.profile).rows[0]!.record.adStatus).toBe(value === 'not published' ? 'draft' : value);
    });
    it('recognizes headers rather than ordinals; preserves scalar archive support', () => {
        expect(classifyEnterpriseHeader('Сумма комиссии, руб.')).toBe('commissionAmount');
        expect(classifyEnterpriseHeader('Ссылка на рекламу')).toBe('adUrl');
        expect(classifyEnterpriseHeader('Реклама')).toBe('adStatus');
        expect(classifyEnterpriseHeader('Unknown synthetic column')).toBeNull();
        const f = fixture(); f.ws.spliceRows(1, 0, [], []);
        expect(parseEnterprise(f.wb, buildProfile(f.wb)).rows[0]).toMatchObject({ rowNumber: 4, record: { commissionAmount: '0', adStatus: 'draft' } });
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Архив сделок');
        ws.addRow(['Адрес', 'Договор', 'Сумма комиссии']); ws.addRow(['SYNTHETIC_ARCHIVE', 'SYNTHETIC_REF', 0]);
        const parsed = parseEnterprise(wb, buildProfile(wb));
        expect(parsed.unresolved).toEqual([]);
        expect(parsed.rows[0]).toMatchObject({ target: 'historical_deal_archive', record: { commissionAmount: '0' } });
    });
});
