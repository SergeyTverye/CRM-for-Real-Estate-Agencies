import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { load } from "cheerio";
import { unzipSync } from "fflate";
import { Parser } from "htmlparser2";
import type { Source } from "../domain/types";
import { manualListing, manualListingSchema } from "./manual-listing";
import { extractListingDates } from "./listing-dates";

export interface FeedImportResult {
  listings: ReturnType<typeof manualListing>[];
  
  pending: { source: Source; externalId: string | null; title: string; operation: "sale" | "rent"; propertyType: string | null; price: number | null; area: number | null; city: string | null; address: string | null; url: null; reason: "public_url_required" }[];
  errors: { row: number; code: "INVALID_FEED_ROW" }[];
  rowsRead: number; incomplete: boolean;
}

export async function importOfficialFeed(bytes: Buffer, options: { format: "csv" | "xlsx" | "xml"; source: Source; fetchedAt?: string; maxRows?: number }): Promise<FeedImportResult> {
  if (bytes.length > 10_000_000) throw new Error("FEED_TOO_LARGE");
  const limit = Math.min(options.maxRows ?? 1000, 5000);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("INVALID_FEED_LIMIT");
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const rows: Record<string, string>[] = [];
  if (options.format === "xml") {
    const xml = bytes.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error("UNSAFE_FEED_XML");
    
    let depth = 0, elements = 0;
    const guard = new Parser({ onopentag() { if (++depth > 32 || ++elements > 50000) throw new Error("FEED_XML_COMPLEXITY_LIMIT"); }, onclosetag() { depth--; } }, { xmlMode: true, decodeEntities: false });
    guard.end(xml);
    const $ = load(xml, { xmlMode: true });
    $("offer, Ad").slice(0, limit + 1).each((_, el) => {
      const row: Record<string, string> = {};
      
      for (const key of ["Id", "url", "Url", "AdUrl", "Title", "Description", "description", "type", "OperationType", "category", "commercial-type", "ObjectType", "CommercialType", "Area", "Square", "City", "Address", "Price", "creation-date", "last-update-date"]) row[key] = $(el).children(key).first().text().trim();
      row.externalId = $(el).attr("internal-id") ?? row.Id ?? "";
      row.price = $(el).children("price").children("value").text();
      row.area = $(el).children("area").children("value").text();
      row.city = $(el).children("location").children("locality-name").text();
      row.address = $(el).children("location").children("address").text();
      rows.push(row);
    });
  } else {
    const workbook = new ExcelJS.Workbook();
    if (options.format === "xlsx") {
      let expanded = 0, entries = 0;
      
      unzipSync(bytes, { filter: entry => { expanded += entry.originalSize; if (++entries > 2000 || expanded > 40_000_000) throw new Error("FEED_EXPANDED_TOO_LARGE"); return false; } });
      await workbook.xlsx.load(bytes as never);
    }
    else await workbook.csv.read(Readable.from(bytes.toString("utf8").replace(/^\uFEFF/u, "")), { parserOptions: { delimiter: bytes.toString("utf8").split(/\r?\n/u)[0]?.includes(";") ? ";" : "," } });
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("EMPTY_FEED");
    const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
    for (let i = 2; i <= Math.min(sheet.rowCount, limit + 2); i++) {
      const row: Record<string, string> = {};
      headers.forEach((h, column) => { if (column && typeof h === "string") row[h.trim()] = sheet.getRow(i).getCell(column).text; });
      rows.push(row);
    }
  }
  const result: FeedImportResult = { listings: [], pending: [], errors: [], rowsRead: Math.min(rows.length, limit), incomplete: rows.length > limit };
  rows.slice(0, limit).forEach((r, index) => {
    const get = (...keys: string[]) => keys.map(k => r[k]?.trim()).find(Boolean);
    const numeric = (...keys: string[]) => { const v = get(...keys); if (!v) return null; const n = Number(v.replace(/[\s\u00a0]/gu, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
    try {
      const operation = get("OperationType", "type", "operation", "Операция");
      if (!operation || !/^(?:аренда|сдам|продажа|продам|sale|rent)$/iu.test(operation)) throw new Error("INVALID_OPERATION");
      const type = get("CommercialType", "commercial-type", "ObjectType", "category", "propertyType", "Тип") ?? "";
      const propertyType = /офис|office/iu.test(type) ? "office" : /склад|warehouse/iu.test(type) ? "warehouse" : /торгов|retail/iu.test(type) ? "retail" : /производ|industrial/iu.test(type) ? "industrial" : /свобод|free.?purpose|псн/iu.test(type) ? "freePurpose" : null;
      const url = get("url", "Url", "AdUrl", "URL", "Ссылка");
      const fields = { title: get("Title", "title", "Заголовок") ?? (type || "Коммерческий объект"), operation: /аренда|сдам|rent/iu.test(operation) ? "rent" as const : "sale" as const, propertyType, price: numeric("Price", "price", "Цена"), area: numeric("Area", "Square", "area", "Площадь"), city: get("City", "city", "Город") ?? null, address: get("Address", "address", "Адрес") ?? null };
      if (!url) { manualListingSchema.omit({ url: true }).parse(fields); result.pending.push({ ...fields, source: options.source, externalId: get("Id", "externalId") ?? null, url: null, reason: "public_url_required" }); return; }
      const listing = manualListing({ ...fields, url, description: get("Description", "description", "Описание") ?? "" }, fetchedAt);
      if (listing.source !== options.source) throw new Error("SOURCE_MISMATCH");
      result.listings.push({ ...listing, ...extractListingDates(options.source, { ...r, url: listing.url }, { url: listing.url }, fetchedAt) });
    } catch { result.errors.push({ row: index + (options.format === "xml" ? 1 : 2), code: "INVALID_FEED_ROW" }); }
  });
  return result;
}
