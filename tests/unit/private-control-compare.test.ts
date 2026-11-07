import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { buildProfile, loadEnterprise, parseEnterprise } from '@/modules/import/domain/enterprise-workbook';
import { compareWorkbook } from '../../scripts/private-import/compare-workbook';

async function controlWorkbook(overrides: Record<string, unknown> = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Контроль');
  const headers = ['Адрес объекта', 'Площадь', 'Тип операции', 'Наличие договора', 'Причина отсутствия договора', 'Комиссия от', 'Комиссия до', 'Сумма комиссии', 'Что нужно исправить', 'Рекламный текст', 'Ссылка на рекламу', 'Рекламная площадка', 'Статус рекламы', 'Задача'];
  ws.addRow(headers);
  const values: Record<string, unknown> = {
    'Адрес объекта': 'ул. Синтетическая, 1',
    'Площадь': '120',
    'Тип операции': 'Аренда',
    'Наличие договора': 'Да',
    'Причина отсутствия договора': '',
    'Комиссия от': '10',
    'Комиссия до': '20',
    'Сумма комиссии': '15000',
    'Что нужно исправить': 'Проверить реквизиты',
    'Рекламный текст': 'Светлое помещение',
    'Ссылка на рекламу': 'https://example.test/listing/1',
    'Рекламная площадка': 'Авито',
    'Статус рекламы': 'Опубликовано',
    'Задача': 'Позвонить собственнику',
    ...overrides,
  };
  ws.addRow(headers.map(h => values[h] ?? ''));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

it('control comparison detects changed mapped control data and never returns excluded values', async () => {
  const bytes = await controlWorkbook();
  const before = await loadEnterprise(bytes);
  const profile = buildProfile(before);
  const parsed = parseEnterprise(before, profile);
  const control = parsed.rows.find(r => r.target === 'property_agreement_control');
  expect(control, 'synthetic workbook must produce a control row').toBeTruthy();
  const imported = new Set([`${control!.sheetIndex}:${control!.rowNumber}`]);
  const after = await loadEnterprise(bytes);

  const identical = compareWorkbook(before, after, profile, imported);
  expect(Object.values(identical).every(c => c.mismatched === 0)).toBe(true);

  const ws = after.worksheets[control!.sheetIndex - 1]!;
  const cell = (field: string) => ws.getCell(control!.rowNumber, control!.columns.find(c => c.field === field)!.column);
  cell('addressText').value = 'PRIVATE_ADDR_CHANGED';
  cell('agreementPresence').value = 'Нет';
  cell('absenceReason').value = 'PRIVATE_ABSENCE';
  cell('commissionFrom').value = '11';
  cell('commissionTo').value = '22';
  cell('commissionAmount').value = '16000';
  cell('fixNote').value = 'PRIVATE_FIX';
  cell('adText').value = 'PRIVATE_AD_TEXT';
  cell('adUrl').value = 'https://example.test/listing/2';
  cell('adPlatform').value = 'ЦИАН';
  cell('adStatus').value = 'Приостановлено';
  cell('taskText').value = 'PRIVATE_TASK';

  const compared = compareWorkbook(before, after, profile, imported);
  for (const key of ['row_keys', 'key_fields', 'control_presence', 'control_absence', 'control_range', 'control_scalar', 'control_advertising', 'control_task']) {
    expect(compared[key]?.mismatched ?? 0, key).toBeGreaterThan(0);
  }
  expect(JSON.stringify(compared)).not.toContain('PRIVATE');
  expect(JSON.stringify(compared)).not.toContain('Синтетическая');
  expect(JSON.stringify(compared)).not.toContain('Позвонить');
});

it('control comparison ignores unmapped control columns and excluded source cells', async () => {
  const base = await controlWorkbook();
  const wb = await loadEnterprise(base);
  const ws = wb.worksheets[0]!;
  ws.getCell(1, 15).value = 'Паспорт';
  ws.getCell(2, 15).value = 'EXCLUDED_SECRET_1234';
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const before = await loadEnterprise(bytes);
  const profile = buildProfile(before);
  const parsed = parseEnterprise(before, profile);
  const control = parsed.rows.find(r => r.target === 'property_agreement_control')!;
  const imported = new Set([`${control.sheetIndex}:${control.rowNumber}`]);
  const after = await loadEnterprise(bytes);
  after.worksheets[0]!.getCell(2, 15).value = 'EXCLUDED_SECRET_9999';

  const compared = compareWorkbook(before, after, profile, imported);
  expect(Object.values(compared).every(c => c.mismatched === 0)).toBe(true);
  expect(JSON.stringify(compared)).not.toContain('EXCLUDED_SECRET');
  expect(JSON.stringify(compared)).not.toContain('9999');
});
