import ExcelJS from "exceljs";
import { ConflictError } from "@/shared/errors";

export const TABULAR_EXPORT_LIMIT = 10000;
export function escapeSpreadsheet(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  return /^[\s\p{Cf}\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text) ? `'${text}` : text;
}
export function csvCell(value: unknown): string { return `"${escapeSpreadsheet(value).replaceAll('"', '""')}"`; }

export type ExportColumnType = "text" | "date" | "number" | "money" | "url";
const EXPORT_TIMEZONE = "Asia/Novosibirsk";
export function formatExportDate(value: unknown): string {
  const date = exportDate(value);
  if (!date) return "Дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: EXPORT_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(",", "");
}
function exportDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(value) ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/u.test(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && String(value).replace(/\D/gu, "").length <= 15 ? number : null;
}
function csvValue(value: unknown, type?: ExportColumnType): unknown {
  if (type === "date") return formatExportDate(value);
  if (type === "number" || type === "money") {
    const number = numericValue(value);
    if (number !== null) return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: type === "money" }).format(number).replaceAll("\u00a0", " ") + (type === "money" ? " ₽" : "");
  }
  return value;
}
export async function tabularExport(format: "csv" | "xlsx", columns: readonly string[], rows: readonly (readonly unknown[])[], sheetName = "Экспорт", types: readonly ExportColumnType[] = []) {
  if (rows.length > TABULAR_EXPORT_LIMIT) throw new ConflictError("EXPORT_LIMIT", "Не более 10000 строк. Уточните фильтры.");
  if (format === "csv") return new TextEncoder().encode("\uFEFF" + [columns.map(csvCell).join(";"), ...rows.map(row => row.map((value, index) => csvCell(csvValue(value, types[index]))).join(";"))].join("\r\n"));
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(columns.map(escapeSpreadsheet));
  for (const row of rows) {
    const added = sheet.addRow(row.map((value, index) => {
      const type = types[index];
      if (type === "date") {
        const date = exportDate(value);
        return date ? new Date(date.getTime() + 7 * 3600000) : "Дата неизвестна";
      }
      if ((type === "number" || type === "money") && numericValue(value) !== null) return numericValue(value);
      if (type === "url" && typeof value === "string") {
        try { const url = new URL(value); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return { text: value, hyperlink: url.href }; } catch {  }
      }
      return escapeSpreadsheet(value);
    }));
    let lines = 1;
    added.eachCell((cell, index) => {
      const width = columnWidth(columns[index - 1]!, types[index - 1]);
      lines = Math.max(lines, ...cell.text.split("\n").map(line => Math.ceil(Math.max(1, line.length) / (width - 2))));
      if (cell.type === ExcelJS.ValueType.Date) cell.numFmt = "dd.mm.yyyy hh:mm";
      else if (typeof cell.value === "number") cell.numFmt = types[index - 1] === "money" ? '[$-419]#,##0.00 "₽"' : '[$-419]0.00';
      if (cell.hyperlink) cell.font = { name: "Calibri", size: 11, color: { argb: "FF0563C1" }, underline: true };
    });
    added.height = Math.min(409, Math.max(32, lines * 15 + 8));
  }
  sheet.columns.forEach((column, index) => { column.width = columnWidth(columns[index]!, types[index]); column.alignment = { vertical: "top", wrapText: true, indent: 1 }; });
  const header = sheet.getRow(1); header.height = 46;
  header.eachCell(cell => { cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } }; });
  types.forEach((type, index) => { if (type === "date") sheet.getCell(1, index + 1).note = "Часовой пояс: Asia/Novosibirsk (UTC+07). Неизвестная дата остаётся текстом."; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function columnWidth(label: string, type?: ExportColumnType): number {
  if (type === "url" || /ссылк|примечан|адрес|неизвестн/iu.test(label)) return 46;
  if (type === "date") return 24;
  if (type === "number" || type === "money") return 20;
  return Math.min(38, Math.max(22, label.length + 3));
}
