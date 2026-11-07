import { isDeepStrictEqual } from 'node:util';
import type ExcelJS from 'exceljs';
import { parseEnterprise, type EnterpriseProfile } from '../../src/modules/import/domain/enterprise-workbook';

type Counter = { matched: number; mismatched: number };
/** Values, sheet names, headers and format strings never leave this function. */
export function compareWorkbook(before: ExcelJS.Workbook, after: ExcelJS.Workbook, profile: EnterpriseProfile, imported: Set<string>) {
  const counters: Record<string, Counter> = {};
  const check = (type: string, a: unknown, b: unknown) => {
    const c = counters[type] ??= { matched: 0, mismatched: 0 };
    c[isDeepStrictEqual(a, b) ? 'matched' : 'mismatched']++;
  };
  check('sheets', before.worksheets.map(s => [s.name, s.state]), after.worksheets.map(s => [s.name, s.state]));
  check('defined_names', before.definedNames.model, after.definedNames.model);
  const original = parseEnterprise(before, profile), exported = parseEnterprise(after, profile);
  check('sections', original.sectionMarkers, exported.sectionMarkers);
  check('column_order', original.blocks, exported.blocks);
  for (const [i, sheet] of before.worksheets.entries()) {
    const next = after.worksheets[i];
    const columnWidths = (ws: ExcelJS.Worksheet) => (ws.columns ?? []).map(c => c.width);
    const beforeWidths = columnWidths(sheet), afterWidths = next ? columnWidths(next) : undefined;
    check('widths', beforeWidths, afterWidths);
    if (afterWidths && !isDeepStrictEqual(beforeWidths, afterWidths)) {
      // Preserve a numeric diagnostic for a completely blank/formatted sheet.
      counters[`widths_sheet_${i + 1}_before_count`] = { matched: beforeWidths.length, mismatched: 0 };
      counters[`widths_sheet_${i + 1}_after_count`] = { matched: afterWidths.length, mismatched: 0 };
    }
    check('filters', sheet.autoFilter, next?.autoFilter);
    check('freeze', sheet.views, next?.views);
    check('merges', [...(sheet.model.merges ?? [])].sort(), next ? [...(next.model.merges ?? [])].sort() : undefined);
    const structural = new Set([
      ...original.blocks.filter(b => b.sheet === i + 1).flatMap(b => Array.from({ length: b.endRow - b.row + 1 }, (_, j) => b.row + j)),
      ...original.sectionMarkers.filter(b => b.sheet === i + 1).map(b => b.row),
    ]);
    sheet.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
      check('number_formats', cell.numFmt ?? 'General', next?.getCell(rn, cn).numFmt ?? 'General');
      if (structural.has(rn)) check('headers_sections', cell.value, next?.getCell(rn, cn).value);
    }));
  }
  const byCoordinate = new Map(exported.rows.map(r => [`${r.sheetIndex}:${r.rowNumber}`, r]));
  const recordField = (field: string) => field === 'agreementPresence' ? 'agreementPresent' : field;
  const hasColumn = (row: typeof original.rows[number], field: string) => row.columns.some(c => c.field === field);
  for (const row of original.rows) {
    const coordinate = `${row.sheetIndex}:${row.rowNumber}`;
    if (!imported.has(coordinate)) continue;
    const next = byCoordinate.get(coordinate);
    check('row_keys', row.recordKey, next?.recordKey);
    const keys = row.target === 'property' || row.target === 'property_agreement_control'
      ? ['addressText', 'area', 'operationType']
      : row.target === 'historical_deal_archive' ? ['addressText', 'area', 'sourceRowId', 'contractRef', 'name'] : ['name'];
    for (const key of keys) check('key_fields', row.record[key], next?.record[key]);
    if (row.target === 'client_request_need') check('contacts', row.record.contacts, next?.record.contacts);
    if (hasColumn(row, 'receivedDate')) check('dates', row.record.receivedAt, next?.record.receivedAt);
    for (const key of ['price', 'commissionAmount']) {
      if (hasColumn(row, key)) check('money', row.record[key], next?.record[key]);
    }
    if (row.target === 'property_agreement_control') {
      const controlData: Array<[string, string]> = [
        ['control_presence', 'agreementPresence'],
        ['control_absence', 'absenceReason'],
        ['control_range', 'commissionFrom'],
        ['control_range', 'commissionTo'],
        ['control_scalar', 'commissionAmount'],
        ['control_scalar', 'fixNote'],
        ['control_advertising', 'adText'],
        ['control_advertising', 'adUrl'],
        ['control_advertising', 'adPlatform'],
        ['control_advertising', 'adStatus'],
        ['control_task', 'taskText'],
      ];
      for (const [counter, field] of controlData) {
        if (!hasColumn(row, field)) continue;
        const key = recordField(field);
        check(counter, row.record[key], next?.record[key]);
      }
    }
  }
  return counters;
}
