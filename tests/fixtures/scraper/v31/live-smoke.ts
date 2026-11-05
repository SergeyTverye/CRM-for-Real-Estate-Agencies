/** Explicit LIVE diagnostic. Not imported by unit tests. At most 3 physical requests/source, no retry. */
import { mkdir, writeFile } from "node:fs/promises";
import { load } from "cheerio";
import RealEstateScraper from "real-estate-scrapper";
import { SearchFilters, type Source } from "../../../../src/modules/property-search/domain/types";
import { buildScraperQuery } from "../../../../src/modules/property-search/infrastructure/source-filters";
import { scraperHttpRequest } from "../../../../src/modules/property-search/infrastructure/scraper-http";
import { extendSourceParsers } from "../../../../src/modules/property-search/infrastructure/parser-extension";
import { detectAccessChallenge } from "../../../../src/modules/property-search/infrastructure/source-response";
import { normalizeListing } from "../../../../src/modules/property-search/infrastructure/normalization";

async function main() {
  for (const source of ["cian", "avito", "domclick", "mirkvartir", "onrealt", "yandex", "youla"] as Source[]) {
    const dir = `tests/fixtures/scraper/v31/${source}`;
    await mkdir(dir, { recursive: true });
    let requests = 0, stopped = false;
    const responses: { status: number; host: string; challenge: boolean }[] = [];
    const startedAt = new Date().toISOString();
    const transport: RealEstateScraper.Transport = async request => {
      if (stopped || requests >= 3) throw new Error("SMOKE_REQUEST_BUDGET");
      try {
        const response = await scraperHttpRequest(request.url, {
          method: request.method as "GET" | "POST", signal: request.signal, headers: request.headers,
          body: request.data === undefined ? undefined : JSON.stringify(request.data), timeoutMs: 12000, maxBytes: 10_000_000,
          beforeRequest: () => { if (++requests > 3) throw new Error("SMOKE_REQUEST_BUDGET"); },
          onResponse: r => { responses.push({ status: r.status, host: new URL(r.url).hostname, challenge: detectAccessChallenge(r.url, r.data.toString("utf8")) }); },
        });
        const text = response.data.toString("utf8");
        let data: unknown = text;
        if (/json/iu.test(String(response.headers["content-type"]))) { try { data = JSON.parse(text); } catch { /* Replay parser failure. */ } }
        // Save inert markup structure only: no seller text, contacts, attributes, scripts or URLs.
        const $ = load(text);
        $("script,style,noscript,svg,img,iframe,input,textarea,form").remove();
        $("*").each((_, el) => {
          if (el.type !== "tag") return;
          for (const key of Object.keys(el.attribs)) delete el.attribs[key];
          for (const child of el.children) if (child.type === "text") child.data = "";
        });
        const structure = $.html().replace(/<!--[\s\S]*?-->/gu, "").slice(0, 200000);
        await writeFile(`${dir}/response-${responses.length}.html`, structure, "utf8");
        if (response.status >= 400 || detectAccessChallenge(response.url, data)) stopped = true;
        return { data, status: response.status, url: response.url };
      } catch (e) { stopped = true; throw e; }
    };
    const client = extendSourceParsers(new RealEstateScraper({ transport, maxRetries: 0, timeout: 12000 }));
    let result: RealEstateScraper.SearchResult | undefined;
    let failure: string | undefined;
    try { result = await client.searchSite(source, buildScraperQuery(SearchFilters.parse({ operation: "sale", purposes: ["office"], sources: [source] }), source, AbortSignal.timeout(25000), undefined, { maxPages: 1, limit: 20 })); }
    catch { failure = "FETCH_FAILED"; }
    finally { await client.close(); }
    const normalized = (result?.results ?? []).map(raw => normalizeListing(raw, result!.timestamp)).map(row => ({ ...row, title: null, description: "", address: null, images: [], seller: { type: "unknown" }, structuredFeatures: {} }));
    const errors = result?.errors.map(e => ({ code: e.code, status: e.status, page: e.page })) ?? [];
    const status = responses.some(r => r.challenge || [401, 403, 429, 439].includes(r.status)) ? "BLOCKED" : errors.length || failure ? "PARTIAL" : "PASS";
    const evidence = { mode: "REPLAY", capturedFrom: "LIVE", source, startedAt, finishedAt: new Date().toISOString(), requests: Math.min(requests, 3), responses, status, resultCount: normalized.length, errors, failure, pages: result?.pages.map(p => ({ page: p.page, hasNext: p.hasNext, truncated: p.truncated })), normalized,
      redaction: "Markup structure only; all text/attributes removed. Normalized property projection without seller, contacts, address, description, images. Not a full HTML parser replay." };
    await writeFile(`${dir}/live.json`, JSON.stringify(evidence, null, 2), "utf8");
    console.log(JSON.stringify({ source, status, requests: evidence.requests, http: responses.map(r => r.status), listings: normalized.length, errors }));
  }
}
void main();
