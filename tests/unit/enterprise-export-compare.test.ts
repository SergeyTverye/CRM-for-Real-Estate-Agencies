import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildProfile } from '@/modules/import/domain/enterprise-workbook';
import { compareWorkbook } from '../../scripts/private-import/compare-workbook';

describe('payload-free enterprise export comparison', () => {
    it('detects real date/key/money losses rather than accepting unsupported fields as an excuse', () => {
        const before = new ExcelJS.Workbook(), after = new ExcelJS.Workbook();
        for (const wb of [before, after]) {
            const ws = wb.addWorksheet('Synthetic');
            ws.addRow(['Адрес', 'Площадь', 'Операция', 'Цена', 'Дата']);
            ws.addRow(['SYNTHETIC_VALUE_NOT_DIAGNOSTIC', 20, 'Продажа', 100, new Date('2026-01-01T00:00:00Z')]);
            wb.addWorksheet('Empty ignored');
        }
        after.worksheets[0]!.getCell('A2').value = 'SYNTHETIC_CHANGED';
        after.worksheets[0]!.getCell('D2').value = 200;
        after.worksheets[0]!.getCell('E2').value = null;
        const profile = buildProfile(before);
        profile.sheets[1]!.target = 'ignore';
        const counters = compareWorkbook(before, after, profile, new Set(['1:2']));
        for (const key of ['row_keys', 'key_fields', 'money', 'dates']) expect(counters[key]!.mismatched).toBe(1);
        expect(JSON.stringify(counters)).not.toContain('SYNTHETIC');
        expect(counters.widths!.mismatched).toBe(0);
    });
});
