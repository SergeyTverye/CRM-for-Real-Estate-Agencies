import { lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { safeRequest } from "@/shared/net/ssrf";
import type { BrowserFactory, SessionFrame, SessionInput, SessionSource } from "../domain/session";
import { allowsRequest, allowsStart } from "./network-policy";

type Transport = typeof safeRequest;
/** Crash leftovers expire after the maximum lifetime. Never follow links or leave the OS temp directory. */
export async function reapExpiredSessionProfiles(now = Date.now()) {
  const root = path.resolve(os.tmpdir());
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!/^crm-browser-session-[A-Za-z0-9]{6}$/u.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const target = path.resolve(root, entry.name);
    if (path.dirname(target) !== root) continue;
    try {
      const stat = await lstat(target);
      if (!stat.isSymbolicLink() && now - (stat.birthtimeMs || stat.mtimeMs) > 20 * 60_000 + 60_000) await rm(target, { recursive: true, force: true, maxRetries: 3 });
    } catch { /* A different shutdown may have already removed it. No paths/secrets are logged. */ }
  }
}
export interface BrowserOptions {
  executablePath?: string;
  /** Internal test observation only; profile paths never enter API metadata or logs. */
  profileCreated?: (profile: string) => void;
  /** Test dependency injection only; never configurable by HTTP or a production ENV switch. */
  network?: { allows: typeof allowsRequest; transport: Transport };
}
export class PlaywrightSessionBrowser implements BrowserFactory {
  constructor(private readonly options: BrowserOptions = {}) {}
  async open(startUrl: string, source: SessionSource, signal: AbortSignal, onViolation: () => void) {
    const allowed = this.options.network?.allows ?? allowsRequest;
    if (!(this.options.network ? allowed(source, startUrl, "GET", "document", true) : allowsStart(source, startUrl))) throw new Error("SESSION_HOST_DENIED");
    await reapExpiredSessionProfiles();
    const profile = await mkdtemp(path.join(os.tmpdir(), "crm-browser-session-"));
    let context: BrowserContext | undefined;
    let closing: Promise<void> | undefined;
    let frame: SessionFrame | null = null;
    let sequence = 0;
    const close = () => closing ??= (async () => {
      frame = null;
      try { await context?.close(); }
      finally {
        const target = path.resolve(profile);
        if (path.dirname(target) !== path.resolve(os.tmpdir()) || !/^crm-browser-session-[A-Za-z0-9]{6}$/u.test(path.basename(target))) throw new Error("INVALID_PROFILE_PATH");
        await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    })();
    const aborted = () => { if (context) void close().catch(() => undefined); };
    signal.addEventListener("abort", aborted, { once: true });
    try {
      this.options.profileCreated?.(profile);
      context = await chromium.launchPersistentContext(profile, {
        executablePath: this.options.executablePath ?? process.env.SCRAPER_CHROME_PATH,
        headless: true, timeout: 30_000, chromiumSandbox: true, acceptDownloads: false, serviceWorkers: "block",
        viewport: { width: 1280, height: 800 }, locale: "ru-RU", permissions: [],
        args: [...(this.options.network ? ["--host-resolver-rules=MAP * ~NOTFOUND"] : []), "--renderer-process-limit=2", "--js-flags=--max-old-space-size=192", "--disable-background-networking", "--disable-quic", "--disable-extensions", "--disable-sync", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
      });
      if (signal.aborted) throw new Error("SESSION_ABORTED");
      await context.clearPermissions();
      const page = context.pages()[0] ?? await context.newPage();
      context.on("page", other => { if (other !== page) void other.close().catch(() => undefined); });
      page.on("popup", popup => { void popup.close().catch(() => undefined); });
      page.on("download", download => { void download.cancel().catch(() => undefined); });
      page.on("dialog", dialog => { void dialog.dismiss().catch(() => undefined); });
      page.on("filechooser", chooser => { void chooser.setFiles([]).catch(() => undefined); });
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(20_000);
      await context.routeWebSocket("**/*", socket => socket.close());
      let redirectHops = 0;
      await context.route("**/*", async route => {
        const request = route.request(); const navigation = request.isNavigationRequest();
        try {
          if (signal.aborted || request.frame().page() !== page || !allowed(source, request.url(), request.method(), request.resourceType(), navigation)) {
            await route.abort(); if (navigation && !signal.aborted) onViolation(); return;
          }
          // Pin each connection to a public resolved IP, including redirect hops and nested frames.
          // allHeaders includes browser-managed HttpOnly cookies; nothing is serialized or logged.
          const headers = await request.allHeaders();
          const response = await (this.options.network?.transport ?? safeRequest)(request.url(), {
            method: request.method() as "GET" | "POST", headers, body: request.postData() ?? undefined,
            signal, timeoutMs: 15_000, maxBytes: 8_000_000, followRedirects: false,
          });
          const outgoing: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value === undefined || ["content-encoding", "content-length", "transfer-encoding", "connection", "alt-svc"].includes(key)) continue;
            outgoing[key] = Array.isArray(value) ? value.join("\n") : String(value);
          }
          // File downloads, including Content-Disposition responses, never reach the user agent.
          if (/attachment/iu.test(outgoing["content-disposition"] ?? "")) { await route.abort(); return; }
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            // Chromium follows an intercepted HTTP redirect without re-entering route().
            // Never give it a 3xx: apply cookies in an inert same-origin response, then
            // start a separate guarded navigation. Cross-origin/subresource redirects fail closed.
            const target = outgoing.location && new URL(outgoing.location, request.url()).href;
            if (!navigation || !target || ++redirectHops > 5 || !allowed(source, target, "GET", "document", true) || !["GET", "POST"].includes(request.method()) || ([307, 308].includes(response.status) && request.method() !== "GET")) {
              await route.abort(); if (navigation) onViolation(); return;
            }
            delete outgoing.location;
            const sourceFrame = request.frame();
            // Wait for the inert response to commit before starting the next navigation;
            // otherwise Chromium can abort the new GET while committing the form POST.
            void page.waitForEvent("framenavigated", { predicate: frame => frame === sourceFrame && frame.url() === request.url(), timeout: 20_000 })
              .then(async frame => { await frame.waitForLoadState("domcontentloaded", { timeout: 20_000 }); if (!signal.aborted) await frame.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 }); })
              .catch(() => { if (!signal.aborted) onViolation(); });
            await route.fulfill({ status: 200, headers: { ...outgoing, "content-type": "text/html; charset=utf-8" }, body: "<!doctype html><title>Переход</title>" });
            return;
          }
          if (navigation) redirectHops = 0;
          await route.fulfill({ status: response.status, headers: outgoing, body: response.data });
        } catch { await route.abort().catch(() => undefined); }
      });
      page.on("framenavigated", navigated => {
        if (navigated === page.mainFrame() && !allowed(source, page.url(), "GET", "document", true) && page.url() !== "about:blank" && !signal.aborted) onViolation();
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.enable");
      await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
      cdp.on("Page.screencastFrame", event => {
        if (!signal.aborted && event.data.length < 800_000) frame = { sequence: ++sequence, jpeg: event.data, width: 1280, height: 800 };
        void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
      });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 65, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
      if (signal.aborted) throw new Error("SESSION_ABORTED");
      return {
        page, context, frame: () => frame,
        async input(event: SessionInput) {
          if (signal.aborted) throw new Error("SESSION_CLOSED");
          if (event.type === "click") {
            await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: event.x, y: event.y, button: "left", clickCount: 1 });
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: event.x, y: event.y, button: "left", clickCount: 1 });
          } else if (event.type === "scroll") await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: event.x, y: event.y, deltaX: 0, deltaY: event.deltaY });
          else if (event.type === "text") await cdp.send("Input.insertText", { text: event.text });
          else {
            const codes: Record<string, number> = { Enter: 13, Tab: 9, Backspace: 8, Delete: 46, Escape: 27, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35, Space: 32 };
            await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: event.key === "Space" ? " " : event.key, windowsVirtualKeyCode: codes[event.key], ...(event.key === "Enter" ? { text: "\r" } : {}) });
            await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: event.key === "Space" ? " " : event.key, windowsVirtualKeyCode: codes[event.key] });
          }
        },
        close: async () => { signal.removeEventListener("abort", aborted); await close(); },
      };
    } catch {
      signal.removeEventListener("abort", aborted); await close();
      throw new Error("ISOLATED_BROWSER_UNAVAILABLE");
    }
  }
}
