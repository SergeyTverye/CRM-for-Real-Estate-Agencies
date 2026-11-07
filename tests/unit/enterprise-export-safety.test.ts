import { describe, expect, it } from 'vitest';
import { evaluateExportFormula, safeExportUrl } from '@/modules/import/application/enterprise-export-safety';

describe('bounded synthetic export semantics', () => {
    const cells = new Map([['B2', 20], ['B3', 30]]);
    it.each([['SUM(B2:B3)*2', 100], ['($B$2+B3)/2-1', 24], ['-B2+30', 10], ['SUM(B2,B3,2)', 52]])('evaluates %s locally', (formula, expected) => {
        expect(evaluateExportFormula(String(formula), cells)).toBe(expected);
    });
    it.each(['[book.xlsx]Sheet1!B2', "cmd|' /C calc'!A1", 'WEBSERVICE(1)', 'HYPERLINK(1)', 'INDIRECT(B2)', 'Table1[price]', 'MyUdf(B2)', 'Sheet2!B2', 'SUM(B2:B999999)', 'B9+1', '1/0', 'SUM()', '2^3', 'B2&1', 'ſUM(B2)', 'B2\u00a0+1'])('rejects %s', formula => {
        expect(() => evaluateExportFormula(formula, cells)).toThrow();
    });
    it.each(['https://example.invalid/a', 'http://example.invalid/a'])('accepts closed URL protocol %s', url => expect(safeExportUrl(url)).toBe(url));
    it.each(['file:///synthetic', 'javascript:alert(1)', 'https://user:pass@example.invalid', 'https://example.invalid\\evil', '//example.invalid', 'https://example.invalid/\n'])('rejects unsafe URL %s', url => expect(safeExportUrl(url)).toBeNull());
});
