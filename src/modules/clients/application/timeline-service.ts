import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { needScope, leadRequestScope, communicationScope, taskScope, showingScope, offerScope, dealScope, documentScope } from "@/modules/access/domain/scopes";
import { safeTaskTextScope } from "@/modules/notifications/application/notification-context";
import { loadAccessibleClient } from "./client-service";
import { parseInput, zUuid, zDateOnly } from "@/shared/validation";
import { ValidationError, NotFoundError } from "@/shared/errors";
import { getConfig } from "@/shared/config/env";
import { fromDateTimeLocalValue, addDays } from "@/shared/time";
import { labelOf } from "@/shared/codebook";

export const TIMELINE_KINDS = {"request": "Обращение", "communication": "Коммуникация", "need": "Потребность", "stage": "Этап", "match": "Предложенный объект", "task": "Задача", "postdeal": "После сделки", "showing": "Показ", "offer": "КП", "document": "Документ", "collection": "Подборка", "deal": "Сделка"} as const;
export type TimelineKind = keyof typeof TIMELINE_KINDS;
export interface ClientTimelineEvent {
  id: string; at: Date; kind: TimelineKind; title: string; details?: string | null;
  href: string; author: string; status?: string | null; sortKind?: string;
}
export const timelineFiltersSchema = z.object({
  needId: zUuid.optional(), kind: z.enum(Object.keys(TIMELINE_KINDS) as [TimelineKind, ...TimelineKind[]]).optional(),
  employeeId: zUuid.optional(), from: zDateOnly.optional(), to: zDateOnly.optional(),
  cursor: z.string().max(1000).optional(), eventId: zUuid.optional(), pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
const cursorSchema = z.object({ at: z.iso.datetime(), kind: z.string().max(30), id: zUuid });
/** Calendar boundaries are interpreted in the deployment timezone, not in UTC. */
export function timelinePeriod(from?: Date, to?: Date) {
  if (from && to && from > to) throw new ValidationError("Начало периода позже окончания");
  const zone = getConfig().APP_TIMEZONE;
  const midnight = (d: Date) => new Date(fromDateTimeLocalValue(`${d.toISOString().slice(0, 10)}T00:00`, zone));
  return { ...(from ? { gte: midnight(from) } : {}), ...(to ? { lt: midnight(addDays(to, 1)) } : {}) };
}

/** Bounded UNION of primary sources. Every source applies its policy and keyset before LIMIT.
 * No materialized history, no offset pagination, no unbounded history reads. */
export async function getClientTimelinePage(actor: Actor, clientId: string, raw: unknown = {}) {
  await loadAccessibleClient(db, actor, clientId);
  const f = parseInput(timelineFiltersSchema, raw);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (f.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(f.cursor, "base64url").toString("utf8"))); }
    catch { throw new ValidationError("Некорректный курсор истории"); }
  }
  const period = timelinePeriod(f.from, f.to);
  const needs = { AND: [needScope(actor), { clientId }, ...(f.needId ? [{ id: f.needId }] : [])] };
  if (f.needId && !await db.clientNeed.findFirst({ where: needs, select: { id: true } })) throw new NotFoundError();
  const needIds = await db.clientNeed.findMany({ where: { AND: [needScope(actor), { clientId }] }, select: { id: true, operationType: true, propertyType: true, stage: true, status: true } });
  const ids = needIds.filter(n => !f.needId || n.id === f.needId).map(n => n.id);
  const employee = (key: string) => f.employeeId ? { [key]: f.employeeId } : {};
  const enabled = (kind: TimelineKind) => !f.kind || f.kind === kind;
  // Merge order: timestamp DESC, kind DESC, UUID DESC. Source-specific cursor avoids tied timestamp loss.
  const window = (field: string, kind: string) => ({ AND: [
    { [field]: period },
    ...(f.eventId ? [{ id: f.eventId }] : []),
    ...(cursor ? [{ OR: [ { [field]: { lt: new Date(cursor.at) } },
      ...(kind <= cursor.kind ? [{ [field]: new Date(cursor.at), ...(kind === cursor.kind ? { id: { lt: cursor.id } } : {}) }] : []) ] }] : []),
  ] });
  const order = (field: string) => [{ [field]: "desc" as const }, { id: "desc" as const }];
  const take = f.pageSize + 1;
  const events: ClientTimelineEvent[] = [];
  const author = { select: { displayName: true } };
  const add = (e: ClientTimelineEvent) => events.push(e);
  // Deal has no Need FK. Use explicit task links or the same client + a property
  // proposed, shown or included in an offer for the selected need.
  const dealContext: Prisma.DealWhereInput = { AND: [
    { parties: { some: { clientId } } },
    ...(f.needId ? [{ OR: [
      { taskLinks: { some: { task: { needLinks: { some: { clientNeedId: f.needId } } } } } },
      { property: { OR: [ { matches: { some: { clientNeedId: f.needId } } }, { showings: { some: { clientNeedId: f.needId } } }, { offerItems: { some: { offer: { clientNeedId: f.needId } } } } ] } },
    ] }] : []),
  ] };
  const taskContext: Prisma.TaskWhereInput = f.needId ? { OR: [
    { needLinks: { some: { clientNeedId: f.needId } } }, { showingLinks: { some: { showing: { clientNeedId: f.needId } } } },
    { offerLinks: { some: { offer: { clientNeedId: f.needId } } } },
    { dealLinks: { some: { deal: dealContext } } }, { agreementLinks: { some: { agreement: { deal: dealContext } } } },
  ] } : { OR: [
    { clientLinks: { some: { clientId } } }, { needLinks: { some: { need: { clientId } } } },
    { showingLinks: { some: { showing: { need: { clientId } } } } }, { offerLinks: { some: { offer: { need: { clientId } } } } },
    { agreementLinks: { some: { agreement: { clientId } } } }, { dealLinks: { some: { deal: { parties: { some: { clientId } } } } } },
  ] };
  await Promise.all([
    enabled("request") ? (async () => {
      const rows = await db.leadRequest.findMany({ where: { AND: [leadRequestScope(actor), { clientId, ...(f.needId ? { clientNeedId: f.needId } : {}) }, employee("createdBy"), window("occurredAt", "request")] }, include: { creator: author }, orderBy: order("occurredAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.occurredAt, kind: "request", title: "Обращение", details: r.summary, status: labelOf("leadResult", r.resultCode), author: r.creator.displayName, href: `/requests/${r.id}` }));
    })() : null,
    enabled("communication") ? (async () => {
      const rows = await db.communication.findMany({ where: { AND: [communicationScope(actor), { clientId, ...(f.needId ? { clientNeedId: f.needId } : {}) }, employee("authorUserId"), window("occurredAt", "communication")] }, include: { author }, orderBy: order("occurredAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.occurredAt, kind: "communication", title: labelOf("communicationType", r.communicationType), details: r.comment, status: r.resultCode ? labelOf("communicationResult", r.resultCode) : null, author: r.author.displayName, href: `/clients/${clientId}?tab=history&kind=communication&eventId=${r.id}#${r.id}` }));
    })() : null,
    enabled("need") ? (async () => {
      const rows = await db.clientNeed.findMany({ where: { AND: [needs, employee("createdBy"), window("openedAt", "need")] }, include: { creator: author }, orderBy: order("openedAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.openedAt, kind: "need", title: "Открыта потребность", status: labelOf("needStatus", r.status), author: r.creator.displayName, href: `/needs/${r.id}` }));
    })() : null,
    enabled("stage") ? (async () => {
      const rows = await db.needStageHistory.findMany({ where: { AND: [{ need: needs }, employee("changedBy"), window("occurredAt", "stage")] }, include: { changer: author }, orderBy: order("occurredAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.occurredAt, kind: "stage", title: `Этап: ${labelOf("needStage", r.toStage)}`, details: r.comment, status: r.toStatus ? labelOf("needStatus", r.toStatus) : null, author: r.changer.displayName, href: `/needs/${r.clientNeedId}` }));
    })() : null,
    enabled("match") ? (async () => {
      const rows = await db.needPropertyMatch.findMany({ where: { AND: [{ need: needs }, employee("createdBy"), window("offeredAt", "match")] }, include: { creator: author, property: { select: { addressText: true } } }, orderBy: order("offeredAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.offeredAt, kind: "match", title: `Предложен объект: ${r.property.addressText}`, details: r.comment, status: labelOf("matchStatus", r.status), author: r.creator.displayName, href: `/needs/${r.clientNeedId}` }));
    })() : null,
    ...(["task", "postdeal"] as const).flatMap(kind => [false, true].map(completed => enabled(kind) ? (async () => {
      const key = completed ? `${kind}_completed` : kind;
      const field = completed ? "completedAt" : "createdAt";
      const rows = await db.task.findMany({ where: { AND: [taskScope(actor), safeTaskTextScope(actor), taskContext,
        kind === "postdeal" ? { taskType: "postdeal" } : { taskType: { not: "postdeal" } },
        employee("createdBy"), window(field, key), ...(completed ? [{ completedAt: { not: null } }] : [])] }, include: { creator: author }, orderBy: order(field), take });
      rows.forEach(r => add({ id: r.id, at: completed ? r.completedAt! : r.createdAt, kind, title: `${completed ? "Выполнено" : kind === "postdeal" ? "После сделки" : "Задача"}: ${r.title}`, details: completed ? r.resultComment : null, status: labelOf("taskStatus", r.status), author: r.creator.displayName, href: `/tasks/${r.id}`, ...{ sortKind: key } }));
    })() : null)),
    ...[false, true].map(occurred => enabled("showing") ? (async () => {
      const field = occurred ? "occurredAt" : "scheduledAt";
      const rows = await db.showing.findMany({ where: { AND: [showingScope(actor), { need: needs }, { occurredAt: occurred ? { not: null } : null }, employee("createdBy"), window(field, "showing")] }, include: { creator: author, property: { select: { addressText: true } } }, orderBy: order(field), take });
      rows.forEach(r => add({ id: r.id, at: r.occurredAt ?? r.scheduledAt, kind: "showing", title: `Показ: ${r.property.addressText}`, status: labelOf("showingStatus", r.status), author: r.creator.displayName, href: `/showings/${r.id}` }));
    })() : null),
    ...[false, true].map(sent => enabled("offer") ? (async () => {
      const field = sent ? "sentAt" : "createdAt";
      const rows = await db.commercialOffer.findMany({ where: { AND: [offerScope(actor), { need: needs }, { sentAt: sent ? { not: null } : null }, employee("createdBy"), window(field, "offer")] }, include: { creator: author }, orderBy: order(field), take });
      rows.forEach(r => add({ id: r.id, at: r.sentAt ?? r.createdAt, kind: "offer", title: `КП: ${r.title ?? "без названия"}`, status: labelOf("offerStatus", r.status), author: r.creator.displayName, href: `/offers/${r.id}` }));
    })() : null),
    enabled("deal") ? (async () => {
      const rows = await db.deal.findMany({ where: { AND: [dealScope(actor), dealContext, employee("createdBy"), window("openedAt", "deal")] }, include: { creator: author, property: { select: { addressText: true } } }, orderBy: order("openedAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.openedAt, kind: "deal", title: `Сделка: ${r.property.addressText}`, status: labelOf("dealStatus", r.status), author: r.creator.displayName, href: `/deals/${r.id}` }));
    })() : null,
    enabled("collection") ? (async () => {
      const rows = await db.propertyCollectionNeed.findMany({ where: { AND: [{ need: needs }, { collection: { archivedAt: null, OR: [{ ownerUserId: actor.userId }, { visibility: "team" }] } }, employee("linkedBy"), window("linkedAt", "collection")] }, include: { linker: author, collection: { select: { name: true, archivedAt: true } } }, orderBy: order("linkedAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.linkedAt, kind: "collection", title: `Подборка: ${r.collection.name}`, status: r.collection.archivedAt ? "В архиве" : "Связана с потребностью", author: r.linker.displayName, href: `/collections/${r.collectionId}` }));
    })() : null,
    enabled("document") ? (async () => {
      const context = { OR: [ ...(!f.needId ? [{ clientLinks: { some: { clientId } } }, { dealLinks: { some: { deal: { parties: { some: { clientId } } } } } }, { agreementLinks: { some: { agreement: { clientId } } } }] : []),
        { dealLinks: { some: { deal: dealContext } } }, { agreementLinks: { some: { agreement: { deal: dealContext } } } },
        { needLinks: { some: { clientNeedId: { in: ids } } } }, { showingLinks: { some: { showing: { clientNeedId: { in: ids } } } } }, { offerLinks: { some: { offer: { clientNeedId: { in: ids } } } } },
      ] };
      const rows = await db.document.findMany({ where: { AND: [documentScope(actor), context, employee("uploadedBy"), window("createdAt", "document")] }, select: { id: true, originalName: true, createdAt: true, archivedAt: true, uploader: author }, orderBy: order("createdAt"), take });
      rows.forEach(r => add({ id: r.id, at: r.createdAt, kind: "document", title: r.originalName, status: r.archivedAt ? "В архиве" : "Загружен", author: r.uploader.displayName, href: `/api/v1/documents/${r.id}/download` }));
    })() : null,
  ]);
  const sortKind = (e: ClientTimelineEvent) => e.sortKind ?? e.kind;
  events.sort((a, b) => +b.at - +a.at || (sortKind(a) < sortKind(b) ? 1 : sortKind(a) > sortKind(b) ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const items = events.slice(0, f.pageSize), last = items.at(-1);
  return { items, needs: needIds, nextCursor: events.length > f.pageSize && last ? Buffer.from(JSON.stringify({ at: last.at.toISOString(), kind: sortKind(last), id: last.id })).toString("base64url") : null };
}
