import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { db, disconnectDb } from "@/shared/db/client";
import { getOfferPrintData } from "../application/offer-print-data";
import { generateOfferDocument } from "../application/offer-document";
import { generateOfferPdf } from "../application/offer-pdf";
import { openDocumentForDownload } from "@/modules/documents/application/document-service";
import { offerHtml } from "@/modules/export/presentation/offer-html";
import type { Actor } from "@/modules/auth/domain/actor";

/** Synthetic demo only. Run: DATABASE_URL=.../crm_demo npx tsx src/modules/commercial-offers/qa/verify-demo.ts */
async function main() {
  config({ path: [".env.local", ".env"], quiet: true });
  if (new URL(process.env.DATABASE_URL!).pathname !== "/crm_demo") throw new Error("Only crm_demo is permitted");
  const user = await db.user.findFirstOrThrow({ where: { roleCode: "manager", isActive: true } });
  const actor: Actor = { userId: user.id, login: user.login, displayName: user.displayName, role: "manager", mustChangePassword: false, sessionId: "demo-visual-qa" };
  const offer = await db.commercialOffer.findFirstOrThrow({ where: { status: { not: "archived" } }, orderBy: { createdAt: "asc" } });
  const dir = path.resolve("src/modules/commercial-offers/qa/artifacts");
  await mkdir(dir, { recursive: true });
  const data = await getOfferPrintData(actor, offer.id, "http://localhost:3320");
  const html = offerHtml(data);
  await writeFile(path.join(dir, "demo.html"), html);
  await writeFile(path.join(dir, "demo.pdf"), await generateOfferPdf(actor, offer.id, "http://localhost:3320"));
  const doc = await generateOfferDocument(actor, offer.id, "http://localhost:3320");
  const source = await openDocumentForDownload(actor, doc.id);
  const chunks: Buffer[] = []; for await (const chunk of source.stream) chunks.push(Buffer.from(chunk));
  await writeFile(path.join(dir, "demo.docx"), Buffer.concat(chunks));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SCRAPER_CHROME_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1400 } });
    await page.route("**/*", route => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: path.join(dir, "html-preview.png"), fullPage: true });
  } finally { await browser.close(); }
  console.log(JSON.stringify({ offerId: offer.id, objects: data.items.length, photos: data.items.map(i => i.images.length), output: dir }));
}
main().finally(disconnectDb).catch(() => { console.error("Demo export verification failed"); process.exitCode = 1; });
