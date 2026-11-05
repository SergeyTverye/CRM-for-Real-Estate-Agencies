import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { escapeSpreadsheet as templateEscape } from "@/modules/document-templates/domain/engine";
import { escapeSpreadsheet, tabularExport } from "@/modules/export/application/tabular-export";
const prefixes = ["", " ", "\u200b", "\u200c\u200d", "\ufeff", " \ufeff\u200b\t", "\u2060", "\u0000"];
describe("spreadsheet formula prefixes", () => {
  it.each(prefixes)("escapes hidden prefix %j for every formula operator", prefix => {
    for (const operator of ["=", "+", "-", "@"]) {
      const value = `${prefix}${operator}SUM(1)`;
      expect(templateEscape(value)).toBe(`'${value}`);
      expect(escapeSpreadsheet(value)).toBe(`'${value}`);
    }
  });
  it("preserves ordinary text and writes XLSX strings and CSV escaped cells", async () => {
    const values = ["https://onrealt.ru/1", "Офис 100 м²", "\u200b=1+1", "\ufeff +1"];
    expect(templateEscape(values[0]!)).toBe(values[0]);
    const bytes = await tabularExport("xlsx", ["Адрес"], values.map(v => [v]));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(bytes) as never);
    values.forEach((v, i) => {
      expect(book.worksheets[0]!.getCell(i + 2, 1).value).toBe(escapeSpreadsheet(v));
      expect(book.worksheets[0]!.getCell(i + 2, 1).type).toBe(ExcelJS.ValueType.String);
    });
    expect(new TextDecoder().decode(await tabularExport("csv", ["Адрес"], [[values[2]]]))).toContain("'\u200b=1+1");
  });
});
