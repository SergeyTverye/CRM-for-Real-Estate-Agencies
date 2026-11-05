import { z } from "zod";
import { db, transaction, type DbOrTx } from "@/shared/db/client";
import { ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { parseInput, zCode, zExpectedUpdatedAt, zOptDateTime, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { dealScope, documentScope } from "@/modules/access/domain/scopes";
import { resolveTaskResponsible } from "@/modules/tasks/application/task-service";
import { writeAudit } from "@/modules/audit/application/audit";
import { dealChecklistTemplate } from "../domain/checklist-template";

async function accessibleDeal(tx: DbOrTx, actor: Actor, id: string, edit = false) {
  const d = await tx.deal.findFirst({ where: { id, ...dealScope(actor) }, select: { responsibleUserId: true, property: { select: { operationType: true } } } });
  if (!d) throw new NotFoundError();
  if (edit && !isManager(actor) && d.responsibleUserId !== actor.userId) throw new ForbiddenError();
  return d;
}
export async function initializeChecklist(actor: Actor, dealId: string) {
  return transaction(async tx => {
    const d = await accessibleDeal(tx, actor, dealId, true);
    await tx.dealChecklistItem.createMany({ data: dealChecklistTemplate(d.property.operationType).map(t => ({ ...t, dealId, responsibleUserId: d.responsibleUserId })), skipDuplicates: true });
    await writeAudit(tx, { actorUserId: actor.userId, action: "deal.checklist_initialized", entityType: "Deal", entityId: dealId });
    return { id: dealId };
  });
}
export async function getChecklist(actor: Actor, dealId: string) {
  await accessibleDeal(db, actor, dealId);
  const rows = await db.dealChecklistItem.findMany({ where: { dealId }, orderBy: { sortOrder: "asc" }, include: { responsible: { select: { displayName: true } } } });
  const documents = await db.document.findMany({ where: { AND: [documentScope(actor), { dealLinks: { some: { dealId } } }], archivedAt: null }, select: { id: true, originalName: true } });
  return { items: rows.map(r => ({ ...r, documentId: documents.some(d => d.id === r.documentId) ? r.documentId : null })), documents };
}
const updateSchema = z.object({ expectedUpdatedAt: zExpectedUpdatedAt, status: zCode("dealChecklistStatus"), responsibleUserId: zUuid.optional(), checkedAt: zOptDateTime, documentId: zUuid.nullish() });
export async function updateChecklistItem(actor: Actor, dealId: string, itemId: string, input: unknown) {
  const d = parseInput(updateSchema, input);
  return transaction(async tx => {
    const deal = await accessibleDeal(tx, actor, dealId, true);
    const before = await tx.dealChecklistItem.findFirst({ where: { id: itemId, dealId } });
    if (!before) throw new NotFoundError();
    const responsibleUserId = await resolveTaskResponsible(tx, actor, d.responsibleUserId, deal.responsibleUserId);
    if (d.documentId && !await tx.document.count({ where: { AND: [documentScope(actor), { id: d.documentId, archivedAt: null, dealLinks: { some: { dealId } } }] } })) throw new ValidationError("Выберите доступный документ этой сделки");
    const res = await tx.dealChecklistItem.updateMany({ where: { id: itemId, dealId, updatedAt: d.expectedUpdatedAt }, data: { status: d.status, responsibleUserId, checkedAt: d.checkedAt ?? (d.status === "verified" ? new Date() : null), ...(d.documentId !== undefined ? { documentId: d.documentId } : {}) } });
    if (!res.count) throw new StaleUpdateError();
    await writeAudit(tx, { actorUserId: actor.userId, action: "deal.checklist_updated", entityType: "Deal", entityId: dealId, after: { itemId, status: d.status, responsibleUserId } });
    return { id: itemId };
  });
}
