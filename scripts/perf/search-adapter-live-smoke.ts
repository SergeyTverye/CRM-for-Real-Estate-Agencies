/**
 * LIVE adapter smoke harness (coordinator-run only, trusted network).
 *
 * Runs the actual current RealEstateScraperAdapter/defaultScraperFactory —
 * never a direct library client or mock transport — one adapter job per
 * source, bundled Chrome executable provided explicitly via --chrome.
 *
 * NOT RUN here: this file only authors the harness. The coordinator runs e.g.
 *   tsx scripts/perf/search-adapter-live-smoke.ts --chrome="C:\...\chrome.exe" > smoke.jsonl
 * and redirects stdout (coordinator redirect/addrs are ignored data).
 *
 * Safety/bounds: no dotenv, no DB/auth/user-profile reads, no AI, no cookies/
 * CDP/user-Chrome. Plain-HTTP factory transport is wrapped to count requests
 * and enforce a fixed max; browser page/subresource requests travel through
 * the default factory's internal context.route -> safeRequest seam and cannot
 * be counted from here without changing product, so browser-requested sources
 * report requestCount null and rely on the per-job deadline bound instead.
 * stdout is sanitized counts/codes only (no URLs, listings, bodies, raw
 * errors, keys, config, stacks).
 */
import path from "node:path";
import type RealEstateScraper from "real-estate-scrapper";
import {
  RealEstateScraperAdapter,
  defaultScraperFactory,
  ScraperJobLimiter,
  type ScraperFactory,
} from "../../src/modules/property-search/infrastructure/scraper-adapter";
import { SOURCES, type Source } from "../../src/modules/property-search/domain/types";

const PER_SOURCE_TIMEOUT_MS = 30_000;
const SEARCH_DEPTH = { maxPages: 1, limit: 12 } as const;
/** Fixed plain-HTTP budget/job: maxPages1/limit12 fans out to <=6 residential
 *  branches + setup + date details; 20 caps runaway without false-tripping. */
const HTTP_TRANSPORT_BUDGET = 20;
const BROWSER_SOURCES: readonly Source[] = ["cian", "avito"];

type ClosedCode =
  | "INVALID_USAGE"
  | "INVALID_CHROME_PATH"
  | "INVALID_SOURCES"
  | "INVALID_PURPOSE"
  | "SMOKE_REQUEST_BUDGET"
  | "HARNESS_FAILED";

interface ParsedArgs {
  chrome: string;
  sources: Source[];
  purpose: "office" | "residential";
}

function fail(code: ClosedCode, message: string): never {
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 2;
  throw new Error(code);
}

function parseArgs(argv: string[]): ParsedArgs {
  const known = new Set(["--chrome", "--sources", "--purpose", "--help"]);
  let chrome: string | undefined;
  let sourcesRaw: string | undefined;
  let purposeRaw = "office";
  for (const arg of argv) {
    if (!arg.startsWith("--")) fail("INVALID_USAGE", `Unexpected positional argument (flags only): ${arg}`);
    const name = arg.split("=")[0]!;
    if (!known.has(name)) fail("INVALID_USAGE", `Unknown flag: ${name}`);
    if (name === "--help") {
      process.stdout.write(
        "Usage: search-adapter-live-smoke.ts --chrome=<ABS chrome.exe> [--sources=cian,avito,...] [--purpose=office|residential]\n",
      );
      process.exit(0);
    }
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
    if (value === undefined || value === "") fail("INVALID_USAGE", `Flag requires =value: ${name}`);
    if (name === "--chrome") chrome = value;
    else if (name === "--sources") sourcesRaw = value;
    else purposeRaw = value!;
  }
  if (chrome === undefined) fail("INVALID_USAGE", "Missing required --chrome=<absolute chrome.exe>");
  const absolute = path.win32.isAbsolute(chrome!) || path.posix.isAbsolute(chrome!);
  if (!absolute || !chrome!.toLowerCase().endsWith("chrome.exe"))
    fail("INVALID_CHROME_PATH", "Expected --chrome=<absolute path to bundled chrome.exe>");
  if (purposeRaw !== "office" && purposeRaw !== "residential")
    fail("INVALID_PURPOSE", "Expected --purpose=office|residential");
  const allowed = new Set<Source>(SOURCES);
  const wanted = sourcesRaw === undefined ? [...SOURCES] : sourcesRaw.split(",").map(s => s.trim().toLowerCase());
  if (wanted.length === 0 || wanted.some(s => !allowed.has(s as Source)))
    fail("INVALID_SOURCES", `Expected subset of: ${SOURCES.join(",")}`);
  const sources = SOURCES.filter(s => wanted.includes(s));
  return { chrome: chrome!, sources, purpose: purposeRaw as ParsedArgs["purpose"] };
}

/** Count + bound plain-HTTP attempts only; browser SSRF path inside the
 *  default factory is untouched, so browser sources report requestCount null. */
function countingTransport(
  inner: RealEstateScraper.Transport | undefined,
  counter: { count: number },
): RealEstateScraper.Transport | undefined {
  if (!inner) return undefined;
  return async request => {
    counter.count += 1;
    if (counter.count > HTTP_TRANSPORT_BUDGET)
      throw Object.assign(new Error("SMOKE_REQUEST_BUDGET"), { code: "SMOKE_REQUEST_BUDGET" });
    return inner(request);
  };
}

async function smokeSource(
  source: Source,
  args: ParsedArgs,
  limiter: ScraperJobLimiter,
): Promise<void> {
  const started = Date.now();
  const browserRequested = (BROWSER_SOURCES as readonly string[]).includes(source);
  const counter = { count: 0 };
  const factory: ScraperFactory = config =>
    defaultScraperFactory({ ...config, transport: countingTransport(config.transport, counter) ?? config.transport });
  // Explicit provided browser only: executablePath + headless; no user data,
  // CDP endpoint, cookies, or profile. Close stays owned by the adapter.
  const adapter = new RealEstateScraperAdapter({
    enabled: true,
    browserEnabled: true,
    enabledSources: [source],
    jobTimeoutMs: PER_SOURCE_TIMEOUT_MS,
    maxConcurrentJobs: 1,
    limiter,
    browser: { channel: "chrome", executablePath: args.chrome, headless: true },
    depth: { ...SEARCH_DEPTH },
    factory,
  });
  try {
    const result = await adapter.searchDetailed(
      { city: "Новосибирск", operation: "sale", purposes: [args.purpose], sources: [source] },
      { deadline: Date.now() + PER_SOURCE_TIMEOUT_MS },
    );
    const run = result.sources.find(r => r.source === source);
    let confirmedCount = 0;
    let needsReviewCount = 0;
    let rejectedCount = 0;
    for (const item of result.listings) {
      if (item.evaluation.verdict === "confirmed") confirmedCount += 1;
      else if (item.evaluation.verdict === "needs_review") needsReviewCount += 1;
      else rejectedCount += 1;
    }
    process.stdout.write(
      JSON.stringify({
        source,
        status: run?.status ?? "error",
        resultCount: run?.resultCount ?? 0,
        confirmedCount,
        needsReviewCount,
        rejectedCount,
        pagesFetched: run?.pagesFetched ?? 0,
        incomplete: run?.incomplete ?? true,
        failureCode: run?.failureCode ?? null,
        requestCount: browserRequested ? null : counter.count,
        elapsedMs: Date.now() - started,
        browserRequested,
        timeoutBoundMs: PER_SOURCE_TIMEOUT_MS,
      }) + "\n",
    );
  } catch {
    process.stdout.write(
      JSON.stringify({
        source,
        status: "error",
        resultCount: 0,
        confirmedCount: 0,
        needsReviewCount: 0,
        rejectedCount: 0,
        pagesFetched: 0,
        incomplete: true,
        failureCode: "HARNESS_FAILED",
        requestCount: browserRequested ? null : counter.count,
        elapsedMs: Date.now() - started,
        browserRequested,
        timeoutBoundMs: PER_SOURCE_TIMEOUT_MS,
      }) + "\n",
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const limiter = new ScraperJobLimiter(1);
  for (const source of args.sources) await smokeSource(source, args, limiter);
}

// No network on import: entry runs only under coordinator CLI invocation.
const invokedAsMain = (process.argv[1] ?? "").replace(/\\/g, "/").includes("search-adapter-live-smoke");
if (invokedAsMain) {
  main().catch(() => {
    if (!process.exitCode) process.exitCode = 1;
  });
}
