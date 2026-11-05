import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addListingByUrl, listingSourceUrl, manualListing } from "@/modules/property-search/infrastructure/manual-listing";
import { importOfficialFeed } from "@/modules/property-search/infrastructure/official-feed";
import * as http from "@/modules/property-search/infrastructure/scraper-http";
import { tabularExport } from "@/modules/export/application/tabular-export";

afterEach(() => vi.restoreAllMocks());
const fetchedAt = "2026-11-05T12:00:00Z";
function response(data: string, status = 200) { return { data: Buffer.from(data), status, url: "https://realty.yandex.ru/offer/101/", headers: {} }; }

describe("SR-05 link/manual fallback", () => {
  it.each(["http://cian.ru/1", "https://cian.ru.evil.test/", "https://127.0.0.1/", "https://user:pass@avito.ru/", "https://avito.ru:8443/", "file:///etc/passwd"])("rejects unsafe URL before HTTP: %s", async url => {
    const network = vi.spyOn(http, "scraperHttpRequest");
    await expect(addListingByUrl(url)).rejects.toThrow(); expect(network).not.toHaveBeenCalled();
  });
  it("does not retain query tracking credentials and keeps a trusted source", () => {
    expect(listingSourceUrl("https://www.avito.ru/a/101?token=private#part-1")).toEqual({ source: "avito", url: "https://www.avito.ru/a/101" });
    expect(manualListing({ url: "https://www.avito.ru/a/101", title: "Офис", operation: "sale", price: 1000 }, fetchedAt)).toMatchObject({ source: "avito", operation: "sale", price: "1000.00", seller: { type: "unknown" }, dateSource: "unknown", identityNeedsReview: true });
  });
  it.each([[401, "blocked"], [403, "blocked"], [439, "blocked"], [429, "rate_limited"]] as const)("HTTP %s returns manual form DTO", async (status, reason) => {
    vi.spyOn(http, "scraperHttpRequest").mockResolvedValue(response("", status));
    expect(await addListingByUrl("https://realty.yandex.ru/offer/101/")).toEqual({ status: "manual_required", source: "yandex", url: "https://realty.yandex.ru/offer/101/", reason });
  });
  it("CAPTCHA returns user action without retry or solver", async () => {
    const request = vi.spyOn(http, "scraperHttpRequest").mockResolvedValue(response("<title>Проверка безопасности</title><div class='SmartCaptcha'></div>"));
    expect(await addListingByUrl("https://realty.yandex.ru/offer/101/")).toMatchObject({ status: "manual_required", reason: "needs_user_action" });
    expect(request).toHaveBeenCalledOnce();
  });
  it("extracts the requested single JSON-LD card, preserves publication and unknown operation", async () => {
    vi.spyOn(http, "scraperHttpRequest").mockResolvedValue(response(`<script type='application/ld+json'>${JSON.stringify({ "@type": "Place", name: "Офис", url: "https://realty.yandex.ru/offer/101/", datePublished: "2026-11-04", offers: { price: "120000" } })}</script>`));
    expect(await addListingByUrl("https://realty.yandex.ru/offer/101/", { fetchedAt })).toMatchObject({ status: "success", listing: { title: "Офис", price: "120000.00", operation: null, publishedAt: "2026-11-03T17:00:00.000Z", datePrecision: "day" } });
  });
  it("unrelated recommendations do not become the requested card", async () => {
    vi.spyOn(http, "scraperHttpRequest").mockResolvedValue(response(`<script type='application/ld+json'>${JSON.stringify({ name: "Other", url: "https://realty.yandex.ru/offer/999/", offers: { price: 1 } })}</script>`));
    expect(await addListingByUrl("https://realty.yandex.ru/offer/101/")).toMatchObject({ status: "manual_required", reason: "parse_failed" });
  });
  it("passes AbortSignal and reports cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    const request = vi.spyOn(http, "scraperHttpRequest").mockRejectedValue(new Error("NETWORK_TIMEOUT_OR_ABORT"));
    expect(await addListingByUrl("https://realty.yandex.ru/offer/101/", { signal: controller.signal })).toMatchObject({ reason: "cancelled" });
    expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
  });
});

describe("official feed preview, no external requests or CRM writes", () => {
  it("rejects deep and wide XML before DOM construction", async () => {
    for (const xml of ["<x>".repeat(33) + "</x>".repeat(33), "<root>" + "<x/>".repeat(50000) + "</root>"])
      await expect(importOfficialFeed(Buffer.from(xml), { format: "xml", source: "yandex" })).rejects.toThrow("FEED_XML_COMPLEXITY_LIMIT");
  });
  it.each(["=1+1", "+SUM(A1)", "-2+3", "@cmd", "  =1", "\t=1"])("escapes imported formula prefix %j in CSV and XLSX", async address => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Feed");
    sheet.addRow(["URL", "Title", "OperationType", "Address"]);
    sheet.addRow(["https://www.avito.ru/a/101", "Office", "Продам", address]);
    const imported = await importOfficialFeed(Buffer.from(await workbook.xlsx.writeBuffer()), { format: "xlsx", source: "avito" });
    const rows = [[imported.listings[0]!.address]];
    const csv = Buffer.from(await tabularExport("csv", ["Адрес"], rows)).toString();
    expect(csv).toContain("\"'");
    const output = new ExcelJS.Workbook(); await output.xlsx.load(Buffer.from(await tabularExport("xlsx", ["Адрес"], rows)) as never);
    expect(output.worksheets[0]!.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(output.worksheets[0]!.getCell("A2").text).toMatch(/^'/u);
  });
  it("recognizes Yandex XML values and independent source dates, excludes seller subtree", async () => {
    const xml = `<realty-feed><offer internal-id="agency-1"><type>продажа</type><commercial-type>офис</commercial-type><url>https://realty.yandex.ru/offer/101/</url><price><value>1500000</value></price><area><value>70.5</value></area><location><locality-name>Новосибирск</locality-name><address>Тестовая 1</address></location><creation-date>2026-11-04T12:00:00+07:00</creation-date><last-update-date>2026-11-05T12:00:00+07:00</last-update-date><sales-agent><name>PRIVATE SELLER</name><phone>PRIVATE PHONE</phone></sales-agent></offer></realty-feed>`;
    const result = await importOfficialFeed(Buffer.from(xml), { format: "xml", source: "yandex", fetchedAt });
    expect(result.errors).toEqual([]); expect(result.listings[0]).toMatchObject({ purpose: "office", price: "1500000.00", area: 70.5, city: "Новосибирск", publishedAt: "2026-11-04T05:00:00.000Z", sourceUpdatedAt: "2026-11-05T05:00:00.000Z" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("keeps Avito Autoload agency Id separate from a nonexistent public URL", async () => {
    const xml = `<Ads formatVersion="3" target="Avito.ru"><Ad><Id>agency-12</Id><OperationType>Сдам</OperationType><ObjectType>Складское помещение</ObjectType><Square>250</Square><Price>90000</Price><City>Новосибирск</City><Address>Тестовая 2</Address><Title>Склад</Title><ManagerName>PRIVATE SELLER</ManagerName><ContactPhone>PRIVATE PHONE</ContactPhone></Ad></Ads>`;
    const result = await importOfficialFeed(Buffer.from(xml), { format: "xml", source: "avito" });
    expect(result.listings).toEqual([]); expect(result.errors).toEqual([]);
    expect(result.pending[0]).toMatchObject({ source: "avito", externalId: "agency-12", propertyType: "warehouse", operation: "rent", price: 90000, area: 250, url: null, reason: "public_url_required" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("supports quoted CSV/BOM and isolates invalid rows without raw error payloads", async () => {
    const csv = '\uFEFFURL;Заголовок;Операция;Тип;Цена;Площадь;ContactPhone\nhttps://www.avito.ru/a/101;"Офис; центр";продажа;офис;"1 500 000";70,5;PRIVATE\nhttps://127.0.0.1/;PRIVATE;продажа;офис;12;1;PRIVATE';
    const result = await importOfficialFeed(Buffer.from(csv), { format: "csv", source: "avito" });
    expect(result.listings[0]).toMatchObject({ title: "Офис; центр", price: "1500000.00", area: 70.5 });
    expect(result.errors).toEqual([{ row: 3, code: "INVALID_FEED_ROW" }]); expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("loads XLSX with a row ceiling", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Export");
    sheet.addRow(["URL", "Title", "OperationType", "Square"]);
    sheet.addRow(["https://www.avito.ru/a/101", "Office", "Продам", 25]);
    sheet.addRow(["https://www.avito.ru/a/102", "Office", "Продам", 30]);
    const result = await importOfficialFeed(Buffer.from(await workbook.xlsx.writeBuffer()), { format: "xlsx", source: "avito", maxRows: 1 });
    expect(result).toMatchObject({ rowsRead: 1, incomplete: true, errors: [] }); expect(result.listings).toHaveLength(1);
  });
  it("rejects XML entity declarations and source mismatch", async () => {
    await expect(importOfficialFeed(Buffer.from('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><offer/>'), { format: "xml", source: "avito" })).rejects.toThrow("UNSAFE_FEED_XML");
    const result = await importOfficialFeed(Buffer.from('URL,Title,OperationType\nhttps://cian.ru/101,Office,Продам'), { format: "csv", source: "avito" });
    expect(result.listings).toEqual([]); expect(result.errors).toHaveLength(1);
  });
});
