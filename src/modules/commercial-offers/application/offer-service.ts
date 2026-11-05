import { redactClientLink } from "@/modules/access/application/redact-client";
import { z } from "zod";
import { db, transaction, type DbOrTx } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError, ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zCode, zExpectedUpdatedAt, zOptDateOnly, zOptMoney, zOptText, zPagination, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canSeeClient, clientScope, documentScope, offerScope } from "@/modules/access/domain/scopes";
import { writeAudit } from "@/modules/audit/application/audit";
import { loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { insertTask } from "@/modules/tasks/application/task-service";

/**
 * UC-15 CreateCommercialOffer (FR-39, ТЗ 29.17, 37.20).
 * КП — самостоятельная сущность: ClientNeed → CommercialOffer → CommercialOfferItem → Property.
 * Snapshot цены/адреса/площади/условий фиксируется при добавлении объекта и не меняется вслед
 * за текущей карточкой Property. Позиции редактируются только в черновике.
 * Для prepared/sent от имени предприятия обязателен LegalEntity. Контакты собственника в КП не попадают.
 */

const itemInputSchema = z.object({
  propertyId: zUuid,
  priceSnapshot: zOptMoney,
  termsSnapshot: zOptText(4000),
  comment: zOptText(2000),
});

const createSchema = z.object({
  clientNeedId: zUuid,
  items: z.array(itemInputSchema).min(1, "Выберите хотя бы один объект").max(30),
  title: zOptText(300),
  introText: zOptText(8000),
  notes: zOptText(4000),
  legalEntityId: zUuid.nullish(),
  expiresAt: zOptDateOnly,
  generationSource: z.enum(["manual", "template"]).default("manual"),
});

const OPERATION_LABEL: Record<string, string> = { sale: "продажа", rent: "аренда" };

async function snapshotOf(tx: DbOrTx, propertyId: string) {
  const p = await tx.property.findUnique({
    where: { id: propertyId },
    select: { id: true, addressText: true, price: true, area: true, operationType: true, floor: true, floorsTotal: true, roomsCount: true, commercialPurpose: true, status: true },
  });
  if (!p) throw new NotFoundError("Объект не найден");
  const terms = [
    OPERATION_LABEL[p.operationType] ?? p.operationType,
    p.floor !== null ? `этаж ${p.floor}${p.floorsTotal ? `/${p.floorsTotal}` : ""}` : null,
    p.roomsCount !== null ? `комнат: ${p.roomsCount}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return { property: p, snapshot: { priceSnapshot: p.price, addressSnapshot: p.addressText, areaSnapshot: p.area, termsSnapshot: terms || null } };
}

async function assertLegalEntity(tx: DbOrTx, id: string | null | undefined) {
  if (!id) return;
  const le = await tx.legalEntity.findUnique({ where: { id }, select: { isActive: true } });
  if (!le?.isActive) throw new ValidationError(undefined, { legalEntityId: ["Юридическое лицо не найдено или неактивно"] });
}

export async function createOffer(actor: Actor, input: unknown): Promise<{ id: string }> {
  const d = parseInput(createSchema, input);
  const ids = d.items.map((i) => i.propertyId);
  if (new Set(ids).size !== ids.length) throw new ValidationError(undefined, { items: ["Объект указан дважды"] });
  return transaction(async (tx) => {
    const need = await loadAccessibleNeed(tx, actor, d.clientNeedId);
    await assertLegalEntity(tx, d.legalEntityId);
    const offer = await tx.commercialOffer.create({
      data: {
        clientNeedId: need.id,
        responsibleUserId: need.responsibleUserId,
        createdBy: actor.userId,
        legalEntityId: d.legalEntityId ?? null,
        status: "draft",
        title: d.title,
        introText: d.introText,
        notes: d.notes,
        expiresAt: d.expiresAt,
        generationSource: d.generationSource,
      },
      select: { id: true },
    });
    let position = 1;
    for (const item of d.items) {
      const { snapshot } = await snapshotOf(tx, item.propertyId);
      await tx.commercialOfferItem.create({
        data: {
          commercialOfferId: offer.id,
          propertyId: item.propertyId,
          position: position++,
          priceSnapshot: item.priceSnapshot ?? snapshot.priceSnapshot,
          addressSnapshot: snapshot.addressSnapshot,
          areaSnapshot: snapshot.areaSnapshot,
          termsSnapshot: item.termsSnapshot ?? snapshot.termsSnapshot,
          comment: item.comment,
        },
      });
    }
    return offer;
  });
}

async function loadOffer(tx: DbOrTx, actor: Actor, id: string) {
  const o = await tx.commercialOffer.findFirst({ where: { id, ...offerScope(actor) } });
  if (!o) throw new NotFoundError();
  return o;
}

const updateSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  title: zOptText(300),
  introText: zOptText(8000),
  notes: zOptText(4000),
  legalEntityId: zUuid.nullish(),
  expiresAt: zOptDateOnly,
  items: z
    .array(z.object({ propertyId: zUuid, priceSnapshot: zOptMoney, termsSnapshot: zOptText(4000), comment: zOptText(2000) }))
    .min(1)
    .max(30)
    .optional(),
});

/** Изменение черновика: текст, юрлицо, порядок/состав позиций (новые позиции получают свежий snapshot). */
export async function updateOffer(actor: Actor, id: string, input: unknown): Promise<{ id: string }> {
  const d = parseInput(updateSchema, input);
  return transaction(async (tx) => {
    const offer = await loadOffer(tx, actor, id);
    const res = await tx.commercialOffer.updateMany({ where: { id, updatedAt: d.expectedUpdatedAt }, data: { updatedAt: new Date() } });
    if (res.count === 0) throw new StaleUpdateError();
    const frozen = offer.status !== "draft";
    if (frozen && (d.items || d.legalEntityId !== undefined)) throw new DomainError("OFFER_FROZEN", "Состав и юрлицо подготовленного предложения не меняются — создайте новое КП");
    await assertLegalEntity(tx, d.legalEntityId);
    await tx.commercialOffer.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.introText !== undefined && !frozen ? { introText: d.introText } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
        ...(d.legalEntityId !== undefined ? { legalEntityId: d.legalEntityId } : {}),
        ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}),
      },
    });
    if (d.items) {
      if (new Set(d.items.map(i => i.propertyId)).size !== d.items.length) throw new ValidationError("Объект указан дважды");
      const existing = await tx.commercialOfferItem.findMany({ where: { commercialOfferId: id } });
      const keep = new Map(existing.map((e) => [e.propertyId, e]));
      const wanted = new Set(d.items.map((i) => i.propertyId));
      await tx.commercialOfferItem.deleteMany({ where: { commercialOfferId: id, propertyId: { notIn: [...wanted] } } });
      // временные позиции, чтобы не нарушить UNIQUE при перестановке
      let pos = 1000;
      for (const e of existing.filter((x) => wanted.has(x.propertyId))) await tx.commercialOfferItem.update({ where: { id: e.id }, data: { position: pos++ } });
      let position = 1;
      for (const item of d.items) {
        const prev = keep.get(item.propertyId);
        if (prev) {
          await tx.commercialOfferItem.update({
            where: { id: prev.id },
            data: {
              position: position++,
              ...(item.priceSnapshot !== null ? { priceSnapshot: item.priceSnapshot } : {}),
              ...(item.termsSnapshot !== null ? { termsSnapshot: item.termsSnapshot } : {}),
              comment: item.comment,
            },
          });
        } else {
          const { snapshot } = await snapshotOf(tx, item.propertyId);
          await tx.commercialOfferItem.create({
            data: {
              commercialOfferId: id,
              propertyId: item.propertyId,
              position: position++,
              priceSnapshot: item.priceSnapshot ?? snapshot.priceSnapshot,
              addressSnapshot: snapshot.addressSnapshot,
              areaSnapshot: snapshot.areaSnapshot,
              termsSnapshot: item.termsSnapshot ?? snapshot.termsSnapshot,
              comment: item.comment,
            },
          });
        }
      }
    }
    return { id };
  });
}

const statusSchema = z.object({
  expectedUpdatedAt: zExpectedUpdatedAt,
  status: zCode("offerStatus"),
  onBehalfOfCompany: z.boolean().default(true),
  followUp: z
    .object({ title: z.string().trim().min(1), dueAt: z.string() })
    .optional(),
});

const TRANSITIONS: Record<string, string[]> = {
  draft: ["prepared", "sent", "archived"],
  prepared: ["draft", "sent", "archived"],
  sent: ["accepted", "rejected", "expired", "archived"],
  accepted: ["archived"],
  rejected: ["archived"],
  expired: ["archived"],
  archived: [],
};

export async function changeOfferStatus(actor: Actor, id: string, input: unknown): Promise<{ id: string; taskId: string | null }> {
  const d = parseInput(statusSchema, input);
  return transaction(async (tx) => {
    const offer = await loadOffer(tx, actor, id);
    if (!isManager(actor) && offer.responsibleUserId !== actor.userId && offer.createdBy !== actor.userId) throw new ForbiddenError();
    if (!TRANSITIONS[offer.status]?.includes(d.status)) throw new DomainError("INVALID_TRANSITION", "Недопустимый переход статуса предложения");
    if ((d.status === "prepared" || d.status === "sent") && d.onBehalfOfCompany && !offer.legalEntityId)
      throw new ValidationError("Выберите ИП/ООО, от имени которого оформляется предложение", { legalEntityId: ["Обязательно для подготовленного/отправленного КП"] });
    const res = await tx.commercialOffer.updateMany({
      where: { id, updatedAt: d.expectedUpdatedAt },
      data: { status: d.status, ...(d.status === "sent" ? { sentAt: offer.sentAt ?? new Date() } : {}) },
    });
    if (res.count === 0) throw new StaleUpdateError();
    await writeAudit(tx, { actorUserId: actor.userId, action: "offer.status_changed", entityType: "CommercialOffer", entityId: id, before: { status: offer.status }, after: { status: d.status } });
    let taskId: string | null = null;
    if (d.status === "sent" && d.followUp) {
      const need = await tx.clientNeed.findUniqueOrThrow({ where: { id: offer.clientNeedId }, select: { clientId: true } });
      const due = new Date(d.followUp.dueAt);
      if (Number.isNaN(due.getTime())) throw new ValidationError(undefined, { "followUp.dueAt": ["Некорректная дата"] });
      taskId = (
        await insertTask(tx, actor.userId, { title: d.followUp.title, taskType: "commercial_offer", dueAt: due, responsibleUserId: offer.responsibleUserId }, {
          offerIds: [id],
          needIds: [offer.clientNeedId],
          clientIds: [need.clientId],
        })
      ).id;
    }
    return { id, taskId };
  });
}

// ───── Queries ─────

export const offerFiltersSchema = zPagination.extend({
  status: zCode("offerStatus").optional(),
  needId: zUuid.optional(),
  responsibleUserId: zUuid.optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listOffers(actor: Actor, raw: unknown) {
  const f = parseInput(offerFiltersSchema, raw);
  const and: Prisma.CommercialOfferWhereInput[] = [offerScope(actor)];
  if (f.status) and.push({ status: f.status });
  if (f.needId) and.push({ clientNeedId: f.needId });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.q) and.push({ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { need: { client: { AND: [clientScope(actor), { displayName: { contains: f.q, mode: "insensitive" } }] } } }] });
  const where: Prisma.CommercialOfferWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.commercialOffer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      ...skipTake(f),
      include: {
        need: { select: { id: true, client: { select: { id: true, displayName: true, responsibleUserId: true } } } },
        responsible: { select: { id: true, displayName: true } },
        legalEntity: { select: { id: true, displayName: true } },
        _count: { select: { items: true } },
      },
    }),
    db.commercialOffer.count({ where }),
  ]);
  return { items: rows.map((r) => ({ ...r, need: redactClientLink(actor, r.need), clientVisible: canSeeClient(actor, r.need.client) })), total, page: f.page, pageSize: f.pageSize };
}

export async function getOffer(actor: Actor, id: string) {
  assertRecordId(id);
  const o = await db.commercialOffer.findFirst({
    where: { id, ...offerScope(actor) },
    include: {
      need: { select: { id: true, operationType: true, propertyType: true, client: { select: { id: true, displayName: true, responsibleUserId: true } } } },
      responsible: { select: { id: true, displayName: true } },
      creator: { select: { displayName: true } },
      legalEntity: { select: { id: true, displayName: true, entityType: true, requisites: true } },
      items: {
        orderBy: { position: "asc" },
        include: { property: { select: { id: true, addressText: true, price: true, area: true, status: true } } },
      },
      documentLinks: { where: { document: documentScope(actor) }, select: { document: { select: { id: true, originalName: true, createdAt: true, legalEntityId: true, archivedAt: true } } } },
    },
  });
  if (!o) throw new NotFoundError();
  return {
    offer: { ...o, need: redactClientLink(actor, o.need) },
    clientVisible: canSeeClient(actor, o.need.client),
    // Расхождение snapshot и текущей цены — для подсказки пользователю, snapshot не меняется.
    priceChanged: o.items.filter((i) => i.priceSnapshot !== null && i.property.price !== null && !i.priceSnapshot.equals(i.property.price)).map((i) => i.id),
  };
}

/** A new draft keeps the exact historical snapshots; no Property refresh or send side effect. */
export async function createOfferRevision(actor: Actor, id: string, input: unknown): Promise<{ id: string }> {
  const d = parseInput(z.object({ expectedUpdatedAt: zExpectedUpdatedAt }), input);
  return transaction(async tx => {
    const source = await loadOffer(tx, actor, id);
    if (source.updatedAt.getTime() !== d.expectedUpdatedAt.getTime()) throw new StaleUpdateError();
    const items = await tx.commercialOfferItem.findMany({ where: { commercialOfferId: id }, orderBy: { position: "asc" } });
    const revision = await tx.commercialOffer.create({ data: {
      clientNeedId: source.clientNeedId, responsibleUserId: source.responsibleUserId, createdBy: actor.userId,
      legalEntityId: source.legalEntityId, status: "draft", title: source.title, introText: source.introText,
      expiresAt: source.expiresAt, generationSource: "manual", promptTemplateVersion: `revision-of:${id}`,
      notes: source.notes,
      items: { create: items.map(i => ({ propertyId: i.propertyId, position: i.position, priceSnapshot: i.priceSnapshot, addressSnapshot: i.addressSnapshot, areaSnapshot: i.areaSnapshot, termsSnapshot: i.termsSnapshot, comment: i.comment })) },
    }, select: { id: true } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "offer.revision_created", entityType: "CommercialOffer", entityId: revision.id, after: { previousOfferId: id } });
    return revision;
  });
}
