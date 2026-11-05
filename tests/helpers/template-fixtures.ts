import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from "docx";
import ExcelJS from "exceljs";
export const clientYaml = `schemaVersion: 1
entityKind: client
sources: [client, user]
fields:
  - path: client.displayName
    label: Клиент
    type: text
    required: true
  - path: user.displayName
    label: Сотрудник
    type: text
columns:
  - path: client.displayName
    title: Клиент
    width: 45
  - path: user.displayName
    title: Сотрудник
    width: 35
`;
export const collectionYaml = `schemaVersion: 1
entityKind: collection
sources: [collection, properties, user]
fields:
  - {path: collection.name, label: Подборка, type: text, required: true}
  - {path: properties.address, label: Адрес, type: text, required: true}
  - {path: properties.area, label: Площадь, type: area}
  - {path: properties.price, label: Цена, type: money}
`;
export async function docxFixture() {
  const cell = (text: string) => new TableCell({ children: [new Paragraph(text)] });
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: "Arial", size: 22 } }, heading1: { run: { color: "000000", size: 32, bold: true } } } }, sections: [{ children: [
    new Paragraph({ text: "Подборка помещений", heading: "Heading1" }),
    new Paragraph({ children: [new TextRun({ text: "Название: ", bold: true }), new TextRun({ text: "{{collection.", italics: true }), new TextRun({ text: "name}}", italics: true })] }),
    new Paragraph("{{#if collection.name}}"), new Paragraph("Сведения подготовлены для рассмотрения. Длинные адреса в таблице переносятся в пределах ячейки."), new Paragraph("{{/if}}"),
    new Table({ rows: [new TableRow({ tableHeader: true, children: [cell("Адрес"), cell("Площадь"), cell("Цена")] }), new TableRow({ children: [cell("{{#each properties}}{{this.address}}"), cell("{{this.area}}"), cell("{{this.price}}{{/each}}") ] })] }),
  ] }] }));
}
export async function xlsxFixture() {
  const b = new ExcelJS.Workbook(), s = b.addWorksheet("Подборка");
  s.columns = [{ width: 65 }, { width: 22 }, { width: 26 }, { width: 22 }];
  s.addRow(["{{collection.name}}"]).font = { bold: true, size: 16 };
  s.addRow(["Адрес", "Площадь", "Цена", "Цена за м²"]);
  s.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24445C" } }; s.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
  s.addRow(["{{#each properties}}{{this.address}}", "{{this.area}}", "{{this.price}}{{/each}}", { formula: "C3/B3", result: 0 }]);
  s.getRow(3).height = 45; s.getRow(3).alignment = { wrapText: true, vertical: "middle" };
  s.getCell("D3").numFmt = "#,##0.00";
  s.getCell("A1").name = "collection_name";
  s.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from(await b.xlsx.writeBuffer());
}
