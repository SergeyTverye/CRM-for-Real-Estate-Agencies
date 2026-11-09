import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import ExcelJS from "exceljs";
import { strFromU8, strToU8 } from "fflate";
import { escapeSpreadsheet, renderText, safeGet, type Context } from "./engine";
import { fail, LIMITS, type Manifest } from "./manifest";
import { parseXml, readPackage, serializeXml, writePackage } from "./package";

export const MIME = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
export async function markdownDocx(body: string, context: Context, m: Manifest, role: string) {
  const lines = renderText(body, context, m, role).split(/\r?\n/);
  const children: (Paragraph | Table)[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*\|/.test(line)) {
      const rows: TableRow[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        if (!/^\s*\|[\s:|\-]+\|\s*$/.test(lines[i]!)) rows.push(new TableRow({ tableHeader: !rows.length, children: lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map(text => new TableCell({ children: [new Paragraph(text.trim())], margins: { top: 100, bottom: 100, left: 120, right: 120 } })) }));
        i++;
      }
      i--; children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })); continue;
    }
    const heading = /^(#{1,3})\s+(.*)/.exec(line), bullet = /^\s*[-*]\s+(.*)/.exec(line), numbered = /^\s*\d+\.\s+(.*)/.exec(line);
    children.push(new Paragraph({ text: heading?.[2] ?? bullet?.[1] ?? numbered?.[1] ?? line, heading: heading ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1]!.length - 1] : undefined, bullet: bullet ? { level: 0 } : undefined, numbering: numbered ? { reference: "numbered", level: 0 } : undefined, spacing: { after: 160 } }));
  }
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: "Arial", size: 22, color: "000000" } }, heading1: { run: { color: "000000", bold: true, size: 32 } }, heading2: { run: { color: "000000", bold: true, size: 27 } }, heading3: { run: { color: "000000", bold: true, size: 24 } } } }, numbering: { config: [{ reference: "numbered", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }] }] }, sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }] }));
}

type XmlNode = ReturnType<typeof parseXml>["documentElement"];
const textNodes = (node: NonNullable<XmlNode>) => Array.from(node.getElementsByTagName("w:t"));
const plain = (node: NonNullable<XmlNode>) => textNodes(node).map(n => n.textContent ?? "").join("");
function replaceText(node: NonNullable<XmlNode>, transform: (value: string) => string) {
  const nodes = textNodes(node), text = nodes.map(n => n.textContent ?? "").join("");
  const spans = nodes.map(n => n.textContent ?? "");
  for (const match of [...text.matchAll(/{{[\s\S]*?}}/g)].reverse()) {
    let offset = 0; const start = match.index!, end = start + match[0].length;
    for (let i = 0; i < spans.length; i++) {
      const original = nodes[i]!.textContent ?? "", a = offset, b = offset + original.length; offset = b;
      if (start >= b || end <= a) continue;
      spans[i] = spans[i]!.slice(0, Math.max(0, start - a)) + (start >= a ? transform(match[0]) : "") + spans[i]!.slice(Math.min(original.length, end - a));
    }
  }
  nodes.forEach((n, i) => { n.textContent = spans[i]!; n.setAttribute("xml:space", "preserve"); });
}
export function fillDocx(data: Buffer, context: Context, m: Manifest, role: string): Buffer {
  const files = readPackage(data);
  if (!files["word/document.xml"]) fail("Это не DOCX");
  let operations = 0, expandedChars = 0;
  const render = (text: string, row?: Context) => row ? renderText(`{{#each properties}}${text}{{/each}}`, { ...context, properties: [row] }, m, role) : renderText(text, context, m, role);
  for (const name of Object.keys(files).filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))) {
    const doc = parseXml(strFromU8(files[name]!));
    function process(parent: NonNullable<XmlNode>, row?: Context) {
      for (let child = parent.firstChild; child;) {
        if (++operations > 50_000) fail("Превышен лимит XML-операций");
        const next = child.nextSibling;
        if (child.nodeType !== 1) { child = next; continue; }
        const el = child as NonNullable<XmlNode>, text = plain(el).trim();
        const block = /^{{#(each|if)\s+([\w.]+)}}$/.exec(text);
        if (block && ["w:p", "w:tr"].includes(el.nodeName)) {
          let close = next, depth = 1;
          while (close) { const t = close.nodeType === 1 ? plain(close as NonNullable<XmlNode>).trim() : ""; if (t.startsWith(`{{#${block[1]} `)) depth++; if (t === `{{/${block[1]}}}` && --depth === 0) break; close = close.nextSibling; }
          if (!close) fail("Незакрытый блок DOCX");
          const originals = []; for (let n = next; n && n !== close; n = n.nextSibling) originals.push(n);
          render(`{{#${block[1]} ${block[2]}}}{{/${block[1]}}}`, row);
          const values = block[1] === "each" ? context.properties as Context[] : safeGet(context, block[2]!) ? [row] : [];
          expandedChars += originals.reduce((size, n) => size + serializeXml(n).length, 0) * values.length;
          if (expandedChars > LIMITS.expanded) fail("Результат DOCX превышает лимит развёртывания");
          for (const value of values) for (const original of originals) { const copy = original.cloneNode(true); parent.insertBefore(copy, el); if (copy.nodeType === 1) { const wrapper = doc.createElement("wrapper"); wrapper.appendChild(copy); process(wrapper, block[1] === "each" ? value : row); while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, el); } }
          const after = close.nextSibling; for (const n of originals) parent.removeChild(n); parent.removeChild(close); parent.removeChild(el); child = after; continue;
        }
        if (el.nodeName === "w:tr" && text.includes("{{#each properties}}")) {
          if (!text.includes("{{/each}}")) fail("Цикл строки DOCX должен закрываться в той же строке");
          renderText(text, context, m, role);
          expandedChars += serializeXml(el).length * (context.properties as Context[]).length;
          if (expandedChars > LIMITS.expanded) fail("Результат DOCX превышает лимит развёртывания");
          for (const value of context.properties as Context[]) { const copy = el.cloneNode(true) as NonNullable<XmlNode>; replaceText(copy, t => /^{{#each properties}}$|^{{\/each}}$/.test(t) ? "" : t); const wrapper = doc.createElement("wrapper"); wrapper.appendChild(copy); process(wrapper, value); parent.insertBefore(copy, el); }
          parent.removeChild(el);
        } else if (el.nodeName === "w:p") {
          const combined = plain(el);
          if (/{{#|{{\//.test(combined)) { const output = render(combined, row); const nodes = textNodes(el); nodes.forEach((n, i) => { n.textContent = i ? "" : output; }); }
          else replaceText(el, t => render(t, row));
        } else process(el, row);
        child = next;
      }
    }
    process(doc.documentElement!); files[name] = strToU8(serializeXml(doc));
  }
  return writePackage(files);
}
function assertFormula(formula: string) {
  if (/\[|\]|https?:|file:|\\|\||\b(?:HYPERLINK|WEBSERVICE|FILTERXML|RTD|DDE|CALL|REGISTER)\s*\(/i.test(formula)) fail("Небезопасная формула Excel");
  const allowed = new Set(["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "ROUND", "ROUNDUP", "ROUNDDOWN", "IF", "AND", "OR", "NOT", "ABS", "COUNTIF", "SUMIF", "SUMIFS", "COUNTIFS", "IFERROR", "CONCAT", "CONCATENATE", "TEXT", "LEN", "LEFT", "RIGHT", "MID", "YEAR", "MONTH", "DAY", "DATE", "TODAY"]);
  const code = formula.replace(/"(?:[^"]|"")*"/g, '""');
  for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) if (!allowed.has(match[1]!.toUpperCase())) fail("Функция Excel не входит в поддерживаемый безопасный список");
}
function fillCell(cell: ExcelJS.Cell, text: string, context: Context, m: Manifest, role: string, item?: Context) {
  cell.style = structuredClone(cell.style);
  const output = item ? renderText(`{{#each properties}}${text}{{/each}}`, { ...context, properties: [item] }, m, role) : renderText(text, context, m, role);
  const exact = /^{{\s*([\w.]+)\s*}}$/.exec(text);
  if (exact) {
    const path = exact[1]!, canonical = path.startsWith("this.") ? `properties.${path.slice(5)}` : path;
    const field = m.fields.find(f => f.path === canonical);
    const value = path.startsWith("this.") ? safeGet(item, path.slice(5)) : safeGet(context, path);
    if (field && (field.type === "money" || field.type === "area") && value !== null && value !== undefined && /^\d+(\.\d+)?$/.test(String(value)) && String(value).replace(/\D/g, "").length <= 15) {
      cell.value = Number(value); cell.numFmt = field.type === "money" ? '#,##0.00 "₽"' : '0.## "м²"'; return;
    }
    if (field?.type === "date" && value) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Novosibirsk", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(String(value)));
      const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
      cell.value = new Date(Date.UTC(get("year"), get("month") - 1, get("day"))); cell.numFmt = "dd.mm.yyyy"; return;
    }
  }
  cell.value = escapeSpreadsheet(output);
}
export function shiftFormula(formula: string, delta: number): string {
  return formula.split(/("(?:[^"]|"")*")/g).map((piece, i) => i % 2 ? piece : piece.replace(/(?<![A-Za-z0-9_])\$?[A-Z]{1,3}(\$?)(\d+)(?![A-Za-z0-9_])/g, (ref, fixed: string, row: string) => fixed ? ref : ref.slice(0, -row.length) + (Number(row) + delta))).join("");
}
export async function fillXlsx(data: Buffer, context: Context, m: Manifest, role: string) {
  const files = readPackage(data); if (!files["xl/workbook.xml"]) fail("Это не XLSX");
  const workbookXml = parseXml(strFromU8(files["xl/workbook.xml"]!));
  for (const name of Array.from(workbookXml.getElementsByTagName("definedName"))) {
    const formula = name.textContent ?? "";
    if (/\(|\)|\||\[|\]|https?:|file:|\\/i.test(formula)) fail("Именованные диапазоны с вычислениями или внешними ссылками запрещены");
  }
  const book = new ExcelJS.Workbook(); await book.xlsx.load(data as never);
  let expandedChars = 0;
  for (const sheet of book.worksheets) {
    const filled = new Set<string>();
    if (sheet.rowCount > 5000 || sheet.columnCount > 100) fail("Слишком большой лист");
    for (let r = sheet.rowCount; r >= 1; r--) {
      const row = sheet.getRow(r), joined = row.values.toString();
      if (joined.includes("{{#each properties}}")) {
        if (!joined.includes("{{/each}}")) fail("Маркеры each должны находиться в одной строке XLSX");
        const values = context.properties; if (!Array.isArray(values) || values.length > LIMITS.iterations) fail("Слишком много строк");
        expandedChars += joined.length * values.length;
        if (expandedChars > LIMITS.expanded) fail("Результат XLSX превышает лимит развёртывания");
        if (!values.length) { sheet.spliceRows(r, 1); continue; }
        const formulas = new Map<number, string>(); row.eachCell((cell, col) => { if (cell.type === ExcelJS.ValueType.Formula) { assertFormula(cell.formula); formulas.set(col, cell.formula); } });
        sheet.duplicateRow(r, values.length - 1, true);
        for (let i = 0; i < values.length; i++) sheet.getRow(r + i).eachCell((cell, col) => {
          if (formulas.has(col)) cell.value = { formula: shiftFormula(formulas.get(col)!, i) };
          if (typeof cell.value === "string") { fillCell(cell, cell.value.replace(/{{#each properties}}|{{\/each}}/g, ""), context, m, role, values[i]); filled.add(cell.address); }
        });
      }
    }
    sheet.eachRow(row => row.eachCell(cell => {
      if (cell.type === ExcelJS.ValueType.Hyperlink) fail("Внешние ссылки запрещены");
      if (cell.type === ExcelJS.ValueType.Formula) { assertFormula(cell.formula); return; }
      if (filled.has(cell.address)) return;
      const names = cell.names;
      const binding = names.find(n => m.fields.some(f => f.path.replaceAll(".", "_") === n));
      if (binding) { const field = m.fields.find(f => f.path.replaceAll(".", "_") === binding)!; fillCell(cell, `{{${field.path}}}`, context, m, role); }
      else if (typeof cell.value === "string" && cell.value.includes("{{")) fillCell(cell, cell.value, context, m, role);
      else if (cell.type === ExcelJS.ValueType.RichText) { const text = cell.text; if (text.includes("{{")) fillCell(cell, text, context, m, role); }
    }));
  }
  book.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function registryXlsx(contexts: Context[], m: Manifest, role: string) {
  if (!m.columns?.length) fail("Для реестра задайте columns");
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Реестр");
  sheet.columns = m.columns.map(c => ({ header: c.title, width: c.width }));
  for (const ctx of contexts) { const row = sheet.addRow([]); m.columns.forEach((c, i) => fillCell(row.getCell(i + 1), `{{${c.path}}}`, ctx, m, role)); }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24445C" } };
  sheet.eachRow(row => { row.alignment = { vertical: "middle", wrapText: true }; row.height = 30; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: m.columns.length } };
  sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function renderDocument(format: string, body: string | null, data: Buffer | null, contexts: Context[], m: Manifest, role: string) {
  for (const c of contexts) renderText("", c, m, role);
  let result: Buffer;
  if (format === "markdown_docx") result = await markdownDocx(body ?? "", contexts[0]!, m, role);
  else if (format === "docx" && data) result = fillDocx(data, contexts[0]!, m, role);
  else if (format === "xlsx" && data) result = await fillXlsx(data, contexts[0]!, m, role);
  else if (format === "xlsx_registry") result = await registryXlsx(contexts, m, role);
  else fail("Формат или содержимое шаблона не поддерживается");
  if (result.length > LIMITS.expanded) fail("Сформированный файл слишком большой");
  return { data: result, extension: format.includes("xlsx") ? "xlsx" as const : "docx" as const };
}
