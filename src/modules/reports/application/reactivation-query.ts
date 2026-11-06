import { reactivationSql } from "@/shared/db/dialect";
import { db, Prisma } from "@/shared/db/client";
export async function listReactivatedClients(from: Date, to: Date, gapDays: number, userId?: string, sourceCode?: string): Promise<{ id: string; label: string }[]> {
  const userFilter = userId ? Prisma.sql`AND c.responsible_user_id = ${userId}::uuid` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string; label: string }[]>(reactivationSql(Prisma.sql`
    WITH events AS (
      SELECT lr.client_id, lr.occurred_at AS at FROM lead_requests lr WHERE lr.client_id IS NOT NULL AND lr.occurred_at >= ${from} AND lr.occurred_at < ${to}
      UNION ALL
      SELECT n.client_id, n.opened_at AS at FROM client_needs n WHERE n.opened_at >= ${from} AND n.opened_at < ${to}
    ),
    first_event AS (SELECT client_id, min(at) AS at FROM events GROUP BY client_id)
    SELECT fe.client_id AS id, c.display_name AS label
    FROM first_event fe
    JOIN clients c ON c.id = fe.client_id
    WHERE c.created_at < fe.at - make_interval(days => ${gapDays})
      ${userFilter}
      ${sourceCode ? Prisma.sql`AND EXISTS (SELECT 1 FROM lead_requests src WHERE src.client_id = c.id AND src.source_code = ${sourceCode} AND src.occurred_at >= ${from} AND src.occurred_at < ${to})` : Prisma.empty}
      AND NOT EXISTS (SELECT 1 FROM lead_requests x WHERE x.client_id = fe.client_id AND x.occurred_at >= fe.at - make_interval(days => ${gapDays}) AND x.occurred_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM communications x WHERE x.client_id = fe.client_id AND x.occurred_at >= fe.at - make_interval(days => ${gapDays}) AND x.occurred_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM client_needs x WHERE x.client_id = fe.client_id AND ((x.opened_at >= fe.at - make_interval(days => ${gapDays}) AND x.opened_at < fe.at) OR (x.updated_at >= fe.at - make_interval(days => ${gapDays}) AND x.updated_at < fe.at)))
      AND NOT EXISTS (SELECT 1 FROM need_property_matches m JOIN client_needs x ON x.id = m.client_need_id WHERE x.client_id = fe.client_id AND m.offered_at >= fe.at - make_interval(days => ${gapDays}) AND m.offered_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM showings s JOIN client_needs x ON x.id = s.client_need_id WHERE x.client_id = fe.client_id AND s.scheduled_at >= fe.at - make_interval(days => ${gapDays}) AND s.scheduled_at < fe.at)
      AND NOT EXISTS (SELECT 1 FROM tasks t JOIN task_clients tc ON tc.task_id = t.id WHERE tc.client_id = fe.client_id AND t.completed_at >= fe.at - make_interval(days => ${gapDays}) AND t.completed_at < fe.at)
  `));
  return rows;
}

export async function countReactivatedClients(from: Date, to: Date, gapDays: number, userId?: string): Promise<number> {
  return (await listReactivatedClients(from, to, gapDays, userId)).length;
}
