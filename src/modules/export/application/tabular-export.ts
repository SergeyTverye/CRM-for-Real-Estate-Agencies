import ExcelJS from "exceljs";
import { ConflictError } from "@/shared/errors";

export const TABULAR_EXPORT_LIMIT = 10000;
export function escapeSpreadsheet(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  return /^[\s\p{Cf}\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text) ? `'${text}` : text;
}
export function csvCell(value: unknown): string { return `"${escapeSpreadsheet(value).replaceAll('"', '""')}"`; }

/** Values remain strings in XLSX, including URLs; never create formulas or external relationships. */
export async function tabularExport(format: "csv" | "xlsx", columns: readonly string[], rows: readonly (readonly unknown[])[], sheetName = "Экспорт") {
  if (rows.length > TABULAR_EXPORT_LIMIT) throw new ConflictError("EXPORT_LIMIT", "Не более 10000 строк. Уточните фильтры.");
  if (format === "csv") return new TextEncoder().encode("\uFEFF" + [columns, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n"));
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(columns.map(escapeSpreadsheet));
  for (const row of rows) sheet.addRow(row.map(escapeSpreadsheet));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
