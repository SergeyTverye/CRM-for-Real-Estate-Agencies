import RealEstateScraper from "real-estate-scrapper";

const sources = ["cian", "avito", "youla", "yandex", "onrealt", "domclick", "mirkvartir"] as const;
const scraper = new RealEstateScraper({ timeout: 60_000, delay: 0, maxRetries: 0 });
const query: RealEstateScraper.Query = { city: "Новосибирск", category: "commercial", types: ["office"], deal: "sale", sources: [...sources], maxPages: 1, limit: 100 };
type ScrapeResult = { errors?: Array<{ code?: string; message?: string }>; results?: unknown[]; total?: number };
const reasonFor = (result: ScrapeResult, status: string) => {
  if (status === "success" || status === "partial") return "";
  const err = result?.errors?.[0];
  const code = String(err?.code ?? "").toUpperCase();
  if (code.includes("UNSUPPORTED_FILTER") || code.includes("DISTRICT_RESOLUTION_REQUIRED")) return "фильтр не поддерживается источником";
  if (code.includes("ACCESS_BLOCKED") || code.includes("CAPTCHA") || code.includes("429")) return "доступ ограничен площадкой";
  return status === "partial" ? "частичная выдача источника" : status;
};

async function main() {
  for (const source of sources) {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        scraper.searchSite(source, { ...query, sources: [source], signal: AbortSignal.timeout(60_000) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SMOKE_TIMEOUT")), 60_000); }),
      ]) as ScrapeResult;
      const errs = Array.isArray(result.errors) ? result.errors : [];
      const errorCodes = errs.map((e) => String(e.code ?? "").toUpperCase());
      const status = errorCodes.some((x) => x.includes("ACCESS_BLOCKED") || x.includes("CAPTCHA") || x.includes("429")) ? "blocked"
        : errorCodes.some((x: string) => x.includes("UNSUPPORTED_FILTER") || x.includes("DISTRICT_RESOLUTION_REQUIRED")) ? "unsupported_filter"
          : errs.length ? "partial" : "success";
      const results = Array.isArray(result.results) ? result.results.length : Number(result.total ?? 0);
      console.log(JSON.stringify({ platform: source, status, results, durationMs: Date.now() - started, reason: reasonFor(result, status) }));
    } catch (error) {
      const timeout = error instanceof Error && (error.message === "SMOKE_TIMEOUT" || error.name === "TimeoutError");
      const message = timeout ? "лимит 60 секунд" : error instanceof Error ? error.message : "ошибка источника";
      const status = timeout ? "timeout" : /UNSUPPORTED_FILTER|DISTRICT_RESOLUTION_REQUIRED/i.test(message) ? "unsupported_filter" : /CAPTCHA|BLOCK|429|ACCESS_DENIED/i.test(message) ? "blocked" : "error";
      console.log(JSON.stringify({ platform: source, status, results: 0, durationMs: Date.now() - started, reason: message.slice(0, 100).replace(/[\r\n]/g, " ") }));
    } finally { if (timer) clearTimeout(timer); }
  }
  await scraper.close();
}
main().catch(async () => { await scraper.close(); process.exitCode = 1; });
