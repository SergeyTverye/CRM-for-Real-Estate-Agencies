import { lockSql } from "@/shared/db/dialect";
import { z } from "zod";
import { db, transaction, type Tx } from "@/shared/db/client";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";
import { ForbiddenError, NotFoundError, StaleUpdateError, ValidationError } from "@/shared/errors";
import { parseInput, zUuid, zExpectedUpdatedAt } from "@/shared/validation";
import { compareListings, groupCandidates, type DuplicateCandidate } from "../domain/matching";
import { parseFloor } from "@/modules/property-search/domain/floor";
import { publicSourceUrl } from "@/modules/ai/domain/contracts";

export function assertDuplicateStaff(actor: Actor) {
  if (!["manager", "realtor"].includes(actor.role) || actor.mustChangePassword) throw new ForbiddenError();
}
const idsSchema = z.array(zUuid).min(1).max(500);
const candidateSelect = { id: true, source: true, sourceListingId: true, sourceUnitId: true, city: true, address: true, areaM2: true, floorNumber: true, floorRaw: true, purposes: true, operation: true, priceRub: true, priceUnit: true,
  snapshots: { orderBy: [{ fetchedAt: "desc" }, { id: "desc" }], take: 1, select: { normalized: true } } } satisfies Prisma.ExternalListingSelect;
type CandidateRow = Prisma.ExternalListingGetPayload<{ select: typeof candidateSelect }>;
const dbPriceUnits: Record<string, string> = { total: "rub_total", per_month: "rub_month", per_year: "rub_year", per_m2_month: "rub_m2_month", per_m2_year: "rub_m2_year" };
function candidate(row: CandidateRow): DuplicateCandidate {
  const floor = parseFloor(row.floorRaw);
  const raw = row.snapshots.at(-1)?.normalized;
  const normalized = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const values = normalized.structuredFeatures;
  const features: Record<string, boolean | number> = {};
  if (values && typeof values === "object" && !Array.isArray(values)) for (const key of ["separate_entrance", "ceiling_height", "power_kw", "gates", "wet_point", "first_line"]) {
    const v = values[key]; if (typeof v === "boolean" || typeof v === "number") features[key] = v;
  }
  return { id: row.id, source: row.source, sourceListingId: row.sourceListingId, sourceUnitId: row.sourceUnitId,
    city: row.city, address: row.address, purposes: row.purposes, operation: row.operation,
    area: row.areaM2?.toNumber() ?? null, floor: row.floorNumber ?? floor.number,
    floorKind: row.floorNumber !== null ? (row.floorNumber < 0 ? "basement" : "above_ground") : floor.kind,
    price: row.priceRub?.toString() ?? null,
    priceUnit: normalized.priceUnit === null ? null : row.operation === "rent" && row.priceUnit === "total" ? null : dbPriceUnits[row.priceUnit ?? ""] ?? null, features };
}
/** Shared transaction lock serializes regroup and human decisions across workers/processes. */
async function lock(tx: Tx) { await tx.$queryRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(310007::bigint)::text`)); }
const pairKey = (a: string, b: string) => [a, b].sort().join(":");

/** Internal ingestion hook, no actor needed. Does not mutate ExternalListing or create Property.
 * Input: 1..500 persisted listing UUIDs. Returns active group IDs touching the batch.
 * Candidate universe: same city/operation, capped explicitly at 5000 (no silent truncation).
 */
export async function regroupForListings(listingIds: string[]): Promise<{ groupIds: string[] }> {
  const ids = [...new Set(parseInput(idsSchema, listingIds))];
  return transaction(async tx => {
    await lock(tx);
    const seeds = await tx.externalListing.findMany({ where: { id: { in: ids } }, select: { city: true, operation: true } });
    if (!seeds.length) return { groupIds: [] };
    const rows = await tx.externalListing.findMany({ where: { OR: seeds.map(s => ({ city: s.city, operation: s.operation })) }, select: candidateSelect, orderBy: { id: "asc" }, take: 5001 });
    if (rows.length > 5000) throw new ValidationError("Слишком большая область дедупликации; разбейте обработку по городу/операции");
    const candidates = rows.map(candidate), byId = new Map(candidates.map(c => [c.id, c]));
    const existing = await tx.listingDuplicateGroup.findMany({ where: { members: { some: { listingId: { in: rows.map(r => r.id) } } } }, include: { members: true, decisions: { select: { decision: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const blocked = new Set<string>();
    for (const g of existing) for (const a of g.members) for (const b of g.members) {
      if (a.listingId !== b.listingId && (g.status === "rejected" || a.releasedAt || b.releasedAt)) blocked.add(pairKey(a.listingId, b.listingId));
    }
    const active = existing.filter(g => g.status !== "rejected");
    const assigned = new Set(active.flatMap(g => g.members.filter(m => !m.releasedAt).map(m => m.listingId)));
    // Human-reviewed groups are frozen: new candidates cannot silently alter their meaning.
    for (const g of active.filter(g => g.status === "probable" && !g.decisions.length)) {
      const members = g.members.filter(m => !m.releasedAt).map(m => byId.get(m.listingId));
      if (!members.length || members.some(m => !m)) continue;
      for (const c of candidates) {
        if (assigned.has(c.id) || !members.every(m => m && !blocked.has(pairKey(c.id, m.id)) && compareListings(c, m).probable)) continue;
        await tx.listingDuplicateMember.create({ data: { groupId: g.id, listingId: c.id } });
        assigned.add(c.id); members.push(c);
      }
      const evidence = { version: 1, pairs: members.flatMap((a, i) => members.slice(i + 1).flatMap(b => a && b ? [compareListings(a, b)] : [])) };
      await tx.listingDuplicateGroup.update({ where: { id: g.id }, data: { evidence: evidence as unknown as Prisma.InputJsonValue } });
    }
    const proposed = groupCandidates(candidates.filter(c => !assigned.has(c.id)), (a, b) => blocked.has(pairKey(a, b)));
    for (const g of proposed) {
      if (!g.listingIds.some(id => ids.includes(id))) continue;
      const created = await tx.listingDuplicateGroup.create({ data: { evidence: { version: 1, pairs: g.pairs } as unknown as Prisma.InputJsonValue, members: { create: g.listingIds.map(listingId => ({ listingId })) } } });
      await writeAudit(tx, { action: "duplicate_group_proposed", entityType: "ListingDuplicateGroup", entityId: created.id, after: { listingIds: g.listingIds } });
    }
    const groups = await tx.listingDuplicateGroup.findMany({ where: { status: { not: "rejected" }, members: { some: { listingId: { in: ids }, releasedAt: null } } }, select: { id: true }, orderBy: { id: "asc" } });
    return { groupIds: groups.map(g => g.id) };
  });
}

function safeUrl(raw: string) {
  const safe = publicSourceUrl(raw); if (!safe) return null;
  const url = new URL(safe); url.search = ""; url.hash = ""; return url.href;
}
export async function getDuplicateGroup(actor: Actor, id: string) {
  assertDuplicateStaff(actor); parseInput(zUuid, id);
  const row = await db.listingDuplicateGroup.findUnique({ where: { id }, select: {
    id: true, status: true, evidence: true, updatedAt: true,
    decisions: { orderBy: [{ decidedAt: "desc" }, { id: "asc" }], select: { id: true, decision: true, decidedAt: true, decider: { select: { displayName: true } } } },
    members: { orderBy: { listingId: "asc" }, select: { listingId: true, releasedAt: true, listing: { select: {
      ...candidateSelect, url: true, sellerType: true,
      snapshots: { orderBy: [{ fetchedAt: "asc" }, { id: "asc" }], select: { fetchedAt: true, priceRub: true, normalized: true } },
      verifications: { orderBy: [{ verifiedAt: "desc" }, { id: "asc" }], take: 1, select: { availability: true, verifiedAt: true } },
    } } } },
  } });
  if (!row) throw new NotFoundError();
  const members = row.members.map(({ listing: l, ...m }) => ({ ...m, releasedAt: m.releasedAt?.toISOString() ?? null,
    listing: { id: l.id, source: l.source, url: safeUrl(l.url), address: l.address, area: l.areaM2?.toString() ?? null,
      floor: l.floorNumber ?? parseFloor(l.floorRaw).number, price: l.priceRub?.toString() ?? null, priceUnit: candidate(l).priceUnit ?? null,
      sellerType: ["owner", "agent"].includes(l.sellerType ?? "") ? l.sellerType! : "unknown",
      availability: l.verifications[0]?.availability ?? "unknown", checkedAt: l.verifications[0]?.verifiedAt.toISOString() ?? null,
      priceHistory: l.snapshots.map(s => {
        const n = s.normalized && typeof s.normalized === "object" && !Array.isArray(s.normalized) ? s.normalized : {};
        return { at: s.fetchedAt.toISOString(), price: s.priceRub?.toString() ?? null,
          priceUnit: typeof n.priceUnit === "string" && ["rub_total", "rub_month", "rub_year", "rub_m2_month", "rub_m2_year"].includes(n.priceUnit) ? n.priceUnit : null };
      }),
    } }));
  // Recompute safe, structured evidence instead of trusting arbitrary JSON/legacy descriptions.
  const current = row.members.filter(m => !m.releasedAt).map(m => candidate(m.listing));
  return { id: row.id, status: row.status, updatedAt: row.updatedAt.toISOString(), members,
    evidence: { pairs: current.flatMap((a, i) => current.slice(i + 1).map(b => compareListings(a, b))) },
    decisions: row.decisions.map(d => ({ ...d, decidedAt: d.decidedAt.toISOString() })) };
}
export type DuplicateGroupDto = Awaited<ReturnType<typeof getDuplicateGroup>>;

/** Team-wide public external listings; no client, owner-contact, snapshot JSON or seller notes. */
export async function getGroupsForListings(actor: Actor, listingIds: string[]): Promise<DuplicateGroupDto[]> {
  assertDuplicateStaff(actor);
  if (!listingIds.length) return [];
  const ids = parseInput(idsSchema, listingIds);
  const groups = await db.listingDuplicateGroup.findMany({ where: { status: { not: "rejected" }, members: { some: { listingId: { in: ids }, releasedAt: null } } }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return Promise.all(groups.map(g => getDuplicateGroup(actor, g.id)));
}

export async function decideDuplicateGroup(actor: Actor, id: string, raw: unknown) {
  assertDuplicateStaff(actor); parseInput(zUuid, id);
  const input = parseInput(z.object({ decision: z.enum(["confirm", "different", "defer", "split"]), expectedUpdatedAt: zExpectedUpdatedAt,
    listingId: zUuid.optional(), comment: z.string().trim().max(1000).optional(), confirmed: z.literal(true) }).strict(), raw);
  await transaction(async tx => {
    await lock(tx);
    const group = await tx.listingDuplicateGroup.findUnique({ where: { id }, include: { members: true } });
    if (!group) throw new NotFoundError();
    if (group.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleUpdateError();
    if (group.status === "rejected") throw new ValidationError("Группа уже отклонена");
    if (input.decision === "confirm" && group.members.filter(m => !m.releasedAt).length < 2) throw new ValidationError("В группе должно быть не менее двух объявлений");
    if (input.decision === "split") {
      const member = group.members.find(m => m.listingId === input.listingId && !m.releasedAt);
      if (!member) throw new ValidationError("Выберите действующее объявление группы");
      await tx.listingDuplicateMember.update({ where: { id: member.id }, data: { releasedAt: new Date() } });
    } else if (input.listingId) throw new ValidationError("Объявление указывается только при разъединении");
    const status = input.decision === "confirm" ? "confirmed" : input.decision === "different" ? "rejected" : input.decision === "defer" ? "deferred" : "probable";
    await tx.listingDuplicateGroup.update({ where: { id }, data: { status, updatedAt: new Date(Math.max(Date.now(), group.updatedAt.getTime() + 1)) } });
    const decision = await tx.listingDuplicateDecision.create({ data: { groupId: id, decision: input.decision, decidedBy: actor.userId,
      comment: input.decision === "split" ? JSON.stringify({ listingId: input.listingId, comment: input.comment ?? null }) : input.comment } });
    await writeAudit(tx, { actorUserId: actor.userId, entityType: "ListingDuplicateGroup", entityId: id, action: `duplicate_${input.decision}`,
      before: { status: group.status }, after: { status, decisionId: decision.id, listingId: input.listingId ?? null } });
  });
  return getDuplicateGroup(actor, id);
}
