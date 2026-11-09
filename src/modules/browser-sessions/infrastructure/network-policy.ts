import type { SessionSource } from "../domain/session";

const domains: Record<SessionSource, { sites: string[]; static: string[] }> = {
  cian: { sites: ["cian.ru"], static: ["cdn-cian.ru", "cian.site", "static.cian.ru"] },
  avito: { sites: ["avito.ru"], static: ["avito.st", "img.avito.st"] },
  domclick: { sites: ["domclick.ru"], static: ["domclick.com"] },
  yandex: { sites: ["realty.yandex.ru"], static: ["yastatic.net", "avatars.mds.yandex.net"] },
  mirkvartir: { sites: ["mirkvartir.ru"], static: [] },
  onrealt: { sites: ["onrealt.ru"], static: [] },
  youla: { sites: ["youla.ru"], static: ["youla.io"] },
};
const under = (host: string, root: string) => host === root || host.endsWith(`.${root}`);
export function allowsRequest(source: SessionSource, raw: string, method: string, resource: string, navigation: boolean) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const policy = domains[source];
    if (policy.sites.some(d => under(url.hostname, d))) return ["GET", "POST"].includes(method);
    return !navigation && method === "GET" && ["image", "stylesheet", "font", "script"].includes(resource) && policy.static.some(d => under(url.hostname, d));
  } catch { return false; }
}
export function allowsStart(source: SessionSource, raw: string) { return allowsRequest(source, raw, "GET", "document", true); }
