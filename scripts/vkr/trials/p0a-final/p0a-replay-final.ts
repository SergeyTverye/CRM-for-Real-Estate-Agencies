import { readFile, writeFile } from "node:fs/promises";
import { load } from "cheerio";
import RealEstateScraper from "real-estate-scrapper";
import { extractListingDates } from "../../../../src/modules/property-search/infrastructure/listing-dates";
import type { ListingDates } from "../../../../src/modules/property-search/infrastructure/listing-dates";
import { normalizeListing } from "../../../../src/modules/property-search/infrastructure/normalization";
import { SearchFilters } from "../../../../src/modules/property-search/domain/types";
import { buildScraperQuery } from "../../../../src/modules/property-search/infrastructure/source-filters";

async function main() {
  const dir = "tests/fixtures/scraper/p0a-final", ledger = JSON.parse(await readFile(`${dir}/ledger.json`, "utf8"));
  const client = new RealEstateScraper();
  const details: { source: string; sourceListingId: string; url: string; datesBefore: ListingDates; datesAfter: ListingDates }[] = [];
  for (const source of ["onrealt", "mirkvartir", "yandex"] as const) for (let index = 1; index <= (source === "yandex" ? 1 : 2); index++) {
    const row = ledger.responses.find((r: { file?: string }) => r.file === `${dir}/${source}-${index}.html`);
    if (!row) continue;
    const html = await readFile(`data/p0a-final/${source}-${index}.html`, "utf8"), $ = load(html);
    const fragment = source === "mirkvartir" ? $("h4").filter((_, e) => $(e).text().trim() === "Информация об объявлении").parent().find("p").first().toString() : source === "onrealt" ? $(".add-time").first().toString() : "";
    const safe = `<html><head><link rel="canonical" href="${row.url}"></head><body>${source === "mirkvartir" ? `<section><h4>Информация об объявлении</h4>${fragment}</section>` : fragment}</body></html>`;
    if (source !== "yandex") await writeFile(`${dir}/${source}-${index}.html`, safe + "\n");
    else {
      let own: Record<string, unknown> | undefined;
      const walk = (node: unknown, depth = 0) => {
        if (!node || typeof node !== "object" || depth > 35) return;
        if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1)); return; }
        const n = node as Record<string, unknown>;
        if (String(n.offerId) === row.sourceListingId && typeof n.creationDate === "string") own = n;
        Object.values(n).forEach(v => walk(v, depth + 1));
      };
      $("script:not([src])").each((_, el) => {
        const text = $(el).text().trim().replace(/^window\.INITIAL_STATE\s*=\s*/u, "").replace(/;\s*$/u, "");
        try { walk(JSON.parse(text)); } catch {  }
      });
      if (own) await writeFile(`${dir}/${source}-${index}.html`, `<script>window.INITIAL_STATE = ${JSON.stringify({ card: { offerId: row.sourceListingId, creationDate: own.creationDate, updateDate: own.updateDate } })};</script>\n`);
    }
    row.structuredDateKeys = [...new Set((html.match(/datePublished|dateModified|publishedAt|creationDate|createdAt/gu) ?? []))];
    delete row.structured; delete row.titleDateLabels; delete row.candidates;
    row.datesAfter = extractListingDates(source, html, { id: row.sourceListingId, url: row.url }, row.fetchedAt);
    details.push({ source, sourceListingId: row.sourceListingId, url: row.url, datesBefore: row.dates, datesAfter: row.datesAfter });
  }
  const source = "mirkvartir", url = ledger.attempts.at(-1).url;
  const html = await readFile("data/p0a-final/mirkvartir-serp.html", "utf8"), $ = load(html);
  const page = client.parsers[source].parsePage(html, url, buildScraperQuery(SearchFilters.parse({ operation: "sale", purposes: ["office"] }), source, new AbortController().signal));
  const before = page.results.slice(0, 25).map(raw => ({ ...normalizeListing(raw), ...extractListingDates(source, html, { id: raw.id, url: raw.url }, ledger.attempts.at(-1).at) }));
  const after = before.map(raw => ({ ...raw, ...(details.find(d => d.source === source && d.sourceListingId === raw.sourceListingId)?.datesAfter ?? {}) }));
  const fragment = $("article").toArray().map(el => {
    const card = $(el); card.find("script,style,img,svg,button").remove();
    card.find("*").each((_, node) => {
      for (const key of Object.keys(node.attribs)) if (!["class", "href", "datetime"].includes(key)) delete node.attribs[key];
      if (node.tagName === "a") { const href = $(node).attr("href") ?? ""; if (!/mirkvartir\.ru\/\d+\//u.test(href)) $(node).removeAttr("href"); }
      for (const child of node.children) if (child.type === "text") child.data = "";
    });
    return card.toString();
  }).join("\n");
  await writeFile(`${dir}/mirkvartir-serp.html`, fragment);
  await writeFile(`${dir}/ledger.json`, JSON.stringify(ledger, null, 2) + "\n");
  const projection = (rows: typeof before) => rows.map(r => ({ source: r.source, sourceListingId: r.sourceListingId, url: r.url, publishedAt: r.publishedAt, sourceUpdatedAt: r.sourceUpdatedAt, dateSource: r.dateSource, datePrecision: r.datePrecision }));
  const report = { mode: "LIVE capture + offline REPLAY measurement", physicalRequests: ledger.attempts.length, details, mirkvartirSerp: { total: before.length, publicationUnknownBefore: before.filter(r => !r.publishedAt).length, publicationUnknownAfter: after.filter(r => !r.publishedAt).length, cardIdsInSerp: details.filter(d => d.source === source && before.some(r => r.sourceListingId === d.sourceListingId)).length, before: projection(before), after: projection(after) } };
  await writeFile("docs/vkr/p0a-final-dates.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ details: details.map(d => ({ source: d.source, id: d.sourceListingId, before: d.datesBefore.publishedAt, after: d.datesAfter.publishedAt })), serp: { total: before.length, unknownBefore: report.mirkvartirSerp.publicationUnknownBefore, unknownAfter: report.mirkvartirSerp.publicationUnknownAfter } }));
  await client.close();
}
void main();
