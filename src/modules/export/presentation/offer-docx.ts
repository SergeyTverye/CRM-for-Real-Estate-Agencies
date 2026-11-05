import { AlignmentType, ExternalHyperlink, ImageRun, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";
import { BorderStyle } from "docx";
import type { OfferPrintData, PrintImage } from "@/modules/commercial-offers/application/offer-print-data";

const paragraph = (text: string, bold = false) => new Paragraph({ spacing: { after: 100 }, children: text.split("\n").map((line, index) => new TextRun({ text: line, bold, ...(index ? { break: 1 } : {}) })) });
const border = { style: BorderStyle.SINGLE, size: 4, color: "D9E1E8" };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const borders = { top: noBorder, bottom: border, left: noBorder, right: noBorder, insideHorizontal: border, insideVertical: noBorder };
function cell(text: string, header = false) {
  return new TableCell({ shading: header ? { fill: "EEF2F6" } : undefined,
    margins: { top: 90, bottom: 90, left: 100, right: 100 }, children: [paragraph(text, header)] });
}
function table(rows: string[][], header = false, widths?: number[]) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, borders,
    columnWidths: widths, rows: rows.map((row, index) => new TableRow({ cantSplit: true, tableHeader: header && index === 0,
      children: row.map((value, column) => cell(value, header ? index === 0 : column === 0)) })) });
}
function photo(p: PrintImage, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / p.width, maxHeight / p.height);
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new ImageRun({
    type: "png", data: Buffer.from(p.dataUrl.split(",")[1]!, "base64"),
    transformation: { width: Math.round(p.width * scale), height: Math.round(p.height * scale) },
    altText: { title: p.caption, description: p.caption, name: p.caption },
  })] });
}
const heading = (text: string, pageBreakBefore = false) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, pageBreakBefore, keepNext: true });
const link = (url: string, title: string) => new Paragraph({ children: [new TextRun(`${title}: `), new ExternalHyperlink({ link: url, children: [new TextRun({ text: url, style: "Hyperlink" })] })] });

export async function offerDocx(data: OfferPrintData): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    ...(data.logo ? [photo(data.logo, 115, 65)] : []),
    paragraph(data.issuer?.displayName ?? "Агентство недвижимости", true),
    ...(data.issuer?.requisites ? [paragraph(data.issuer.requisites)] : []),
    paragraph(`Подборка недвижимости · ${data.date}`), heading(data.title),
    ...data.intro.split("\n").map(line => paragraph(line)),
    paragraph(`Объектов в предложении: ${data.items.length} · Ответственный: ${data.responsible}`),

  ];
  children.push(heading("Сравнение объектов"), new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, borders,
    columnWidths: [1400, 2600, 1500, 1200, 1700, 1690],
    rows: [new TableRow({ cantSplit: true, tableHeader: true,
      children: ["Фото / №", "Адрес / район", "Назначение", "Площадь / этаж", "Цена / ставка", "Цена за м²"].map(t => cell(t, true)) }),
      ...data.items.map(i => new TableRow({ cantSplit: true, children: [
        new TableCell({ children: [...(i.images[0] ? [photo(i.images[0], 75, 65)] : [paragraph("Без фото")]), paragraph(`№ ${i.position}`)] }),
        ...[[i.address, i.district].join("\n"), i.purpose, `${i.area}\nЭтаж: ${i.floor}`, i.price, i.perM2].map(t => cell(t)),
      ] })),
    ],
  }));
  if (data.expires) children.push(paragraph(`Предложение действительно до ${data.expires}.`));
  children.push(new Paragraph({ text: "Ваш ответственный специалист", heading: HeadingLevel.HEADING_2 }), paragraph(data.responsible, true));
  if (data.issuer?.requisites) children.push(paragraph(data.issuer.requisites));
  children.push(paragraph("Цена, адрес, площадь и условия зафиксированы в предложении. Фотографии взяты из доступного каталога CRM; материалы внешних площадок доступны по ссылке на первоисточник."));
  for (const i of data.items) {
    children.push(heading(`${i.position}. ${i.address}`, true));
    const [hero, ...extra] = i.images;
    if (hero) children.push(photo(hero, 650, 250), paragraph(hero.caption));
    else children.push(paragraph("Фотографии в каталоге не добавлены."));
    if (extra.length) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED,
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
      columnWidths: extra.map(() => Math.floor(10090 / extra.length)),
      rows: [new TableRow({ cantSplit: true, children: extra.map(p => new TableCell({ children: [photo(p, 205, 100), paragraph(p.caption)] })) })] }));
    children.push(table([["Адрес", i.address], ["Район", i.district], ["Назначение", i.purpose], ["Площадь", i.area], ["Этаж", i.floor], ["Цена / ставка", i.price], ["Цена за м²", i.perM2]], false, [3300, 6790]));
    if (i.terms) children.push(new Paragraph({ text: "Условия", heading: HeadingLevel.HEADING_2 }), ...i.terms.split("\n").map(line => paragraph(line)));
    if (i.comment) children.push(new Paragraph({ text: "Примечания", heading: HeadingLevel.HEADING_2 }), ...i.comment.split("\n").map(line => paragraph(line)));
    children.push(link(i.propertyUrl, "Карточка CRM"));
    if (i.sourceUrl) children.push(link(i.sourceUrl, "Первоисточник"));
  }
  const doc = new Document({ creator: data.issuer?.displayName ?? "CRM", title: data.title,
    styles: { default: { document: { run: { font: "Arial", size: 20, color: "172B3E" }, paragraph: { spacing: { after: 100, line: 260 } } },
      heading1: { run: { font: "Arial", size: 34, color: "172B3E", bold: true }, paragraph: { spacing: { before: 100, after: 220 }, keepNext: true } },
      heading2: { run: { font: "Arial", size: 23, color: "233E55", bold: true }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 907, left: 907, right: 907 } } }, children }],
  });
  return Packer.toBuffer(doc);
}
