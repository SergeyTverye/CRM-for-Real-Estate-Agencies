/** v3.2.3 LIVE browser probe: ordinary Playwright Chromium, headed, no stealth.
 * No fingerprint spoofing, no auto-solving, no proxy rotation. Polite: sequential, >=2s pause.
 * Opens one search URL per source (office rent Novosibirsk) + homepage, waits for JS, records
 * challenge vs listing markers, screenshots ONLY check pages (no personal data, no listing bodies).
 * Usage: npx tsx scripts/live/v323-captcha-browser-probe.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import RealEstateScraper from "real-estate-scrapper";
import { buildScraperQuery } from "../../src/modules/property-search/infrastructure/source-filters";
import { SearchFilters, type Source } from "../../src/modules/property-search/domain/types";
import { detectAccessChallenge } from "../../src/modules/property-search/infrastructure/source-response";

const SOURCES: Source[] = ["cian", "yandex", "avito", "domclick"];
const OUT_DIR = "docs/screenshots/vkr/v323-captcha";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const filters = SearchFilters.parse({ city: "Новосибирск", operation: "rent", priceUnit: "rub_month", purposes: ["office"], sources: [...SOURCES] });
  const scraper = new RealEstateScraper({ maxRetries: 0 });
  const urls: Record<string, string> = {};
  for (const source of SOURCES) {
    try {
      const query = buildScraperQuery(filters, source, new AbortController().signal, undefined, { maxPages: 1, limit: 5 });
      urls[source] = (scraper.parsers[source] as { buildSearchUrl(q: typeof query): string }).buildSearchUrl(query);
    } catch (e) {
      urls[source] = `BUILD_FAILED:${String(e).slice(0, 120)}`;
    }
  }
  // Ordinary launch: no stealth flags, no webdriver hiding, no custom UA.
  // Task requires headed; try headed, fall back to headless only if display unavailable (recorded honestly).
  let browser;
  let headed = true;
  try {
    browser = await chromium.launch({ headless: false });
  } catch {
    headed = false;
    browser = await chromium.launch({ headless: true });
  }
  const results: Record<string, unknown>[] = [];
  try {
    for (const source of SOURCES) {
      const startUrl = urls[source]!;
      const entry: Record<string, unknown> = { mode: "LIVE", source, headed, headless: !headed, startHost: null, finalHost: null, httpStatus: null, challenge: null, listingMarker: null, autoPassed: null, screenshot: null, note: null };
      try {
        entry.startHost = new URL(startUrl).hostname;
      } catch { entry.startHost = "BUILD_FAILED"; }
      if (!startUrl.startsWith("https://")) {
        entry.note = "URL не построен парсером; пропуск сети";
        results.push(entry);
        continue;
      }
      const context = await browser.newContext({ locale: "ru-RU", viewport: { width: 1366, height: 900 } });
      try {
        const page = await context.newPage();
        let status: number | null = null;
        try {
          const response = await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          status = response?.status() ?? null;
        } catch (e) {
          entry.note = `goto failed: ${String(e).slice(0, 160)}`;
        }
        // Give Servicepipe/JS-check time to execute in a real browser. No auto-solving, no form filling.
        await sleep(7000);
        let url = "", title = "", html = "";
        try { url = page.url(); } catch {}
        try { title = await page.title(); } catch {}
        try { html = await page.content(); } catch {}
        entry.finalHost = (() => { try { return new URL(url).hostname; } catch { return null; } })();
        entry.httpStatus = status;
        entry.challenge = html ? detectAccessChallenge(url || startUrl, html) : null;
        entry.listingMarker = html ? /legacy-commercial-serp-frontend|OfferCard|data-listing|search-result|offer-card/iu.test(html) : null;
        entry.htmlBytes = html.length;
        entry.titleHint = title.slice(0, 120);
        // Auto-passed = challenge gone and listing marker present without any human input.
        entry.autoPassed = entry.challenge === false && entry.listingMarker === true;
        // Screenshot ONLY when a check page is shown (challenge true) — no personal data there.
        // For listing pages we store no screenshot to avoid any seller contacts.
        if (entry.challenge) {
          const path = `${OUT_DIR}/${source}-check.png`;
          try { await page.screenshot({ path, fullPage: false }); entry.screenshot = `${source}-check.png`; }
          catch { entry.screenshot = null; }
        } else {
          entry.screenshot = null;
          entry.note = [entry.note, entry.listingMarker ? "выдача без видимой проверки (скриншот не сохраняем: возможны контакты)" : "нет проверки и нет маркера выдачи"].filter(Boolean).join("; ");
        }
      } finally {
        await context.close().catch(() => undefined);
      }
      results.push(entry);
      await sleep(2500);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  const report = { mode: "LIVE", at: new Date().toISOString(), headed, browser: "playwright-chromium-ordinary-no-stealth", intervalMs: 2500, settleMs: 7000, sources: results, limits: "1 search URL per source, no detail pages, no bodies/contacts/URLs stored, screenshots only for check pages" };
  await mkdir("docs/vkr", { recursive: true });
  await writeFile("docs/vkr/live-search-v323-captcha-browser.json", `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch(e => { process.stderr.write(`${String(e).slice(0, 500)}\n`); process.exitCode = 1; });
