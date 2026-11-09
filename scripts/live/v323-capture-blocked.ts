import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import RealEstateScraper from "real-estate-scrapper";
import { buildScraperQuery } from "../../src/modules/property-search/infrastructure/source-filters";
import { SearchFilters, type Source } from "../../src/modules/property-search/domain/types";
void (async()=>{
  await mkdir("docs/screenshots/vkr/v323-captcha", {recursive:true});
  const filters=SearchFilters.parse({city:"Новосибирск",operation:"rent",priceUnit:"rub_month",purposes:["office"],sources:["cian","avito","domclick","yandex"]});
  const scraper=new RealEstateScraper({maxRetries:0});
  const targets: {source: Source; headless:boolean}[] = [
    {source:"cian", headless:true}, {source:"avito", headless:true}, {source:"domclick", headless:true},
  ];
  for (const {source, headless} of targets) {
    const q=buildScraperQuery(filters, source, new AbortController().signal, undefined, {maxPages:1,limit:5});
    const url=(scraper.parsers[source] as { buildSearchUrl(query: typeof q): string }).buildSearchUrl(q);
    const browser=await chromium.launch({headless});
    const ctx=await browser.newContext({locale:"ru-RU", viewport:{width:1366,height:900}});
    const page=await ctx.newPage();
    try { await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000}); } catch {}
    await new Promise(r=>setTimeout(r,5000));
    await page.screenshot({path:`docs/screenshots/vkr/v323-captcha/${source}-blocked.png`, fullPage:false});
    await browser.close();
    await new Promise(r=>setTimeout(r,2000));
  }
  process.stdout.write("screenshots saved\n");
})();
