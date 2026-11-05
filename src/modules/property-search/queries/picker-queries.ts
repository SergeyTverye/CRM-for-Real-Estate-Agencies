import { z } from "zod";
import { db } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import { NotFoundError } from "@/shared/errors";
import type { Actor } from "@/modules/auth/domain/actor";
import { canSeeClient, clientScope, needScope } from "@/modules/access/domain/scopes";
import { dictLabel, loadDictionaries } from "@/modules/dictionaries/application/dictionaries-service";
import { prefillSearch } from "../application/listing-service";

const inputSchema = z.object({ q: z.string().trim().max(120).default(""), clientId: zUuid.optional(), needId: zUuid.optional() });
/** Minimal picker DTO: a visible need never grants access to its client's identity. */
export async function pickSearchNeeds(actor: Actor, input: unknown) {
  const data = parseInput(inputSchema, input);
  const dictionaries = await loadDictionaries();
  const matchingCodes = (category: "need_operation_type" | "property_type") => dictionaries[category]
    .filter(item => item.label.toLocaleLowerCase("ru").includes(data.q.toLocaleLowerCase("ru"))).map(item => item.value);
  const rows = await db.clientNeed.findMany({
    where: { AND: [needScope(actor), ...(data.clientId ? [{ clientId: data.clientId, client: clientScope(actor) }] : []),
      ...(data.needId ? [{ id: data.needId }] : []), ...(data.q ? [{ OR: [
        { operationType: { in: matchingCodes("need_operation_type") } },
        { propertyType: { in: matchingCodes("property_type") } },
        { district: { contains: data.q, mode: "insensitive" as const } },
        { locationText: { contains: data.q, mode: "insensitive" as const } },
        { notes: { contains: data.q, mode: "insensitive" as const } },
        { client: { AND: [clientScope(actor), { displayName: { contains: data.q, mode: "insensitive" as const } }] } },
      ] }] : [])] },
    select: { id: true, operationType: true, propertyType: true, district: true, notes: true, status: true,
      client: { select: { id: true, displayName: true, responsibleUserId: true } } },
    orderBy: { updatedAt: "desc" }, take: 20,
  });
  if (data.needId && !rows.length) throw new NotFoundError();
  return { items: rows.map(row => ({ id: row.id,
    label: [dictLabel(dictionaries, "need_operation_type", row.operationType), dictLabel(dictionaries, "property_type", row.propertyType), row.district, row.notes?.slice(0, 100)].filter(Boolean).join(" · "),
    status: row.status, client: canSeeClient(actor, row.client) ? { id: row.client.id, displayName: row.client.displayName } : null,
  })), ...(data.needId ? { filters: await prefillSearch(actor, data.needId) } : {}) };
}
