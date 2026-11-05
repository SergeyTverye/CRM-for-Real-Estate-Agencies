import http from "node:http";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import type { Actor } from "@/modules/auth/domain/actor";
import { AppError } from "@/shared/errors";
import type { BrowserSessionService } from "@/modules/browser-sessions/application/session-service";

/** Local test harness mounts the REAL React viewer; not a second CRM implementation. */
export async function viewerHarness(service: BrowserSessionService, actor: Actor) {
  const bundle = await build({ entryPoints: ["tests/fixtures/captcha-stand/view.tsx"], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/api/v1/browser-sessions/")) {
        const url = new URL(req.url, "http://localhost");
        const match = /^\/api\/v1\/browser-sessions\/([^/]+)\/(frame|input|complete|cancel)$/u.exec(url.pathname);
        if (!match) { res.writeHead(404); res.end(); return; }
        const id = match[1]!, action = match[2]!;
        let data: unknown;
        if (action === "frame") data = await service.frame(actor, id, url.searchParams.has("after") ? Number(url.searchParams.get("after")) : undefined);
        else if (action === "input") { let body = ""; for await (const chunk of req) body += chunk; data = await service.input(actor, id, JSON.parse(body)); }
        else if (action === "complete") data = await service.complete(actor, id);
        else data = await service.cancel(actor, id);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(data)); return;
      }
      if (req.url === "/view.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(bundle.outputFiles[0]!.contents); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>DEMO: интерактивная сессия</title><div id="root"></div><script src="/view.js"></script></html>');
    } catch (e) {
      res.writeHead(e instanceof AppError ? e.status : 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e instanceof AppError ? e.toJSON() : { code: "TEST_ERROR", message: "Ошибка стенда" } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
