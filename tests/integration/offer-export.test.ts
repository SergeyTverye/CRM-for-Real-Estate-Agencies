import { beforeEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { strFromU8, unzipSync } from "fflate";
import { db, resetDatabase, seedBase, makeClient, makeNeed, makeProperty, apiRequest, routeParams, sessionCookieFor } from "../helpers/fixtures";
import { createOffer, getOffer } from "@/modules/commercial-offers/application/offer-service";
import { getOfferPrintData } from "@/modules/commercial-offers/application/offer-print-data";
import { generateOfferDocument } from "@/modules/commercial-offers/application/offer-document";
import { openDocumentForDownload } from "@/modules/documents/application/document-service";
import { uploadPropertyMedia, updatePropertyMedia } from "@/modules/properties/application/property-media-service";
import { offerHtml } from "@/modules/export/presentation/offer-html";
import { htmlToPdf } from "@/modules/export/application/html-pdf";
import { GET as pdfGet } from "@/app/api/v1/offers/[id]/pdf/route";

beforeEach(resetDatabase);

it("exports A4 PDF and DOCX with authorized gallery, requisites, comparison and frozen values", async () => {
  const u = await seedBase();
  const c = await makeClient(u.realtor1); const n = await makeNeed(u.realtor1, c.id);
  const p = await makeProperty(u.realtor1, { addressText: "Снимок адреса", district: "Центральный", commercialPurpose: "office", floor: 1, floorsTotal: 5, area: "100", price: "123456" });
  const p2 = await makeProperty(u.realtor1, { addressText: "Второй объект", price: "32100" });
  const photoIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const png = await sharp({ create: { width: 80 + index, height: 40, channels: 3, background: "#336699" } }).png().toBuffer();
    const photo = await uploadPropertyMedia(u.realtor1, p.id, new File([new Uint8Array(png)], `synthetic-${index}.png`, { type: "image/png" }), { kind: "photo", caption: `Разрешённое фото ${index}` });
    photoIds.push(photo.id);
  }
  await updatePropertyMedia(u.realtor1, p.id, photoIds[4]!, { isCover: true, caption: "Разрешённое фото 4" });
  await db.legalEntity.update({ where: { id: u.llcId }, data: { requisites: "ИНН 0000000000\nТелефон специалиста: +7 000 000-00-00", logoDocumentId: photoIds[0] } });
  const o = await createOffer(u.realtor1, { clientNeedId: n.id, legalEntityId: u.llcId, title: "Подборка офисов", introText: "Введение <без HTML>", items: [{ propertyId: p.id, comment: "Примечание для клиента" }, { propertyId: p2.id }] });
  await db.property.update({ where: { id: p.id }, data: { price: "999999", addressText: "Изменённый адрес", area: "500", district: "Новый район" } });
  const print = await getOfferPrintData(u.realtor1, o.id, "https://crm.test");
  expect(print.items[0]).toMatchObject({ address: "Снимок адреса", district: "Центральный", area: "100 м²", price: "123 456 ₽/мес.", perM2: "1 234,56 ₽/м²/мес." });
  expect(print.items[0]!.images).toHaveLength(4);
  expect(print.items[0]!.images[0]!.caption).toBe("Разрешённое фото 4");
  const html = offerHtml(print);
  expect(html).toContain("Введение &lt;без HTML&gt;"); expect(html).toContain("Сравнение объектов"); expect(html).not.toContain("999999");
  expect(html).not.toMatch(/<img[^>]+src="https?:/);
  // Comparison and contact details belong to the cover, before the object pages.
  expect(html.indexOf("<h2>Сравнение объектов")).toBeLessThan(html.indexOf('<section class="object">'));
  expect(html.indexOf("Ваш ответственный специалист")).toBeLessThan(html.indexOf('<section class="object">'));
  expect(html).toContain('class="thumbnail"');
  const doc = await generateOfferDocument(u.realtor1, o.id, "https://crm.test");
  const file = await openDocumentForDownload(u.realtor1, doc.id);
  const chunks: Buffer[] = []; for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
  const zip = unzipSync(Buffer.concat(chunks));
  const xml = strFromU8(zip["word/document.xml"]!);
  for (const value of ["Снимок адреса", "123 456", "Сравнение объектов", "Примечание для клиента", "0000000000", "Центральный", "Цена за м²"]) expect(xml).toContain(value);
  expect(xml).not.toContain("999999"); expect(xml).toContain("w:pageBreakBefore"); expect(xml).toContain("w:tblHeader"); expect(xml).toContain('w:w="11906"');
  expect(xml.indexOf("Сравнение объектов")).toBeLessThan(xml.indexOf("w:pageBreakBefore"));
  expect(xml.indexOf("Ваш ответственный специалист")).toBeLessThan(xml.indexOf("w:pageBreakBefore"));
  expect(Object.keys(zip).filter(key => key.startsWith("word/media/")).length).toBeGreaterThanOrEqual(4);
  const cookie = await sessionCookieFor(u.realtor1);
  const response = await pdfGet(apiRequest("GET", `/api/v1/offers/${o.id}/pdf`, { cookie }), routeParams({ id: o.id }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const pdf = Buffer.from(await response.arrayBuffer());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const mediaBox = pdf.toString("latin1").match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)/);
  expect(Number(mediaBox?.[1])).toBeCloseTo(595, 0); expect(Number(mediaBox?.[2])).toBeCloseTo(842, 0);
  // Poppler is optional in CI; when installed, verify the actual PDF text as well as its source HTML.
  const extracted = spawnSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" });
  if (!extracted.error) {
    expect(extracted.status).toBe(0);
    for (const value of ["Снимок адреса", "Сравнение объектов", "123 456", "Центральный", "Примечание для клиента"]) expect(extracted.stdout.replace(/\u00a0/g, " ")).toContain(value);
    expect(extracted.stdout).not.toContain("999 999");
  }
  expect((await getOffer(u.realtor1, o.id)).offer.sentAt).toBeNull();
}, 60_000);

it("renders untrusted HTML without fetching remote resources or running scripts", async () => {
  const http = await import("node:http");
  let requests = 0;
  const server = http.createServer((_req, res) => { requests++; res.end("external"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as import("node:net").AddressInfo).port;
    const pdf = await htmlToPdf(`<html><body><img src="http://127.0.0.1:${port}/photo"><script>fetch('http://127.0.0.1:${port}/script')</script><p>CRM</p></body></html>`);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(requests).toBe(0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
