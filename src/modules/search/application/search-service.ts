import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { formatDateTime } from "@/shared/time";
import type { Actor } from "@/modules/auth/domain/actor";
import { clientScope, dealScope, needScope, taskScope } from "@/modules/access/domain/scopes";
import { clientSearchWhere } from "@/modules/clients/application/client-queries";


export interface SearchGroup {
  kind: "clients" | "needs" | "properties" | "deals" | "tasks";
  label: string;
  items: { id: string; title: string; subtitle?: string | null; href: string }[];
}

const LIMIT = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dealSearchOr(actor: Actor, q: string): Prisma.DealWhereInput[] {
  const or: Prisma.DealWhereInput[] = [
    { property: { addressText: { contains: q, mode: "insensitive" } } },
    { parties: { some: { client: { AND: [clientScope(actor), { displayName: { contains: q, mode: "insensitive" } }] } } } },
    { parties: { some: { externalPartyName: { contains: q, mode: "insensitive" }, OR: [{ clientId: null }, { client: clientScope(actor) }] } } },
  ];
  if (UUID_RE.test(q)) or.push({ id: q.toLowerCase() });
  return or;
}

export async function globalSearch(actor: Actor, rawQ: string): Promise<{ groups: SearchGroup[] }> {
  const q = rawQ.trim().slice(0, 100);
  if (q.length < 2) return { groups: [] };
  const tz = getConfig().APP_TIMEZONE;

  const [clients, needs, properties, deals, tasks] = await Promise.all([
    db.client.findMany({
      where: { AND: [clientScope(actor), clientSearchWhere(q)] },
      select: { id: true, displayName: true, status: true, contacts: { take: 1, orderBy: { isPrimary: "desc" }, select: { rawValue: true } } },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    db.clientNeed.findMany({
      where: { AND: [needScope(actor), { client: clientScope(actor) }, { OR: [{ district: { contains: q, mode: "insensitive" } }, { locationText: { contains: q, mode: "insensitive" } }, { client: { displayName: { contains: q, mode: "insensitive" } } }] }] },
      select: { id: true, operationType: true, propertyType: true, status: true, client: { select: { displayName: true } } },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    
    db.property.findMany({
      where: { OR: [{ addressText: { contains: q, mode: "insensitive" } }, { district: { contains: q, mode: "insensitive" } }] },
      select: { id: true, addressText: true, status: true, price: true },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    db.deal.findMany({
      where: { AND: [dealScope(actor), { OR: dealSearchOr(actor, q) }] },
      select: { id: true, status: true, property: { select: { addressText: true } }, openedAt: true },
      orderBy: { openedAt: "desc" },
      take: LIMIT,
    }),
    db.task.findMany({
      where: { AND: [taskScope(actor), { title: { contains: q, mode: "insensitive" } }] },
      select: { id: true, title: true, dueAt: true, status: true },
      orderBy: { dueAt: "desc" },
      take: LIMIT,
    }),
  ]);

  return {
    groups: [
      { kind: "clients", label: "Клиенты", items: clients.map((c) => ({ id: c.id, title: c.displayName, subtitle: c.contacts[0]?.rawValue ?? null, href: `/clients/${c.id}` })) },
      { kind: "needs", label: "Потребности", items: needs.map((n) => ({ id: n.id, title: n.client.displayName, subtitle: `${n.operationType} · ${n.propertyType}`, href: `/needs/${n.id}` })) },
      { kind: "properties", label: "Объекты", items: properties.map((p) => ({ id: p.id, title: p.addressText, subtitle: p.price ? `${p.price.toString()} ₽` : null, href: `/properties/${p.id}` })) },
      { kind: "deals", label: "Сделки", items: deals.map((d) => ({ id: d.id, title: d.property.addressText, subtitle: `сделка от ${formatDateTime(d.openedAt, tz)}`, href: `/deals/${d.id}` })) },
      { kind: "tasks", label: "Задачи", items: tasks.map((t) => ({ id: t.id, title: t.title, subtitle: `срок ${formatDateTime(t.dueAt, tz)}`, href: `/tasks/${t.id}` })) },
    ],
  };
}
