/** Explicit bounded LIVE diagnostic; never imported by Vitest. */
import { config } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { load } from "cheerio";
import { db, disconnectDb } from "../../../../src/shared/db/client";
import { scraperHttpRequest } from "../../../../src/modules/property-search/infrastructure/scraper-http";
import { extractListingDates } from "../../../../src/modules/property-search/infrastructure/listing-dates";
import type { Source } from "../../../../src/modules/property-search/domain/types";
config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
const dir = "tests/fixtures/scraper/p0a-final";
async function main() {
  const mode = process.argv[2] ?? "inspect";
  if (mode === "inspect") {
    const listings = await db.externalListing.findMany({ where: { source: { in: ["onrealt", "mirkvartir", "yandex", "youla"] } }, orderBy: { firstSeenAt: "asc" }, select: { id: true, source: true, url: true, sourceListingId: true, description: true, publishedAt: true }, take: 200 });
    console.log(JSON.stringify({ sources: Object.fromEntries(["onrealt", "mirkvartir", "yandex", "youla"].map(s => [s, listings.filter(l => l.source === s).slice(0, 6).map(l => ({ ...l, description: l.description?.slice(0, 180) }))])), settings: await db.aiSetting.findFirst({ select: { perJobLimit: true, monthlyBudgetRub: true, aiEnabled: true } }) }));
    return;
  }
  if (mode === "serp") {
    const path = `${dir}/ledger.json`, ledger = JSON.parse(await readFile(path, "utf8"));
    const response = await scraperHttpRequest("https://cre.mirkvartir.ru/%D0%9D%D0%BE%D0%B2%D0%BE%D1%81%D0%B8%D0%B1%D0%B8%D1%80%D1%81%D0%BA%D0%B0%D1%8F+%D0%BE%D0%B1%D0%BB%D0%B0%D1%81%D1%82%D1%8C/%D0%9D%D0%BE%D0%B2%D0%BE%D1%81%D0%B8%D0%B1%D0%B8%D1%80%D1%81%D0%BA/%D0%9E%D1%84%D0%B8%D1%81%D1%8B/", { timeoutMs: 12000, maxBytes: 5000000, beforeRequest: url => { if (ledger.attempts.length >= 6) throw Error("SESSION_HTTP_LIMIT"); ledger.attempts.push({ source: "mirkvartir", url, at: new Date().toISOString() }); writeFileSync(path, JSON.stringify(ledger, null, 2)); } });
    await writeFile("data/p0a-final/mirkvartir-serp.html", response.data);
    ledger.responses.push({ source: "mirkvartir", kind: "serp", status: response.status, rawSha256: createHash("sha256").update(response.data).digest("hex") });
    await writeFile(path, JSON.stringify(ledger, null, 2) + "\n");
    console.log(JSON.stringify({ attempts: ledger.attempts.length, status: response.status })); return;
  }
  if (mode !== "cards") throw Error("Unsupported diagnostic mode");
  await mkdir(dir, { recursive: true });
  // Persist the physical-attempt counter BEFORE the request, including redirects.
  const ledgerPath = `${dir}/ledger.json`;
  let ledger: { attempts: { source: Source; url: string; at: string }[]; responses: unknown[] };
  try { ledger = JSON.parse(await readFile(ledgerPath, "utf8")); } catch { ledger = { attempts: [], responses: [] }; }
  if (ledger.attempts.length) throw Error("Session already dispatched; no automatic repeat");
  for (const source of ["onrealt", "mirkvartir", "yandex"] as Source[]) {
    const rows = source === "mirkvartir" ? ["369638218", "369638217"].map(id => ({ url: `https://cre.mirkvartir.ru/${id}/`, sourceListingId: id })) : await db.externalListing.findMany({ where: { source, operation: "sale", sourceListingId: { not: "synthetic-101" } }, orderBy: { firstSeenAt: "asc" }, take: source === "yandex" ? 1 : 2 });
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!, start = new Date().toISOString();
      try {
        const response = await scraperHttpRequest(row.url, { timeoutMs: 12000, maxBytes: 5_000_000, beforeRequest: url => {
          if (ledger.attempts.length >= 6) throw Error("SESSION_HTTP_LIMIT");
          ledger.attempts.push({ source, url, at: new Date().toISOString() });
          writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
        } });
        const html = response.data.toString("utf8"), $ = load(html);
        const dates = extractListingDates(source, html, { id: row.sourceListingId, url: row.url }, start);
        const candidates: { tag: string; attrs: Record<string, string>; text: string }[] = [];
        $("meta, time, .add-time, [class*='date'], [class*='Date'], [class*='publish']").each((_, el) => {
          const attrs = Object.fromEntries(Object.entries($(el).attr() ?? {}).filter(([k]) => ["class", "datetime", "content", "itemprop", "property", "name"].includes(k)));
          const text = $(el).text().trim();
          if (/date|publish|добавлен|размещ|опублик|обновл|\d{4}-\d{2}-\d{2}/iu.test(JSON.stringify(attrs) + text) && text.length < 400) candidates.push({ tag: el.tagName, attrs, text });
        });
        // Keep only date labels/identity: no contacts, seller, address, scripts or tokens.
        const safe = candidates.filter(c => /date|publish|добавлен|размещ|опублик|обновл/iu.test(JSON.stringify(c))).map(c => ({ ...c, text: c.text.replace(/\+?\d[\d ()-]{9,}\d/gu, "[redacted]") }));
        const structured = [...html.matchAll(/.{0,45}(?:datePublished|dateModified|publishedAt|creationDate|createdAt).{0,100}/giu)].map(m => m[0].replace(/\+?\d[\d ()-]{9,}\d/gu, "[redacted]"));
        const canonical = $("link[rel='canonical']").attr("href") ?? row.url;
        const snippet = `<html><head><link rel="canonical" href="${canonical}"></head><body>${safe.map(c => `<${c.tag} ${Object.entries(c.attrs).map(([k,v]) => `${k}="${v.replaceAll('"', '&quot;')}"`).join(" ")}>${c.text}</${c.tag}>`).join("\n")}</body></html>`;
        const file = `${dir}/${source}-${index + 1}.html`;
        await writeFile(file, snippet);
        ledger.responses.push({ source, url: row.url, sourceListingId: row.sourceListingId, status: response.status, fetchedAt: start, file, rawSha256: createHash("sha256").update(response.data).digest("hex"), dates, candidates: safe, structured, titleDateLabels: $("body").text().match(/.{0,40}(?:опубликован|размещ[её]н|добавлен|обновл[её]н).{0,90}/giu)?.slice(0, 15) ?? [] });
        // Store raw bytes locally only for parser diagnosis, never in Git/evidence.
        await mkdir("data/p0a-final", { recursive: true });
        await writeFile(`data/p0a-final/${source}-${index + 1}.html`, html);
      } catch (error) { ledger.responses.push({ source, url: row.url, fetchedAt: start, failure: error instanceof Error ? error.message.replace(/https?:\/\/\S+/gu, "[url]") : "FETCH_FAILED" }); }
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ attempts: ledger.attempts.length, responses: ledger.responses }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Diagnostic failed"); process.exitCode = 1; }).finally(disconnectDb);
