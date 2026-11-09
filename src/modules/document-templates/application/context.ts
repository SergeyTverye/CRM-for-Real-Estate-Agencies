import type { Actor } from "@/modules/auth/domain/actor";
import { clientScope, needScope, dealScope, offerScope, propertyReadScope } from "@/modules/access/domain/scopes";
import type { DbOrTx } from "@/shared/db/client";
import { NotFoundError } from "@/shared/errors";
import { safeGet, type Context } from "../domain/engine";
import { type EntityKind, type Manifest, fail } from "../domain/manifest";

export async function buildContext(tx: DbOrTx, actor: Actor, kind: EntityKind, id: string): Promise<Context> {
  const ctx: Context = { user: { displayName: actor.displayName } };
  const loadClient = async (clientId: string) => {
    const c = await tx.client.findFirst({ where: { id: clientId, ...clientScope(actor) }, select: { displayName: true, clientKind: true, status: true } });
    if (!c) throw new NotFoundError();
    ctx.client = { displayName: c.displayName, kind: c.clientKind, status: c.status };
  };
  const loadNeed = async (needId: string) => {
    const n = await tx.clientNeed.findFirst({ where: { id: needId, ...needScope(actor) }, select: { clientId: true, operationType: true, budgetMax: true, areaMin: true, areaMax: true } });
    if (!n) throw new NotFoundError();
    await loadClient(n.clientId);
    ctx.need = { operationType: n.operationType, budgetMax: n.budgetMax?.toString() ?? null, areaMin: n.areaMin?.toString() ?? null, areaMax: n.areaMax?.toString() ?? null };
  };
  const loadProperty = async (propertyId: string) => {
    const p = await tx.property.findFirst({ where: { id: propertyId, ...propertyReadScope(actor) }, select: { addressText: true, area: true, price: true } });
    if (!p) throw new NotFoundError();
    return { address: p.addressText, area: p.area?.toString() ?? null, price: p.price?.toString() ?? null };
  };
  const loadLegalEntity = async (entityId: string | null) => {
    if (!entityId) return;
    const e = await tx.legalEntity.findUnique({ where: { id: entityId }, select: { displayName: true, requisites: actor.role === "manager" } });
    if (e) ctx.legalEntity = { displayName: e.displayName, ...(actor.role === "manager" ? { requisites: e.requisites } : {}) };
  };
  if (kind === "client") await loadClient(id);
  if (kind === "need") await loadNeed(id);
  if (kind === "property") ctx.property = await loadProperty(id);
  if (kind === "deal") {
    const d = await tx.deal.findFirst({ where: { id, ...dealScope(actor) }, select: { openedAt: true, dealPrice: true, status: true, legalEntityId: true, propertyId: true, parties: { select: { clientId: true } } } });
    if (!d) throw new NotFoundError();
    for (const p of d.parties) if (p.clientId && !await tx.client.count({ where: { id: p.clientId, ...clientScope(actor) } })) throw new NotFoundError();
    ctx.deal = { date: d.openedAt.toISOString(), price: d.dealPrice?.toString() ?? null, status: d.status };
    ctx.property = await loadProperty(d.propertyId); await loadLegalEntity(d.legalEntityId);
  }
  if (kind === "offer") {
    const o = await tx.commercialOffer.findFirst({ where: { id, ...offerScope(actor) }, select: { title: true, introText: true, createdAt: true, clientNeedId: true, legalEntityId: true, items: { orderBy: { position: "asc" }, take: 1001, select: { addressSnapshot: true, areaSnapshot: true, priceSnapshot: true } } } });
    if (!o) throw new NotFoundError();
    await loadNeed(o.clientNeedId); await loadLegalEntity(o.legalEntityId);
    ctx.offer = { title: o.title, introText: o.introText, date: o.createdAt.toISOString() };
    ctx.properties = o.items.map(p => ({ address: p.addressSnapshot, area: p.areaSnapshot?.toString() ?? null, price: p.priceSnapshot?.toString() ?? null }));
  }
  if (kind === "collection") {
    const c = await tx.propertyCollection.findFirst({ where: { id, archivedAt: null, OR: [{ ownerUserId: actor.userId }, { visibility: "team" }] }, select: { name: true, items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 1001, select: { property: { select: { addressText: true, area: true, price: true } }, externalListing: { select: { address: true, areaM2: true, priceRub: true } } } } } });
    if (!c) throw new NotFoundError();
    ctx.collection = { name: c.name };
    ctx.properties = c.items.map(i => ({ address: i.property?.addressText ?? i.externalListing?.address, area: (i.property?.area ?? i.externalListing?.areaM2)?.toString() ?? null, price: (i.property?.price ?? i.externalListing?.priceRub)?.toString() ?? null }));
  }
  return ctx;
}
export function projectContext(ctx: Context, m: Manifest, role: string): Context {
  const output: Context = {};
  for (const f of m.fields) {
    if (!f.roles.includes(role as "manager" | "realtor")) continue;
    const root = f.path.split(".")[0]!, key = f.path.split(".")[1]!;
    if (root === "properties") {
      const rows = ctx.properties;
      if (!Array.isArray(rows) || rows.length > 1000) fail("В документе допускается до 1000 объектов");
      if (!output.properties) output.properties = rows.map(() => ({}));
      rows.forEach((row, i) => { (output.properties as Context[])[i]![key] = safeGet(row, key) ?? null; });
    } else {
      if (!output[root]) output[root] = {};
      (output[root] as Context)[key] = safeGet(ctx, f.path) ?? null;
    }
  }
  if (m.sources.includes("properties") && !output.properties) output.properties = [];
  return output;
}
export function syntheticContext(): Context {
  return { client: { displayName: "ООО «Синтетический клиент»", kind: "company", status: "active" }, need: { operationType: "rent", budgetMax: "150000", areaMin: "40", areaMax: "120" }, deal: { date: "2026-11-05T19:00:00Z", price: "12500000", status: "opened" }, offer: { title: "Предложение помещений", introText: "Только синтетические данные для проверки переноса длинного текста и таблиц.", date: "2026-11-05T19:00:00Z" }, collection: { name: "Помещения для проверки" }, property: { address: "Новосибирск, Синтетическая улица, дом 10", area: "82.5", price: "125000" }, properties: [{ address: "Новосибирск, Синтетическая улица, дом 10, помещение с длинным названием", area: "82.5", price: "125000" }, { address: "Новосибирск, Испытательная улица, дом 20", area: "110", price: "150000" }], legalEntity: { displayName: "ООО «Тестовое агентство»", requisites: "Demo requisites" }, user: { displayName: "Тестовый сотрудник" } };
}
