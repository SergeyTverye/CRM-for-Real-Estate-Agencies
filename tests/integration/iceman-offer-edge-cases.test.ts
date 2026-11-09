import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { unzipSync, strFromU8 } from "fflate";
import { offerHtml } from "@/modules/export/presentation/offer-html";
import { offerDocx } from "@/modules/export/presentation/offer-docx";
import { htmlToPdf } from "@/modules/export/application/html-pdf";
import type { OfferPrintData } from "@/modules/commercial-offers/application/offer-print-data";
import { getConfig } from "@/shared/config/env";
const base: OfferPrintData = {id:"synthetic",status:"draft",legalEntityId:null,title:"Коммерческое предложение",date:"05.11.2026",expires:null,intro:"Введение",responsible:"Специалист",issuer:null,logo:null,items:[]};
it.each(["empty", "no-photo", "long"])("exports %s offer to HTML, PDF and DOCX without losing text", async kind => {
  const long = "Длинное описание помещения для проверки переноса. ".repeat(300) + "КОНЕЦ ОПИСАНИЯ";
  const data: OfferPrintData = {...base,intro:kind === "long" ? long : base.intro,items:kind === "empty" ? [] : [{id:"item",position:1,address:kind === "long" ? "Адрес".repeat(150) : "Красный Проспект, 25",district:"Центральный",purpose:"Офис",floor:"1",area:"80 м²",price:"100000 ₽",perM2:"1250 ₽",terms:kind === "long" ? long : null,comment:kind === "long" ? long : null,images:[],sourceUrl:null,propertyUrl:"https://crm.test/properties/synthetic"}]};
  const html = offerHtml(data);
  expect(html).toContain(`Объектов в предложении: ${data.items.length}`);
  expect(html).not.toContain("<img");
  if (kind !== "empty") expect(html).toContain("Фотографии в каталоге не добавлены");
  const docx = unzipSync(await offerDocx(data));
  const xml = strFromU8(docx["word/document.xml"]!);
  expect(xml).toContain(`Объектов в предложении: ${data.items.length}`);
  if (kind === "long") expect(xml.match(/КОНЕЦ ОПИСАНИЯ/g)).toHaveLength(3);
  const pdf = await htmlToPdf(html);
  expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(1000);
  const extracted = spawnSync("pdftotext", ["-", "-"], { input:pdf, encoding:"utf8" });
  if (!extracted.error && extracted.status !== 99) {
    expect(extracted.status).toBe(0);
    expect(extracted.stdout).toContain(`Объектов в предложении: ${data.items.length}`);
    if (kind === "long") expect(extracted.stdout.match(/КОНЕЦ ОПИСАНИЯ/g)).toHaveLength(3);
  }
  const browser = await chromium.launch({executablePath:getConfig().SCRAPER_CHROME_PATH,headless:true});
  try {
    const page = await browser.newPage({viewport:{width:794,height:1123}});
    await page.emulateMedia({media:"print"}); await page.setContent(html);
    const bounds = await page.locator(".offer-print").evaluate(el => ({width:el.clientWidth, scroll:el.scrollWidth}));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);
    if (kind === "long") {
      expect(await page.locator(".cover > p").nth(1).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(100);
      expect(await page.locator("body").innerText()).toContain("КОНЕЦ ОПИСАНИЯ");
    }
  } finally {await browser.close();}
},60000);
