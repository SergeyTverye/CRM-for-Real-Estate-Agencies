import http from "node:http";
import type { AddressInfo } from "node:net";
import type { BrowserOptions } from "@/modules/browser-sessions/infrastructure/playwright-browser";

/** Controlled synthetic source. No third-party requests or real CAPTCHA solving. */
export async function captchaStand(options: { cian?: boolean; blockNextPage?: boolean } = {}) {
  let searchPath = "/listings";
  let requests = 0, proofAccepted = 0, verifiedRequests = 0;
  const server = http.createServer(async (req, res) => {
    requests++;
    const requestUrl = new URL(req.url ?? "/", "http://stand");
    if (requestUrl.pathname === "/cat.php" && requestUrl.searchParams.get("p") !== "2") searchPath = req.url!;
    res.setHeader("cache-control", "no-store");
    if (req.url === "/redirect-forbidden") { res.writeHead(303, { location: "https://example.org/forbidden" }); res.end(); return; }
    if (req.url === "/verify" && req.method === "POST") {
      let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 1024) break; }
      if (new URLSearchParams(body).get("proof") === "человек") {
        proofAccepted++;
        res.writeHead(303, { location: searchPath, "set-cookie": "stand_verified=yes; HttpOnly; SameSite=Strict; Path=/" }); res.end(); return;
      }
    }
    let verified = /(?:^|;\s*)stand_verified=yes(?:;|$)/u.test(req.headers.cookie ?? "");
    if (verified) verifiedRequests++;
    if (options.blockNextPage && requestUrl.searchParams.get("p") === "2") verified = false;
    if (verified && options.cian) {
      const next = new URL(searchPath, "https://www.cian.ru"); next.searchParams.set("p", "2");
      const data = [{ key: "initialState", value: { results: { offers: [{ cianId: "99110001", fullUrl: "https://www.cian.ru/sale/commercial/99110001/", officeType: "office", dealType: "sale", totalArea: 100, floorNumber: 1, bargainTerms: { price: 5000000 }, geo: { address: [{ type: "location", name: "Новосибирск", isFormingAddress: true }] }, description: "DEMO: синтетический офис", photos: [] }], totalOffers: options.blockNextPage ? 2 : 1, paginationUrls: options.blockNextPage ? [next.href] : [] } } }];
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<!doctype html><meta charset="utf-8"><h1>DEMO: выдача офисов</h1><script>window['legacy-commercial-serp-frontend'] = [].concat(${JSON.stringify(data)});</script>`); return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Синтетическая площадка</title><style>body{font:22px sans-serif;margin:40px;background:#fff}input,button{font:22px sans-serif;padding:12px}form{position:absolute;left:80px;top:120px}input{display:block;width:320px;margin:15px 0}button{width:350px}h1{font-size:30px}</style>${verified ? '<h1>Выдача объявлений</h1><article data-listing="synthetic-1" data-area="100" data-price="5000000">Офис, 100 м² — 5 000 000 ₽</article>' : '<h1 data-needs-user-action>Проверка: Я не робот</h1><form action="/verify" method="post"><label>Введите «человек»<input name="proof" autocomplete="off"></label><button>Я не робот</button></form>'}<a href="https://example.org/forbidden" style="position:absolute;left:80px;top:400px">Чужой домен</a><a href="/download" download style="position:absolute;left:80px;top:470px">Скачать файл</a></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const network: NonNullable<BrowserOptions["network"]> = {
    allows: (_source, raw, method) => { try { return new URL(raw).origin === origin && ["GET", "POST"].includes(method); } catch { return false; } },
    transport: async (raw, options = {}) => {
      if (new URL(raw).origin !== origin) throw new Error("STAND_ONLY");
      return new Promise((resolve, reject) => {
        const req = http.request(raw, { method: options.method, headers: options.headers, signal: options.signal }, res => {
          const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk));
          res.on("end", () => resolve({ data: Buffer.concat(chunks), headers: res.headers, status: res.statusCode ?? 500, url: raw }));
          res.on("error", reject);
        });
        req.on("error", reject); req.end(options.body);
      });
    },
  };
  return { origin, network, stats: () => ({ proofAccepted, verifiedRequests }), requests: () => requests, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(e => e ? reject(e) : resolve()); }) };
}
