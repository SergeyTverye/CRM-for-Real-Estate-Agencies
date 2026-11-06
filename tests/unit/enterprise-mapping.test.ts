import ExcelJS from 'exceljs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProfile, classifyEnterpriseHeader, detectEnterpriseHeaders, loadEnterprise, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';

const run = promisify(execFile);
function property(wb: ExcelJS.Workbook, name = 'SYNTHETIC_PROPERTY') {
    const ws = wb.addWorksheet(name);
    ws.addRow(['Адрес объекта', 'Общая площадь, кв. м.', 'Цена, руб./м²/мес.', 'Аренда / продажа', 'НЕИЗВЕСТНО']);
    ws.addRow(['SYNTHETIC_ADDRESS', '45 м²', { formula: '1+1', result: 12000 }, 'Продажа', 'SYNTHETIC_UNKNOWN']);
    return ws;
}
describe('enterprise mapping: synthetic structural diversity', () => {
    it.each([
        ['Общая\nплощадь (м²)', 'area'], ['ПЛОЩАДЬ, М2', 'area'], ['Цена, руб./м²/мес.', 'price'],
        ['Арендная ставка (руб./кв. м./год)', 'price'], ['Тел.', 'phone'], ['Ф.И.О. клиента', 'name'],
        ['Эл. почта', 'email'], ['№ п/п', 'sourceRowId'], ['Площадь (сотки)', null],
        ['Стоимость (тыс. руб.)', null], ['Координаты', null], ['Дата рождения', null],
    ])('closed header alias %s', (label, expected) => expect(classifyEnterpriseHeader(label)).toBe(expected));

    it('classifies reordered sheets by evidence, never ordinal or values', () => {
        const wb = new ExcelJS.Workbook();
        const unknown = wb.addWorksheet('SYNTHETIC_UNKNOWN');
        unknown.addRow(['Координаты', 'Данные', 'Архив']);
        unknown.addRow(['+7 (900) 000-00-01', '45 м²', 'Адрес']);
        const history = wb.addWorksheet('SYNTHETIC_HISTORY');
        history.addRow(['Адрес объекта', '№ договора', 'Сумма комиссии']);
        history.addRow(['SYNTHETIC_HISTORY_ADDRESS', 'SYN-1', '100 тыс.']);
        const client = wb.addWorksheet('SYNTHETIC_CLIENT');
        client.addRow(['ФИО клиента', 'Тел.', 'Потребность']);
        client.addRow(['SYNTHETIC_NAME', '+7 (900) 000-00-01', 'Аренда']);
        property(wb);
        const p = buildProfile(wb);
        expect(p.sheets.map(s => s.target)).toEqual([null, 'historical_deal_archive', 'client_request_need', 'property']);
        const parsed = parseEnterprise(wb, p);
        expect(parsed.rows.map(r => r.sheetIndex)).toEqual([2, 3, 4]);
        expect(parsed.unresolved.some(x => x.sheet === 1)).toBe(true);
        expect(parsed.rows[1]!.record).toMatchObject({ coordinatesRaw: '+7 (900) 000-00-01', coordinatesNormalized: '+79000000001' });
        expect(parsed.rows[2]!.record.price).toBe('12000');
        expect(parsed.rows[2]!.record.priceUnit).toBe('rub_m2_month');
    });

    it('mixed tables and repeated headers retain their own target and unknown columns', () => {
        const wb = new ExcelJS.Workbook(), ws = property(wb);
        ws.addRow([]);
        ws.addRow(['ФИО', 'Тел.', 'Запрос', 'Дата обращения']);
        ws.addRow(['SYNTHETIC_NAME', '+7 (900) 000-00-01', 'Купить', { formula: 'DATE(2026,1,1)', result: 46023 }]);
        ws.addRow(['ФИО', 'Тел.', 'Запрос', 'Дата обращения']);
        ws.addRow(['SYNTHETIC_NAME2', '+7 (900) 000-00-02', 'Аренда', new Date('2026-01-02T00:00:00Z')]);
        const p = buildProfile(wb), parsed = parseEnterprise(wb, p);
        expect(p.sheets[0]!.target).toBeNull();
        expect(parsed.rows.map(r => r.target)).toEqual(['property', 'client_request_need', 'client_request_need']);
        expect(parsed.blocks.map(b => b.row)).toEqual([1, 4, 6]);
        expect(parsed.rows[1]!.errorCodes).not.toContain('INVALID_DATE');
        expect(parsed.unresolved).toEqual([{ sheet: 1, row: 1, column: 5 }]);
    });

    it('merged two-level header, offset, units, repeated blocks and excluded parent labels', async () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('SYNTHETIC_MERGED');
        ws.mergeCells('B2:B3'); ws.getCell('B2').value = 'Адрес объекта';
        ws.mergeCells('C2:C3'); ws.getCell('C2').value = 'Площадь (м²)';
        ws.mergeCells('D2:E2'); ws.getCell('D2').value = 'Собственник';
        ws.getCell('D3').value = 'ФИО'; ws.getCell('E3').value = 'Тел.';
        ws.mergeCells('F2:G2'); ws.getCell('F2').value = 'Паспорт';
        ws.getCell('F3').value = 'Номер'; ws.getCell('G3').value = 'Данные';
        ws.getRow(4).values = [null, 'SYNTHETIC_ADDRESS', 45, 'SYNTHETIC_OWNER', '+7 (900) 000-00-01', 'SYNTHETIC_POLICY_SECRET', 'SYNTHETIC_POLICY_SECRET'];
        const loaded = await loadEnterprise(Buffer.from(await wb.xlsx.writeBuffer()));
        const p = buildProfile(loaded); p.sheets[0]!.defaults.operationType = 'sale';
        const parsed = parseEnterprise(loaded, p);
        expect(parsed.blocks).toHaveLength(1);
        expect(parsed.blocks[0]).toMatchObject({ row: 2, endRow: 3 });
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0]!.record.owner).toEqual({ name: 'SYNTHETIC_OWNER', phone: '+79000000001' });
        expect(JSON.stringify(parsed)).not.toContain('SYNTHETIC_POLICY_SECRET');
        expect(parsed.unresolved).toEqual([]);
    });

    it('does not discard populated unlabeled columns, including beyond the header', () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('SYNTHETIC_SPARSE');
        ws.addRow(['Адрес', null, 'Площадь', 'Операция']);
        ws.addRow(['SYNTHETIC_ADDRESS', 'SYNTHETIC_UNLABELED', 45, 'Продажа', 'SYNTHETIC_TRAILING']);
        const p = buildProfile(wb), parsed = parseEnterprise(wb, p);
        expect(p.sheets[0]!.columns).toMatchObject({ '@1:2': null, '@1:5': null });
        expect(parsed.unresolved).toEqual([{ sheet: 1, row: 1, column: 2 }, { sheet: 1, row: 1, column: 5 }]);
        p.sheets[0]!.columns['@1:2'] = 'ignore'; p.sheets[0]!.columns['@1:5'] = 'ignore';
        expect(parseEnterprise(wb, p).unresolved).toEqual([]);
    });

    it('ambiguous later table stops previous mapping; no synthetic values are inferred', () => {
        const wb = new ExcelJS.Workbook(), ws = property(wb);
        ws.addRow([]);
        ws.addRow(['Координаты', 'Сведения', 'Что-то']).font = { bold: true };
        ws.addRow(['+7 (900) 000-00-01', 45, 'SYNTHETIC_AMBIGUOUS']);
        const p = buildProfile(wb), parsed = parseEnterprise(wb, p);
        expect(parsed.rows).toHaveLength(1);
        expect(p.sheets[0]!.blockTargets).toEqual({ '1': 'property', '4': null });
        expect(parsed.unresolved).toContainEqual({ sheet: 1, row: 4, column: 0 });
    });

    it('data rows with a few literal labels or bold data are not header candidates', () => {
        const wb = new ExcelJS.Workbook(), ws = property(wb);
        ws.addRow(['Адрес', 'SYNTHETIC_DATA', 'Цена', 'Аренда']);
        ws.addRow(['SYNTHETIC_BOLD', 45, 100, 'Продажа']).font = { bold: true };
        expect(detectEnterpriseHeaders(ws).map(h => h.row)).toEqual([1]);
    });

    it('explicit sheet/section indicators support incomplete headers without inferring data semantics', () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Архив сделок');
        ws.addRow(['Адрес объекта', 'Дата сделки']);
        ws.addRow(['SYNTHETIC_ADDRESS', new Date('2026-01-01T00:00:00Z')]);
        expect(buildProfile(wb).sheets[0]!.target).toBe('historical_deal_archive');
        ws.name = 'SYNTHETIC_AMBIGUOUS';
        expect(buildProfile(wb).sheets[0]!.target).toBeNull();
        ws.insertRow(1, ['Архив сделок']).font = { bold: true };
        expect(buildProfile(wb).sheets[0]!.target).toBe('historical_deal_archive');
    });

    it('multiple dates require explicit column selection, while repeated contact columns remain multivalued', () => {
        const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Synthetic dates');
        ws.addRow(['ФИО', 'Тел.', 'Запрос', 'Дата обращения', 'Дата сделки']);
        ws.addRow(['SYNTHETIC_CLIENT', '+7 (900) 000-00-01', 'Купить', new Date('2026-01-01'), new Date('2026-01-02')]);
        const p = buildProfile(wb);
        expect(p.sheets[0]!.columns).toMatchObject({ '@1:4': null, '@1:5': null });
        expect(parseEnterprise(wb, p).unresolved).toEqual([{ sheet: 1, row: 1, column: 4 }, { sheet: 1, row: 1, column: 5 }]);
        p.sheets[0]!.columns['@1:4'] = 'receivedDate'; p.sheets[0]!.columns['@1:5'] = 'ignore';
        expect(parseEnterprise(wb, p).unresolved).toEqual([]);
        expect(parseEnterprise(wb, p).rows[0]!.record.receivedAt).toEqual(new Date('2026-01-01'));
    });

    it('public diagnostic CLI resolves source module on Windows and prints only allowlisted leaves', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'crm-synthetic-mapping-'));
        try {
            const wb = new ExcelJS.Workbook(); property(wb, 'SYNTHETIC_PRIVATE_SHEET');
            const path = join(dir, 'synthetic.xlsx'); await wb.xlsx.writeFile(path);
            const result = await run(process.execPath, [resolve('scripts/private-import/build-profile.mjs'), path, '--diagnostic'], { timeout: 30000 });
            expect(result.stderr).toBe('');
            expect(result.stdout.trim().split('\n')).toHaveLength(1);
            const report = JSON.parse(result.stdout);
            const values = (v: unknown): boolean => typeof v === 'number' || (typeof v === 'string' && /^(?:TARGET_(?:PROPERTY|CLIENT|HISTORY|UNRESOLVED)|FIELD_(?:ADDRESS_TEXT|AREA|PRICE|OPERATION_TEXT|UNRESOLVED))$/.test(v)) || (v !== null && typeof v === 'object' && Object.values(v).every(values));
            expect(values(report)).toBe(true);
            expect(result.stdout).not.toMatch(/SYNTHETIC|Цена|площадь|Адрес/);
            expect(report.sheets[0]).toMatchObject({ code: 'TARGET_PROPERTY', recognized: 1 });
        } finally { await rm(dir, { recursive: true, force: true }); }
    }, 35000);
});
