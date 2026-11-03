import ExcelJS from "exceljs";
import type { Cell } from "../domain/normalize";
import type { SheetData } from "../domain/workbook-parser";

/** Чтение XLSX в простые массивы значений (формулы → вычисленный результат, rich text → текст). */
export async function readWorkbook(data: Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const sheets: SheetData[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    const last = ws.actualRowCount ? ws.rowCount : 0;
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const values: Cell[] = [];
      const width = Math.max(row.cellCount, 0);
      for (let c = 1; c <= width; c++) values.push(toCell(row.getCell(c).value));
      rows.push(values);
    }
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

function toCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return toCell(v.result as ExcelJS.CellValue);
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("hyperlink" in v && typeof (v as { hyperlink: unknown }).hyperlink === "string") return (v as { hyperlink: string }).hyperlink;
  }
  return String(v);
}
