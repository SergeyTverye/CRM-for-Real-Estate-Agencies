import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { buildProfile, loadEnterprise, parseEnterprise, parseWorkbookNumber } from '@/modules/import/domain/enterprise-workbook';
import { parseNumber } from '@/modules/import/domain/normalize';
const fixture = () => readFile('tests/fixtures/synthetic/enterprise-workbook.xlsx');
describe('enterprise workbook v2 synthetic', () => {
    it('all structural features and normalized keys', async () => {
        const wb = await loadEnterprise(await fixture());
        expect(wb.worksheets).toHaveLength(6);
        expect(wb.definedNames.model).toHaveLength(4);
        const ws = wb.worksheets[1]!;
        expect(ws.getImages()).toHaveLength(15);
        let links = 0;
        ws.eachRow(r => r.eachCell(c => { if (c.hyperlink)
            links++; }));
        expect(links).toBe(31);
        expect(wb.worksheets[4]!.getRow(17).getCell(3).value).toBe('Адрес');
        expect(wb.worksheets[4]!.model.merges).toHaveLength(1);
        const p = buildProfile(wb);
        const parsed = parseEnterprise(wb, p);
        expect(parsed.blocks.filter(b => b.sheet === 5)).toHaveLength(2);
        expect(parsed.unresolved.length).toBeGreaterThan(0);
        expect(parsed.rows.filter(r => r.hidden)).toHaveLength(126);
        expect(parsed.rows.find(r => r.target === 'property')?.record).toMatchObject({ area: '45', price: '12000000', floor: 1, floorsTotal: 5, operationType: 'rent' });
        expect(JSON.stringify(parsed)).not.toContain('POLICY_SECRET');
        expect(parsed.rows.some(r => (r.record.contacts as unknown[])?.length === 4)).toBe(true);
        const keys = parsed.rows.map(r => r.recordKey);
        const wb2 = await loadEnterprise(Buffer.from(await wb.xlsx.writeBuffer()));
        expect(parseEnterprise(wb2, p).rows.map(r => r.recordKey)).toEqual(keys);
    });
    it('hidden skip/archive, unresolved acknowledgement, section context', async () => {
        const wb = await loadEnterprise(await fixture()), p = buildProfile(wb);
        for (const s of p.sheets) {
            s.hiddenRows = 'archive';
            s.defaults.priceUnit = 'rub_month';
            for (const k of Object.keys(s.columns))
                if (s.columns[k] === null)
                    s.columns[k] = 'ignore';
        }
        const r = parseEnterprise(wb, p);
        expect(r.unresolved).toHaveLength(0);
        expect(r.rows.some(r => r.hidden && r.record.status === 'archived' && r.validationStatus === 'warning')).toBe(true);
        expect(r.rows.some(r => r.record.operationType === 'sale')).toBe(true);
    });
    it('corrupt workbook gives safe error', async () => { await expect(loadEnterprise(Buffer.from('SYNTHETIC BROKEN'))).rejects.toThrow('INVALID_WORKBOOK'); });
    it('safe exact decimal, invalid dates and policy remapping cannot bypass exclusion', async () => {
        expect(parseWorkbookNumber('9007199254740,91 руб.')).toBe('9007199254740.91');
        expect(parseWorkbookNumber('0,125 тыс.')).toBe('125');
        expect(parseWorkbookNumber('1,001')).toBeNull();
        const wb = await loadEnterprise(await fixture()), p = buildProfile(wb);
        p.sheets[3]!.columns['паспорт'] = 'comment';
        wb.worksheets[3]!.getRow(3).getCell(5).value = '31.02.2026';
        const r = parseEnterprise(wb, p);
        expect(r.rows.some(r => r.errorCodes.includes('INVALID_DATE'))).toBe(true);
        expect(JSON.stringify(r)).not.toContain('POLICY_SECRET');
    });
    it('numeric strings', () => { expect(parseNumber('12 000 000 руб.')).toBe('12000000'); expect(parseNumber('1,5 млн')).toBe('1500000'); expect(parseNumber('45 м2')).toBe('45'); });
});
