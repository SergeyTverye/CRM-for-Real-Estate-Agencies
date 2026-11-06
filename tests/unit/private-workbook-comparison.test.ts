import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildProfile, loadEnterprise, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';
import { compareWorkbook } from '../../scripts/private-import/compare-workbook';

it('private comparison detects changed structure, key, date, money and format without returning values', async () => {
  const bytes = await readFile('tests/fixtures/synthetic/enterprise-workbook.xlsx');
  const before = await loadEnterprise(bytes), after = await loadEnterprise(bytes);
  const profile = buildProfile(before);
  const parsed = parseEnterprise(before, profile);
  const imported = new Set(parsed.rows.map(r => `${r.sheetIndex}:${r.rowNumber}`));
  const identical = compareWorkbook(before, after, profile, imported);
  expect(Object.values(identical).every(c => c.mismatched === 0)).toBe(true);
  const property = parsed.rows.find(r => r.target === 'property')!;
  const client = parsed.rows.find(r => r.target === 'client_request_need')!;
  const cell = (row: typeof property, field: string) => after.worksheets[row.sheetIndex - 1]!.getCell(row.rowNumber, row.columns.find(c => c.field === field)!.column);
  cell(property, 'addressText').value = 'PRIVATE_SYNTHETIC_CHANGED';
  cell(property, 'price').value = 987654.32;
  cell(property, 'price').numFmt = 'PRIVATE_FORMAT';
  cell(client, 'receivedDate').value = new Date('2031-05-09T00:00:00Z');
  after.worksheets[0]!.getColumn(3).width = 99;
  after.worksheets[0]!.views = [];
  after.worksheets[0]!.autoFilter = 'A1:B2';
  after.worksheets[0]!.name = 'PRIVATE_SHEET';
  const compared = compareWorkbook(before, after, profile, imported);
  for (const key of ['sheets', 'widths', 'filters', 'freeze', 'key_fields', 'row_keys', 'dates', 'money', 'number_formats']) expect(compared[key]!.mismatched, key).toBeGreaterThan(0);
  expect(JSON.stringify(compared)).not.toContain('PRIVATE');
});
