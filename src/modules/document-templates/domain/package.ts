import { Unzip, UnzipInflate, zipSync, strFromU8 } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { fail, LIMITS } from "./manifest";

export function readPackage(data: Buffer): Record<string, Uint8Array> {
  if (data.length > LIMITS.input) fail("Файл превышает 5 МБ");
  const files: Record<string, Uint8Array> = Object.create(null);
  let total = 0, count = 0;
  const unzip = new Unzip(file => {
    if (++count > 500 || /(^\/|\\|(^|\/)\.\.(\/|$)|:)/.test(file.name)) fail("Недопустимый путь внутри файла");
    if (Object.hasOwn(files, file.name)) fail("Повтор имени внутри архива");
    files[file.name] = new Uint8Array();
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) fail("Повреждённый ZIP");
      total += chunk.length; if (total > LIMITS.expanded) fail("Распакованный файл превышает 20 МБ");
      chunks.push(chunk);
      if (final) { const value = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let offset = 0; for (const c of chunks) { value.set(c, offset); offset += c.length; } files[file.name] = value; }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try { unzip.push(data, true); } catch { fail("Небезопасный или повреждённый ZIP-пакет"); }
  if (!count || !files["[Content_Types].xml"]) fail("Требуется DOCX или XLSX");
  for (const [name, bytes] of Object.entries(files)) {
    if (/vba|activex|embeddings|externallinks|customui|oleobject/i.test(name)) fail("Макросы, ActiveX, вложения и внешние связи запрещены");
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = strFromU8(bytes);
      const doc = parseXml(xml);
      for (const node of Array.from(doc.getElementsByTagName("*"))) {
        if (node.localName === "Relationship" && (node.getAttribute("TargetMode") ?? "").toLowerCase() === "external") fail("Внешние связи запрещены");
        const target = node.getAttribute("Target") ?? "";
        if (/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(target)) fail("Пути файловой системы запрещены");
      }
      if (/<\?xml-stylesheet/i.test(xml)) fail("Внешние стили XML запрещены");
      const instructions = [...Array.from(doc.getElementsByTagName("w:instrText")).map(n => n.textContent ?? ""), ...Array.from(doc.getElementsByTagName("w:fldSimple")).map(n => n.getAttribute("w:instr") ?? "")].join("");
      if (/HYPERLINK|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK|DATABASE|file:|\\/i.test(instructions)) fail("Внешние ссылки и активные поля запрещены");
      if (/TargetMode\s*=\s*["']external["']|macroEnabled|oleObject|attachedTemplate|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|altChunk|file:\/\/|[A-Z]:\\/i.test(xml)) fail("Внешние ссылки и активное содержимое запрещены");
    }
  }
  return files;
}
export function parseXml(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("DTD и XML-сущности запрещены");
  try { return new DOMParser({ onError: () => { throw new Error("XML"); } }).parseFromString(xml, "application/xml"); }
  catch { fail("Повреждённый XML"); }
}
export const serializeXml = (node: Parameters<XMLSerializer["serializeToString"]>[0]) => new XMLSerializer().serializeToString(node);
export const writePackage = (files: Record<string, Uint8Array>) => Buffer.from(zipSync(files));
