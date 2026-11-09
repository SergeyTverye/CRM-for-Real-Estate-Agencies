import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type RealEstateScraper from "real-estate-scrapper";
import { guardExternalUrl } from "@/shared/net/ssrf";
import { detectAccessChallenge } from "./source-response";

export type NavigationSource = "cian" | "yandex";
export function headedBrowserAvailable() {
  return !existsSync("/.dockerenv") && !process.env.container &&
    (["win32", "darwin"].includes(process.platform) || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY);
}
export function navigationDefaults(mode: string, display = headedBrowserAvailable()) {
  return { cian: mode === "desktop" && display, yandex: true };
}
export function navigationPageState(source: NavigationSource, url: string, html: string) {
  if (detectAccessChallenge(url, html)) return "needs_user_action";
  const marker = source === "cian" ? /legacy-commercial-serp-frontend|OfferCard|data-name="(?:Offers|OfferCard)/iu : /offer-card|OffersSerp|SearchPage|search-results|data-test="offer/iu;
  return marker.test(html) ? "results" : /(?:ничего не найдено|объявлений не найдено|нет объявлений)/iu.test(html) ? "empty" : "unknown";
}
const roots: Record<NavigationSource, string[]> = {
  cian: ["cian.ru", "cdn-cian.ru", "cian.site", "servicepipe.tech"],
  yandex: ["realty.yandex.ru", "yastatic.net", "yandex.ru", "yandex.net"],
};
export function allowsNavigationRequest(source: NavigationSource, raw: string, main: boolean) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443") return false;
    const domains = main ? [source === "cian" ? "cian.ru" : "realty.yandex.ru"] : roots[source];
    return domains.some(root => u.hostname === root || u.hostname.endsWith(`.${root}`));
  } catch { return false; }
}
export interface NavigationOptions {
  source: NavigationSource; deadline: number; executablePath?: string; profileRoot?: string;
  settleMs?: number; intervalMs?: number;
  
  open?: (profile: string, headed: boolean) => Promise<BrowserContext>;
}

export async function createBrowserNavigation(options: NavigationOptions) {
  if (options.source === "cian" && !headedBrowserAvailable() && !options.open)
    throw Object.assign(new Error("Для Циана нужен дисплей; пройдите проверку в браузере CRM"), { code: "BROWSER_DISPLAY_UNAVAILABLE" });
  const profile = path.resolve(options.profileRoot ?? process.env.SCRAPER_BROWSER_PROFILE_PATH ?? path.join(process.env.FILE_STORAGE_PATH ?? "data/files", "..", "browser-profiles"), options.source);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const context = await (options.open?.(profile, options.source === "cian") ?? chromium.launchPersistentContext(profile, {
    headless: options.source !== "cian", executablePath: options.executablePath,
    viewport: { width: 1100, height: 760 }, locale: "ru-RU", acceptDownloads: false,
    serviceWorkers: "block", timeout: Math.max(1, Math.min(30000, options.deadline - Date.now())),
  }));
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await context.close(); } };
  try {
    await context.clearPermissions();
    await context.routeWebSocket("**/*", socket => socket.close());
    const page: Page = context.pages()[0] ?? await context.newPage();
    context.on("page", other => { if (other !== page) void other.close().catch(() => undefined); });
    page.on("download", d => { void d.cancel().catch(() => undefined); });
    page.on("dialog", d => { void d.dismiss().catch(() => undefined); });
    
    
    const network = await context.newCDPSession(page);
    network.on("Fetch.requestPaused", async event => {
      const r = event.request;
      try {
        if (closed || Date.now() >= options.deadline || !["GET", "POST"].includes(r.method) || !allowsNavigationRequest(options.source, r.url, event.resourceType === "Document")) throw new Error("NAVIGATION_HOST_DENIED");
        await guardExternalUrl(r.url);
        await network.send("Fetch.continueRequest", { requestId: event.requestId });
      } catch { await network.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => undefined); }
    });
    await network.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    let lastStart = 0;
    let tail = Promise.resolve();
    const transport: RealEstateScraper.Transport = request => {
      const execute = async () => {
        if (request.signal?.aborted) throw Object.assign(new Error("ABORTED"), { code: "ABORTED" });
        if (!allowsNavigationRequest(options.source, request.url, true) || request.method.toUpperCase() !== "GET") throw new Error("NAVIGATION_HOST_DENIED");
        const deadline = Math.min(options.deadline, Date.now() + request.timeout);
        const aborted = () => { void close().catch(() => undefined); };
        request.signal?.addEventListener("abort", aborted, { once: true });
        const timer = setTimeout(aborted, Math.max(1, deadline - Date.now()));
        try {
          await delay(Math.max(0, lastStart + Math.max(1000, options.intervalMs ?? 1500) - Date.now()), undefined, { signal: request.signal });
          if (Date.now() >= deadline || closed) throw Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" });
          lastStart = Date.now();
          let status = 200;
          const onResponse = (r: import("playwright-core").Response) => { if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status(); };
          page.on("response", onResponse);
          try {
            await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: Math.max(1, deadline - Date.now()) });
            const until = Math.min(deadline - 50, Date.now() + (options.settleMs ?? 12000));
            let html = "";
            do {
              if (request.signal?.aborted) throw Object.assign(new Error("ABORTED"), { code: "ABORTED" });
              try { html = await page.content(); } catch {  }
              const state = navigationPageState(options.source, page.url(), html);
              if (state === "results" || state === "empty") break;
              if (Date.now() >= until) break;
              await delay(Math.min(400, Math.max(1, until - Date.now())), undefined, { signal: request.signal });
            } while (!closed);
            if (!allowsNavigationRequest(options.source, page.url(), true)) throw new Error("NAVIGATION_HOST_DENIED");
            if (html.length > 10_000_000) throw new Error("RESPONSE_TOO_LARGE");
            return { data: html, status, url: page.url(), headers: { "content-type": "text/html; charset=utf-8" } };
          } finally { page.off("response", onResponse); }
        } finally { clearTimeout(timer); request.signal?.removeEventListener("abort", aborted); }
      };
      const result = tail.then(execute);
      tail = result.then(() => undefined, () => undefined);
      return result;
    };
    return { transport, close };
  } catch (error) { await close(); throw error; }
}
