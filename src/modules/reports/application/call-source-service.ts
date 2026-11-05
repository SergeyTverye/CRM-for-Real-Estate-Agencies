import { z } from "zod";
import { db, Prisma } from "@/shared/db/client";
import { parseInput, zDateOnly, zUuid, zCode } from "@/shared/validation";
import type { Actor } from "@/modules/auth/domain/actor";
import { timelinePeriod } from "@/modules/clients/application/timeline-service";

export const callReportFiltersSchema = z.object({
  from: zDateOnly.optional(), to: zDateOnly.optional(), sourceCode: z.string().trim().max(50).optional(),
  employeeId: zUuid.optional(), advertisementId: zUuid.optional(), outcomeCode: zCode("callOutcome").optional(),
  metric: z.enum(["calls", "clients", "needs", "showings", "deals"]).default("calls"),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
type Filters = z.infer<typeof callReportFiltersSchema>;
/** All conversion flags describe calls in this cohort, not unrelated downstream entity totals.
 * The numerator is calls that reached the stage; denominator is ALL filtered calls, including spam.
 * A deal is attributed only through the linked need's property context and after the call. */
function cohort(actor: Actor, f: Filters) {
  const period = timelinePeriod(f.from, f.to);
  const manager = actor.role === "manager";
  const user = actor.userId;
  return Prisma.sql`WITH calls AS (
    SELECT r.*, coalesce(r.call_at, r.occurred_at) AS event_at,
      (r.client_id IS NOT NULL AND (${manager} OR c.responsible_user_id = ${user}::uuid)) AS visible_client,
      (n.id IS NOT NULL AND (${manager} OR n.responsible_user_id = ${user}::uuid OR c.responsible_user_id = ${user}::uuid)) AS has_need,
      (n.id IS NOT NULL AND EXISTS (SELECT 1 FROM showings s WHERE s.client_need_id = n.id
        AND s.status = 'completed' AND coalesce(s.occurred_at, s.scheduled_at) >= coalesce(r.call_at, r.occurred_at)
        AND (${manager} OR s.responsible_user_id = ${user}::uuid OR n.responsible_user_id = ${user}::uuid OR c.responsible_user_id = ${user}::uuid))) AS has_showing,
      (n.id IS NOT NULL AND EXISTS (SELECT 1 FROM deals d JOIN deal_parties dp ON dp.deal_id = d.id AND dp.client_id = r.client_id
        WHERE d.status = 'completed' AND d.closed_at >= coalesce(r.call_at, r.occurred_at)
        AND (${manager} OR d.responsible_user_id = ${user}::uuid OR c.responsible_user_id = ${user}::uuid)
        AND (${manager} OR n.responsible_user_id = ${user}::uuid OR c.responsible_user_id = ${user}::uuid)
        AND (EXISTS (SELECT 1 FROM showings s WHERE s.client_need_id = n.id AND s.property_id = d.property_id)
          OR EXISTS (SELECT 1 FROM need_property_matches m WHERE m.client_need_id = n.id AND m.property_id = d.property_id)
          OR EXISTS (SELECT 1 FROM commercial_offer_items i JOIN commercial_offers o ON o.id = i.commercial_offer_id WHERE o.client_need_id = n.id AND i.property_id = d.property_id)))) AS has_deal
    FROM lead_requests r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN client_needs n ON n.id = r.client_need_id
    WHERE (r.call_at IS NOT NULL OR r.channel_code = 'phone')
      AND (${manager} OR r.responsible_user_id = ${user}::uuid OR r.created_by = ${user}::uuid OR c.responsible_user_id = ${user}::uuid)
      ${period.gte ? Prisma.sql`AND coalesce(r.call_at,r.occurred_at) >= ${period.gte}` : Prisma.empty}
      ${period.lt ? Prisma.sql`AND coalesce(r.call_at,r.occurred_at) < ${period.lt}` : Prisma.empty}
      ${f.sourceCode ? Prisma.sql`AND r.source_code = ${f.sourceCode}` : Prisma.empty}
      ${f.employeeId ? Prisma.sql`AND r.responsible_user_id = ${f.employeeId}::uuid` : Prisma.empty}
      ${f.advertisementId ? Prisma.sql`AND r.advertisement_id = ${f.advertisementId}::uuid` : Prisma.empty}
      ${f.outcomeCode ? Prisma.sql`AND coalesce(r.outcome_code, CASE WHEN r.result_code IN ('new_need','linked_existing_need') THEN 'prospective' WHEN r.result_code='invalid_or_spam' THEN 'spam' ELSE 'one_time' END) = ${f.outcomeCode}` : Prisma.empty}
  )`;
}
const counts = Prisma.sql`count(*)::int AS calls, count(DISTINCT client_id) FILTER (WHERE visible_client)::int AS clients,
 count(*) FILTER (WHERE has_need)::int AS needs, count(*) FILTER (WHERE has_showing)::int AS showings, count(*) FILTER (WHERE has_deal)::int AS deals`;
interface Counts { calls: number; clients: number; needs: number; showings: number; deals: number }
export async function getCallSourceReport(actor: Actor, raw: unknown = {}) {
  const f = parseInput(callReportFiltersSchema, raw);
  const cte = cohort(actor, f);
  const [totals, sources] = await db.$transaction([
    db.$queryRaw<Counts[]>(Prisma.sql`${cte} SELECT ${counts} FROM calls`),
    db.$queryRaw<(Counts & { sourceCode: string })[]>(Prisma.sql`${cte} SELECT source_code AS "sourceCode", ${counts} FROM calls GROUP BY source_code ORDER BY source_code`),
  ]);
  const total = totals[0]!;
  return { total, sources, conversions: Object.fromEntries((["needs", "showings", "deals"] as const).map(key => [key, { numerator: total[key], denominator: total.calls, percent: total.calls ? Math.round(total[key] / total.calls * 1000) / 10 : null }])) };
}
export async function getCallSourceDetails(actor: Actor, raw: unknown = {}) {
  const f = parseInput(callReportFiltersSchema, raw);
  const condition = f.metric === "clients" ? Prisma.sql`visible_client` : f.metric === "needs" ? Prisma.sql`has_need` : f.metric === "showings" ? Prisma.sql`has_showing` : f.metric === "deals" ? Prisma.sql`has_deal` : Prisma.sql`true`;
  const rows = await db.$queryRaw<{ id: string; at: Date; summary: string | null; sourceCode: string; outcomeCode: string | null; resultCode: string; responsible: string }[]>(Prisma.sql`${cohort(actor, f)}
    SELECT c.id, event_at AS at, summary, source_code AS "sourceCode", outcome_code AS "outcomeCode", result_code AS "resultCode", u.display_name AS responsible
    FROM calls c JOIN users u ON u.id = c.responsible_user_id WHERE ${condition}
    ORDER BY event_at DESC, c.id DESC LIMIT ${f.pageSize + 1} OFFSET ${(f.page - 1) * f.pageSize}`);
  return { items: rows.slice(0, f.pageSize), hasNext: rows.length > f.pageSize, page: f.page };
}
