import { z } from "zod";
import { db, type DbOrTx } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { clientScope, taskScope } from "@/modules/access/domain/scopes";
import { loadAccessibleClient } from "@/modules/clients/application/client-service";
import { loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { getClientTimelinePage } from "@/modules/clients/application/timeline-service";
import { safeTaskTextScope } from "@/modules/notifications/application/notification-context";
import { NotFoundError } from "@/shared/errors";
import { MAX_ROWS, safeText, taskProposal, offerProposal, type ChatContext, type RecordLink } from "../domain/policy";
export const collectionScope = (actor: Actor) => ({ archivedAt: null, OR: [{ ownerUserId: actor.userId }, { visibility: "team" }] });
export async function checkContext(actor: Actor, c: ChatContext, tx: DbOrTx = db) {
    if (c.kind === "client")
        await loadAccessibleClient(tx, actor, c.id!);
    if (c.kind === "need") {
        const n = await loadAccessibleNeed(tx, actor, c.id!);
        await loadAccessibleClient(tx, actor, n.clientId);
    }
    if (c.kind === "collection" && !await tx.propertyCollection.findFirst({ where: { id: c.id, ...collectionScope(actor) }, select: { id: true } }))
        throw new NotFoundError();
}
export async function modelContext(actor: Actor, c: ChatContext) {
    await checkContext(actor, c);
    if (c.kind === "need") {
        const n = await loadAccessibleNeed(db, actor, c.id!);
        return { kind: c.kind, id: n.id, clientId: n.clientId, operation: n.operationType, areaMin: n.areaMin?.toString(), areaMax: n.areaMax?.toString(), budgetMin: n.budgetMin?.toString(), budgetMax: n.budgetMax?.toString() };
    }
    if (c.kind === "collection") {
        const rows = await db.propertyCollectionItem.findMany({ where: { collectionId: c.id }, select: { propertyId: true, externalListingId: true }, take: MAX_ROWS, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
        return { ...c, items: rows };
    }
    return c;
}
const querySchema = z.object({ query: z.string().max(120).optional() }).strict();
const clientSchema = z.object({ clientId: z.uuid().optional() }).strict();
export const listingScope = (actor: Actor) => ({ OR: [{ bookmarks: { some: { userId: actor.userId } } }, { selections: { some: { addedBy: actor.userId, need: { client: clientScope(actor) } } } }, { collectionItems: { some: { collection: collectionScope(actor) } } }] });
export async function validateProposal(actor: Actor, type: string, raw: unknown, tx: DbOrTx = db) {
    if (type === "task") {
        const p = taskProposal.parse(raw);
        await loadAccessibleClient(tx, actor, p.clientId);
        return { ...p, title: safeText(p.title), description: p.description ? safeText(p.description) : undefined };
    }
    const p = offerProposal.parse(raw);
    const n = await loadAccessibleNeed(tx, actor, p.clientNeedId);
    await loadAccessibleClient(tx, actor, n.clientId);
    if (new Set(p.propertyIds).size !== p.propertyIds.length || await tx.property.count({ where: { id: { in: p.propertyIds }, archivedAt: null } }) !== p.propertyIds.length)
        throw new NotFoundError();
    return { ...p, title: safeText(p.title) };
}
export async function executeTool(actor: Actor, sessionId: string, name: string, raw: unknown) {
    const identities=await db.client.findMany({where:clientScope(actor),select:{displayName:true,contactPersons:{select:{fullName:true}}},take:500});
    const names=identities.flatMap(c=>[c.displayName,...c.contactPersons.map(p=>p.fullName)]);
    const safe=(text:string)=>safeText(text,names);
    const links: RecordLink[] = [];
    const link = (id: string, label: string, href: string) => { links.push({ id, label, href }); return id; };
    let data: unknown;
    if (name === "find_clients") {
        const p = querySchema.parse(raw);
        const rows = await db.client.findMany({ where: { AND: [clientScope(actor), { archivedAt: null }, ...(p.query ? [{ displayName: { contains: p.query, mode: "insensitive" as const } }] : [])] }, select: { id: true, displayName: true, status: true }, take: MAX_ROWS, orderBy: { id: "asc" } });
        data = rows.map((r, i) => ({ id: link(r.id, r.displayName, `/clients/${r.id}`), label: `Клиент ${i + 1}`, status: r.status }));
    }
    else if (name === "get_tasks") {
        const p = clientSchema.parse(raw);
        if (p.clientId)
            await loadAccessibleClient(db, actor, p.clientId);
        const rows = await db.task.findMany({ where: { AND: [taskScope(actor), safeTaskTextScope(actor), ...(p.clientId ? [{ clientLinks: { some: { clientId: p.clientId } } }] : [{ responsibleUserId: actor.userId }])] }, select: { id: true, title: true, dueAt: true, status: true }, take: MAX_ROWS, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
        data = rows.map(r => ({ id: link(r.id, r.title, `/tasks/${r.id}`), title: safe(r.title), dueAt: r.dueAt, status: r.status }));
    }
    else if (name === "client_timeline") {
        const p = z.object({ clientId: z.uuid() }).strict().parse(raw);
        const page = await getClientTimelinePage(actor, p.clientId, { pageSize: MAX_ROWS });
        data = page.items.map(r => ({ id: link(r.id, r.title, r.href), at: r.at, kind: r.kind, title: safe(r.title), status: r.status }));
    }
    else if (name === "find_collections") {
        const p = querySchema.parse(raw);
        const rows = await db.propertyCollection.findMany({ where: { ...collectionScope(actor), ...(p.query ? { name: { contains: p.query, mode: "insensitive" as const } } : {}) }, select: { id: true, name: true, items: { take: 4, select: { propertyId: true, externalListingId: true } } }, take: MAX_ROWS, orderBy: { id: "asc" } });
        data = rows.map(r => ({ id: link(r.id, r.name, `/collections/${r.id}`), name: safe(r.name), items: r.items }));
    }
    else if (name === "find_listings" || name === "compare_properties") {
        const p = name === "find_listings" ? querySchema.parse(raw) : z.object({ ids: z.array(z.uuid()).min(2).max(4) }).strict().parse(raw);
        const ids = "ids" in p ? p.ids : undefined;
        const q = "query" in p ? p.query : undefined;
        const own = await db.property.findMany({ where: { responsibleUserId: actor.userId, archivedAt: null, ...(ids ? { id: { in: ids } } : {}), ...(q ? { addressText: { contains: q, mode: "insensitive" as const } } : {}) }, select: { id: true, addressText: true, area: true, price: true, floor: true, operationType: true }, take: MAX_ROWS, orderBy: { id: "asc" } });
        const saved = await db.externalListing.findMany({ where: { ...listingScope(actor), ...(ids ? { id: { in: ids } } : {}), ...(q ? { address: { contains: q, mode: "insensitive" as const } } : {}) }, select: { id: true, address: true, areaM2: true, priceRub: true, priceUnit: true, floorNumber: true, description: true }, take: MAX_ROWS - own.length, orderBy: { id: "asc" } });
        data = [...own.map(r => ({ id: link(r.id, r.addressText, `/properties/${r.id}`), address: safe(r.addressText), area: r.area?.toString(), price: r.price?.toString(), operation: r.operationType, floor: r.floor })), ...saved.map(r => ({ id: link(r.id, r.address ?? "Объявление", `/property-search?listingId=${r.id}`), address: safe(r.address ?? ""), area: r.areaM2?.toString(), price: r.priceRub?.toString(), unit: r.priceUnit, floor: r.floorNumber, untrusted_data: safe(r.description ?? "").slice(0, 600) }))];
        if (ids && (data as unknown[]).length !== new Set(ids).size)
            throw new NotFoundError();
    }
    else if (name === "prepare_task" || name === "prepare_offer") {
        const type = name === "prepare_task" ? "task" : "offer";
        const payload = await validateProposal(actor, type, raw);
        const action = await db.aiPendingAction.create({ data: { sessionId, actionType: type, payload: JSON.parse(JSON.stringify(payload)), expiresAt: new Date(Date.now() + 86400000) } });
        data = { id: action.id, status: "proposed", notice: "Черновик. Требуется подтверждение сотрудника в UI." };
    }
    else
        return { data: { error: "TOOL_NOT_ALLOWED" }, links };
    return { data, links };
}
