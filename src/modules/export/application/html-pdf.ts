import { chromium, type Browser } from "playwright-core";
import { getConfig } from "@/shared/config/env";
import { InfrastructureError, RateLimitError } from "@/shared/errors";

let active = 0;
/** Standalone HTML and data URLs only: no navigation, cookies, scripts, fonts or remote image fetches. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  if (active >= 2) throw new RateLimitError("Формируются другие PDF. Повторите через несколько секунд.");
  active++;
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  const closeBrowser = () => closing ??= browser?.close().catch(() => undefined) ?? Promise.resolve();
  try {
    browser = await chromium.launch({ executablePath: getConfig().SCRAPER_CHROME_PATH, headless: true, timeout: 15_000,
      args: ["--disable-dev-shm-usage", "--disable-background-networking", ...(process.platform === "linux" ? ["--no-sandbox"] : [])] });
    const instance = browser;
    const render = async () => {
      const context = await instance.newContext({ javaScriptEnabled: false, serviceWorkers: "block", offline: true });
      await context.route("**/*", route => route.abort("blockedbyclient"));
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await page.emulateMedia({ media: "print" });
      await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
      return page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    };
    const rendering = render();
    // Closing Chromium interrupts pending protocol calls; observe their late rejection too.
    void rendering.catch(() => undefined);
    return await Promise.race([rendering, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new InfrastructureError("Время формирования PDF истекло. Повторите попытку."));
        void closeBrowser();
      }, 30_000);
    })]);
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError("Не удалось сформировать PDF. Проверьте доступность Chromium на сервере.");
  } finally {
    if (timer) clearTimeout(timer);
    await closeBrowser();
    active--;
  }
}
