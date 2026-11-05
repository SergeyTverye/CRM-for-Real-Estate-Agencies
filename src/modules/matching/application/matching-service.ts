import { z } from "zod";
import { db, transaction, type Tx } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { parseInput, zCode, zOptText, zUuid } from "@/shared/validation";
import type { Actor } from "@/modules/auth/domain/actor";
import { matchScope } from "@/modules/access/domain/scopes";
import { assertDictionaryCode } from "@/modules/dictionaries/application/dictionaries-service";
import { advanceNeedStage, loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { NEED_TO_PROPERTY_OPERATION, scoreMatch, type NeedCriteria, type PropertyFacts } from "../domain/match-score";

/**
 * UC-04 ProposeProperty и рабочее место подбора (ТЗ 37.19).
 * Сначала детерминированные фильтры по структурированным параметрам; результат объясним.
 * История предложений сохраняется: повторное предложение создаёт новую запись NeedPropertyMatch.
 * Контакты собственника в выдачу подбора не попадают.
 */

const num = (v: { toString(): string } | null | undefined): number | null => (v === null || v === undefined ? null : Number(v.toString()));

function toCriteria(n: Awaited<ReturnType<typeof loadAccessibleNeed>>): NeedCriteria {
  return {
    operationType: n.operationType,
    propertyType: n.propertyType,
    propertySubtype: n.propertySubtype,
    budgetMin: num(n.budgetMin),
    budgetMax: num(n.budgetMax),
    areaMin: num(n.areaMin),
    areaMax: num(n.areaMax),
    district: n.district,
    roomsMin: n.roomsMin,
    roomsMax: n.roomsMax,
    floorMin: n.floorMin,
    floorMax: n.floorMax,
    landAreaMin: num(n.landAreaMin),
    landAreaMax: num(n.landAreaMax),
    buildingAreaMin: num(n.buildingAreaMin),
    buildingAreaMax: num(n.buildingAreaMax),
    powerRequirement: num(n.powerRequirement),
    parkingRequirement: n.parkingRequirement,
    tenantRequirement: n.tenantRequirement,
    commercialPurpose: n.commercialPurpose,
  };
}

const candidatesSchema = z.object({
  strict: z.enum(["yes", "no"]).default("yes"),
  q: z.string().trim().max(200).optional(),
  hideOffered: z.enum(["yes", "no"]).default("no"),
  sourceType: zCode("propertySourceType").optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
});

export async function findCandidates(actor: Actor, needId: string, raw: unknown = {}) {
  const f = parseInput(candidatesSchema, raw);
  const need = await loadAccessibleNeed(db, actor, needId);
  const criteria = toCriteria(need);
  const and: Prisma.PropertyWhereInput[] = [{ status: "active" }, { propertyType: need.propertyType }];
  const op = NEED_TO_PROPERTY_OPERATION[need.operationType];
  if (op) and.push({ operationType: op });
  if (f.sourceType) and.push({ sourceType: f.sourceType });
  if (f.q) and.push({ OR: [{ addressText: { contains: f.q, mode: "insensitive" } }, { district: { contains: f.q, mode: "insensitive" } }] });
  if (f.strict === "yes") {
    if (criteria.budgetMax !== null) and.push({ OR: [{ price: null }, { price: { lte: criteria.budgetMax } }] });
    if (criteria.budgetMin !== null) and.push({ OR: [{ price: null }, { price: { gte: criteria.budgetMin } }] });
    if (criteria.areaMin !== null) and.push({ OR: [{ area: null }, { area: { gte: criteria.areaMin } }] });
    if (criteria.areaMax !== null) and.push({ OR: [{ area: null }, { area: { lte: criteria.areaMax } }] });
  }
  const props = await db.property.findMany({
    where: { AND: and },
    take: f.take,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      addressText: true,
      district: true,
      operationType: true,
      propertyType: true,
      propertySubtype: true,
      sourceType: true,
      price: true,
      area: true,
      floor: true,
      roomsCount: true,
      landArea: true,
      buildingArea: true,
      powerKw: true,
      parkingAvailable: true,
      hasTenant: true,
      commercialPurpose: true,
      status: true,
      responsible: { select: { displayName: true } },
    },
  });
  const history = await db.needPropertyMatch.findMany({
    where: { clientNeedId: needId, propertyId: { in: props.map((p) => p.id) } },
    orderBy: { offeredAt: "desc" },
    select: { propertyId: true, status: true, offeredAt: true, rejectionReasonCode: true },
  });
  const lastByProperty = new Map<string, (typeof history)[number]>();
  for (const h of history) if (!lastByProperty.has(h.propertyId)) lastByProperty.set(h.propertyId, h);
  const items = props
    .map((p) => {
      const facts: PropertyFacts = {
        operationType: p.operationType,
        propertyType: p.propertyType,
        propertySubtype: p.propertySubtype,
        price: num(p.price),
        area: num(p.area),
        district: p.district,
        roomsCount: p.roomsCount,
        floor: p.floor,
        landArea: num(p.landArea),
        buildingArea: num(p.buildingArea),
        powerKw: num(p.powerKw),
        parkingAvailable: p.parkingAvailable,
        hasTenant: p.hasTenant,
        commercialPurpose: p.commercialPurpose,
      };
      const s = scoreMatch(criteria, facts);
      const area = facts.area;
      return {
        ...p,
        pricePerSqm: facts.price !== null && area ? Math.round(facts.price / area) : null,
        score: s.score,
        criteria: s.criteria,
        previous: lastByProperty.get(p.id) ?? null,
      };
    })
    .filter((p) => (f.hideOffered === "yes" ? !p.previous : true))
    .sort((a, b) => b.score - a.score);
  return { need, criteria, items };
}

const proposeSchema = z.object({
  propertyIds: z.array(zUuid).min(1, "Выберите объекты").max(50),
  sourceCode: z.enum(["matching", "manual", "client_request", "ad_response"]).default("matching"),
  comment: zOptText(2000),
});

const ACTIVE_MATCH_STATUSES = ["proposed", "interested", "showing_planned"];

export async function proposeProperties(actor: Actor, needId: string, input: unknown): Promise<{ created: string[]; skipped: string[] }> {
  return transaction(tx => proposePropertiesInTransaction(tx, actor, needId, input));
}

export async function proposePropertiesInTransaction(tx: Tx, actor: Actor, needId: string, input: unknown): Promise<{ created: string[]; skipped: string[] }> {
  const d = parseInput(proposeSchema, input);
  const need = await loadAccessibleNeed(tx, actor, needId);
  if (!["active", "paused"].includes(need.status)) throw new ValidationError("Подбор возможен только для открытой потребности");
  const props = await tx.property.findMany({ where: { id: { in: d.propertyIds } }, select: { id: true } });
  if (props.length !== new Set(d.propertyIds).size) throw new NotFoundError("Объект не найден");
  const active = await tx.needPropertyMatch.findMany({
    where: { clientNeedId: needId, propertyId: { in: d.propertyIds }, status: { in: ACTIVE_MATCH_STATUSES } },
    select: { propertyId: true },
  });
  const skip = new Set(active.map((a) => a.propertyId));
  const created: string[] = [];
  for (const pid of new Set(d.propertyIds)) {
    if (skip.has(pid)) continue;
    const m = await tx.needPropertyMatch.create({
      data: { clientNeedId: needId, propertyId: pid, status: "proposed", sourceCode: d.sourceCode, comment: d.comment, createdBy: actor.userId },
      select: { id: true },
    });
    created.push(m.id);
  }
  if (created.length) await advanceNeedStage(tx, actor, needId, "selection", "auto:property_proposed");
  return { created, skipped: [...skip] };
}

const updateMatchSchema = z
  .object({
    status: zCode("matchStatus"),
    rejectionReasonCode: z.string().trim().max(50).nullish().transform((v) => v || null),
    comment: zOptText(2000),
  })
  .superRefine((d, ctx) => {
    if (d.status === "rejected" && !d.rejectionReasonCode) ctx.addIssue({ code: "custom", path: ["rejectionReasonCode"], message: "Укажите причину отказа" });
  });

export async function updateMatch(actor: Actor, matchId: string, input: unknown): Promise<void> {
  const d = parseInput(updateMatchSchema, input);
  await assertDictionaryCode("match_rejection_reason", d.rejectionReasonCode, "rejectionReasonCode");
  await transaction(async (tx) => {
    const m = await tx.needPropertyMatch.findFirst({ where: { id: matchId, ...matchScope(actor) } });
    if (!m) throw new NotFoundError();
    await tx.needPropertyMatch.update({
      where: { id: matchId },
      data: { status: d.status, rejectionReasonCode: d.status === "rejected" ? d.rejectionReasonCode : null, comment: d.comment ?? m.comment },
    });
  });
}
