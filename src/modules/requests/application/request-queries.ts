import { redactClientLink } from "@/modules/access/application/redact-client";
import { z } from "zod";
import { db } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { NotFoundError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zCode, zPagination, zUuid, zDateOnly } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { canSeeClient, canSeeNeed, leadRequestScope, clientScope, taskScope } from "@/modules/access/domain/scopes";
import { OPEN_TASK_STATUSES } from "@/modules/tasks/domain/task-rules";

export const requestFiltersSchema = zPagination.extend({
  q: z.string().trim().max(200).optional(),
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
  sourceCode: z.string().max(50).optional(),
  channelCode: z.string().max(50).optional(),
  advertisementId: zUuid.optional(),
  outcomeCode: zCode("callOutcome").optional(),
  resultCode: zCode("leadResult").optional(),
  statusCode: zCode("leadStatus").optional(),
  responsibleUserId: zUuid.optional(),
  withoutNextAction: z.enum(["yes"]).optional(),
  unprocessed: z.enum(["yes"]).optional(),
});

function nextActionExists(): Prisma.LeadRequestWhereInput {
  const open = { status: { in: [...OPEN_TASK_STATUSES] } };
  return {
    OR: [
      { need: { taskLinks: { some: { task: open } } } },
      { client: { taskLinks: { some: { task: open } } } },
    ],
  };
}

export async function listRequests(actor: Actor, raw: unknown) {
  const f = parseInput(requestFiltersSchema, raw);
  const and: Prisma.LeadRequestWhereInput[] = [leadRequestScope(actor)];
  if (f.from) and.push({ occurredAt: { gte: f.from } });
  if (f.to) and.push({ occurredAt: { lt: new Date(f.to.getTime() + 86_400_000) } });
  if (f.sourceCode) and.push({ sourceCode: f.sourceCode });
  if (f.channelCode) and.push({ channelCode: f.channelCode });
  if (f.advertisementId) and.push({ advertisementId: f.advertisementId });
  if (f.outcomeCode) and.push({ outcomeCode: f.outcomeCode });
  if (f.resultCode) and.push({ resultCode: f.resultCode });
  if (f.statusCode) and.push({ statusCode: f.statusCode });
  if (f.responsibleUserId && isManager(actor)) and.push({ responsibleUserId: f.responsibleUserId });
  if (f.unprocessed) and.push({ statusCode: "open" });
  if (f.withoutNextAction) and.push({ NOT: nextActionExists() });
  if (f.q)
    and.push({
      OR: [
        { summary: { contains: f.q, mode: "insensitive" } },
        { rawContact: { contains: f.q, mode: "insensitive" } },
        { client: { AND: [clientScope(actor), { displayName: { contains: f.q, mode: "insensitive" } }] } },
      ],
    });
  const where: Prisma.LeadRequestWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.leadRequest.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      ...skipTake(f),
      include: {
        client: {
          select: {
            id: true,
            displayName: true,
            responsibleUserId: true,
            taskLinks: { where: { task: { status: { in: [...OPEN_TASK_STATUSES] }, ...taskScope(actor) } }, orderBy: { task: { dueAt: "asc" } }, take: 1, select: { task: { select: { title: true, dueAt: true } } } },
          },
        },
        need: { select: { id: true, responsibleUserId: true, client: { select: { responsibleUserId: true } }, taskLinks: { where: { task: { status: { in: [...OPEN_TASK_STATUSES] }, ...taskScope(actor) } }, take: 1, select: { task: { select: { title: true, dueAt: true } } } } } },
        property: { select: { id: true, addressText: true } },
        advertisement: { select: { id: true, platformCode: true } },
        responsible: { select: { id: true, displayName: true } },
        creator: { select: { displayName: true } },
      },
    }),
    db.leadRequest.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      ...redactClientLink(actor, r),
      need: r.need && canSeeNeed(actor, r.need) ? redactClientLink(actor, r.need) : null,
      clientNeedId: r.need && canSeeNeed(actor, r.need) ? r.clientNeedId : null,
      clientVisible: r.client ? canSeeClient(actor, r.client) : false,
      needVisible: r.need ? canSeeNeed(actor, r.need) : false,
      nextAction: (r.need && canSeeNeed(actor, r.need) ? r.need.taskLinks[0]?.task : null) ?? (r.client && canSeeClient(actor, r.client) ? r.client.taskLinks[0]?.task : null) ?? null,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getRequestCard(actor: Actor, requestId: string) {
  assertRecordId(requestId);
  const r = await db.leadRequest.findFirst({
    where: { id: requestId, ...leadRequestScope(actor) },
    include: {
      client: { select: { id: true, displayName: true, responsibleUserId: true, status: true } },
      need: { select: { id: true, status: true, stage: true, responsibleUserId: true, client: { select: { responsibleUserId: true } } } },
      property: { select: { id: true, addressText: true, responsible: { select: { displayName: true } } } },
      advertisement: { select: { id: true, platformCode: true, url: true } },
      externalListing: { select: { source: true, address: true, url: true } },
      responsible: { select: { id: true, displayName: true } },
      creator: { select: { id: true, displayName: true } },
    },
  });
  if (!r) throw new NotFoundError();
  return {
    request: { ...redactClientLink(actor, r), need: r.need && canSeeNeed(actor, r.need) ? redactClientLink(actor, r.need) : null, clientNeedId: r.need && canSeeNeed(actor, r.need) ? r.clientNeedId : null },
    clientVisible: r.client ? canSeeClient(actor, r.client) : false,
    needVisible: r.need ? canSeeNeed(actor, r.need) : false,
  };
}
