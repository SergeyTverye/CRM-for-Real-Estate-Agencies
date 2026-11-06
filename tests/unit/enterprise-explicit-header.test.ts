import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { classifyEnterpriseHeader, detectEnterpriseHeaders, enterpriseProfileSchema, parseEnterprise, parseWorkbookNumber } from '@/modules/import/domain/enterprise-workbook';

function fixture(headerRow: number | 'auto' = 1) {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('SYNTHETIC');
    ws.addRow(['Адрес', 'Площадь', 'Цена', 'Операция', 'Комментарий']);
    const profile = enterpriseProfileSchema.parse({ version: 2, code: 'enterprise_workbook_v2', sheets: [{
        index: 1, target: 'property', headerRow,
        columns: { адрес: 'addressText', площадь: 'area', цена: 'price', операция: 'operationText', комментарий: 'comment' },
    }] });
    return { wb, ws, profile, config: profile.sheets[0]! };
}

describe('explicit enterprise header (in-memory synthetic ExcelJS only)', () => {
    it('keeps label-like operational rows, mapping and subsequent records', () => {
        const { wb, ws, profile, config } = fixture();
        ws.addRow(['адрес', '50 м²', 'цена', 'Продажа', 'статус']);
        ws.addRow(['SYNTHETIC_NEXT', 60, 1000, 'Продажа', 'SYNTHETIC_COMMENT']);
        ws.addRow(['адрес', 'площадь', 'цена', 'Продажа', 'SYNTHETIC_NOT_A_HEADER']);
        ws.addRow(['адрес', 'площадь', 1000, 'Продажа', 'SYNTHETIC_TWO_LABELS']);
        expect(detectEnterpriseHeaders(ws, config).map(h => h.row)).toEqual([1]);
        const parsed = parseEnterprise(wb, profile);
        expect(parsed.blocks.map(b => b.row)).toEqual([1]);
        expect(parsed.rows.map(r => r.rowNumber)).toEqual([2, 3, 4, 5]);
        expect(parsed.rows[0]!.errorCodes).toContain('INVALID_PRICE');
        expect(parsed.rows[1]!.record).toMatchObject({ addressText: 'SYNTHETIC_NEXT', area: '60', price: '1000', comment: 'SYNTHETIC_COMMENT' });
        expect(parsed.unresolved).toEqual([]);
    });

    it('does not detect headers before the configured row or changed/shifted layouts afterwards', () => {
        const { ws, config } = fixture(3);
        ws.addRow([]);
        ws.addRow(['Адрес', 'Площадь', 'Цена', 'Операция', 'Комментарий']);
        ws.addRow(['Адрес', 'Цена', 'Площадь', 'Операция', 'Комментарий']);
        ws.addRow([null, 'Адрес', 'Площадь', 'Цена', 'Операция', 'Комментарий']);
        expect(detectEnterpriseHeaders(ws, config).map(h => h.row)).toEqual([3]);
    });

    it('accepts only complete repeated same-column labels, including unknown labels', () => {
        const { wb, ws, profile, config } = fixture();
        ws.getCell('F1').value = 'SYNTHETIC_UNKNOWN';
        config.columns.synthetic_unknown = null;
        ws.addRow(['SYNTHETIC_FIRST', 50, 100, 'Продажа']);
        ws.addRow(['АДРЕС', 'Площадь', 'Цена', 'Операция', 'Комментарий', 'SYNTHETIC_UNKNOWN']);
        ws.addRow(['SYNTHETIC_SECOND', 60, 200, 'Продажа']);
        const parsed = parseEnterprise(wb, profile);
        expect(parsed.blocks.map(b => b.row)).toEqual([1, 3]);
        expect(parsed.rows.map(r => r.rowNumber)).toEqual([2, 4]);
        expect(parsed.unresolved).toEqual([{ sheet: 1, row: 1, column: 6 }, { sheet: 1, row: 3, column: 6 }]);
    });

    it.each([null, 'ignore', 'client_request_need'] as const)('honors explicit block target %s even for an unknown header', target => {
        const { wb, ws, profile, config } = fixture();
        ws.addRow(['SYNTHETIC_FIRST', 50, 100, 'Продажа']);
        ws.addRow(['SYNTHETIC_COLUMN_A', 'SYNTHETIC_COLUMN_B']);
        ws.addRow(['SYNTHETIC_BODY_A', 'SYNTHETIC_BODY_B']);
        config.blockTargets = { '3': target };
        const parsed = parseEnterprise(wb, profile);
        expect(detectEnterpriseHeaders(ws, config).map(h => h.row)).toEqual([1, 3]);
        expect(parsed.rows[0]!.rowNumber).toBe(2);
        if (target === null) expect(parsed.unresolved).toContainEqual({ sheet: 1, row: 3, column: 0 });
        if (target === 'ignore') expect(parsed.rows).toHaveLength(1);
        if (target === 'client_request_need') {
            expect(parsed.unresolved).toContainEqual({ sheet: 1, row: 3, column: 1 });
            expect(parsed.unresolved).toContainEqual({ sheet: 1, row: 3, column: 2 });
        }
    });

    it('preserves mixed logical tables in auto mode', () => {
        const { ws, config } = fixture('auto');
        ws.addRow(['SYNTHETIC_FIRST', 50, 100, 'Продажа']);
        ws.addRow([]);
        ws.addRow(['ФИО', 'Телефон', 'Запрос']);
        ws.addRow(['SYNTHETIC_CLIENT', '+7 (900) 000-00-01', 'Аренда']);
        expect(detectEnterpriseHeaders(ws, config).map(h => [h.row, h.target])).toEqual([[1, 'property'], [4, 'client_request_need']]);
    });

    it('preserves explicitly selected merged two-level headers', () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('SYNTHETIC_MERGED');
        ws.mergeCells('A1:A2'); ws.getCell('A1').value = 'Адрес';
        ws.mergeCells('B1:B2'); ws.getCell('B1').value = 'Площадь';
        ws.mergeCells('C1:D1'); ws.getCell('C1').value = 'Собственник';
        ws.getCell('C2').value = 'ФИО'; ws.getCell('D2').value = 'Тел.';
        ws.addRow(['SYNTHETIC_ADDRESS', 50]);
        const profile = enterpriseProfileSchema.parse({ version: 2, code: 'enterprise_workbook_v2', sheets: [{
            index: 1, target: 'property', headerRow: 1, defaults: { operationType: 'sale' },
            columns: { адрес: 'addressText', площадь: 'area', 'собственник ФИО': 'ownerName', 'собственник Тел.': 'ownerPhone' },
        }] });
        expect(detectEnterpriseHeaders(ws, profile.sheets[0]).map(h => [h.row, h.endRow])).toEqual([[1, 2]]);
        expect(parseEnterprise(wb, profile).rows.map(r => r.rowNumber)).toEqual([3]);
    });

    it('keeps unlabeled populated columns unresolved in explicit mode', () => {
        const { wb, ws, profile } = fixture();
        ws.addRow(['SYNTHETIC_FIRST', 50, 100, 'Продажа', '', 'SYNTHETIC_EXTRA']);
        expect(parseEnterprise(wb, profile).unresolved).toContainEqual({ sheet: 1, row: 1, column: 6 });
        expect(classifyEnterpriseHeader('SYNTHETIC_UNKNOWN')).toBeNull();
    });

    it.each(['А', 'П'])('does not invent an operation map for %s', operation => {
        const { wb, ws, profile } = fixture();
        ws.addRow(['SYNTHETIC_FIRST', 50, 100, operation]);
        const row = parseEnterprise(wb, profile).rows[0]!;
        expect(row.record.operationType).toBeUndefined();
        expect(row.errorCodes).toContain('MISSING_PROPERTY_KEY');
    });
});

describe('closed locale quantity syntax', () => {
    it.each([
        ['25000 руб./мес.', '25000'], ['1 200 руб/м2/мес', '1200'], ['50 м²', '50'],
        ['1,5 млн руб', '1500000'], ['9007199254740,91 руб.', '9007199254740.91'],
        ['0,125 тыс.', '125'], ['1\u202f200 руб/м²/год', '1200'],
    ])('parses %s exactly', (input, expected) => expect(parseWorkbookNumber(input)).toBe(expected));

    it.each(['25 000–30 000 руб./мес.', 'от 25000 до 30000 руб.', '50 м² + 20 м²', '50 м² 20 м²', '50/20 м²', '1,5–2 млн руб', '1,001', '12 34 руб', '100 USD'])('does not guess %s', input => expect(parseWorkbookNumber(input)).toBeNull());

    it('retains ambiguous quantities as invalid rows rather than silently guessing', () => {
        const { wb, ws, profile } = fixture();
        ws.addRow(['SYNTHETIC_FIRST', '50 м² 20 м²', '25 000–30 000 руб.', 'Продажа']);
        const row = parseEnterprise(wb, profile).rows[0]!;
        expect(row.record).toMatchObject({ area: null, price: null });
        expect(row.validationStatus).toBe('invalid');
        expect(row.errorCodes).toEqual(expect.arrayContaining(['INVALID_AREA', 'INVALID_PRICE']));
    });
});
