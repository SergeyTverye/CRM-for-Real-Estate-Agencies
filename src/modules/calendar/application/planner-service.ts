import { lockSql, plannerSql } from "@/shared/db/dialect";
import { z } from "zod";
import { db, Prisma, transaction } from "@/shared/db/client";
import { type Actor, isManager } from "@/modules/auth/domain/actor";
import { clientScope } from "@/modules/access/domain/scopes";
import { ForbiddenError, NotFoundError, StaleUpdateError } from "@/shared/errors";
import { parseInput, zExpectedUpdatedAt } from "@/shared/validation";
import { getConfig } from "@/shared/config/env";
import { localDateString } from "@/shared/time";
import { writeAudit } from "@/modules/audit/application/audit";
import { listCalendar, rangeSchema } from "./calendar-service";
import { mergeDayAggregates, type DayAggregate } from "../domain/planner-rules";

export async function getPlannerSetting() {
  const row = await db.plannerSetting.findFirst();
  return { soonThresholdHours: row?.soonThresholdHours ?? 24, updatedAt: row?.updatedAt ?? null };
}
export async function setPlannerSetting(actor: Actor, input: unknown) {
  if (!isManager(actor)) throw new ForbiddenError();
  const data = parseInput(z.object({ soonThresholdHours: z.number().int().min(1).max(8760), expectedUpdatedAt: zExpectedUpdatedAt.nullable() }), input);
  return transaction(async tx => {
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(3105, 2)`));
    const previous = await tx.plannerSetting.findFirst();
    if ((previous?.updatedAt.toISOString() ?? null) !== (data.expectedUpdatedAt?.toISOString() ?? null)) throw new StaleUpdateError();
    const row = previous ? await tx.plannerSetting.update({ where: { id: previous.id }, data: { soonThresholdHours: data.soonThresholdHours, updatedBy: actor.userId } })
      : await tx.plannerSetting.create({ data: { soonThresholdHours: data.soonThresholdHours, updatedBy: actor.userId } });
    await writeAudit(tx, { actorUserId: actor.userId, action: "planner.setting_changed", entityType: "PlannerSetting", entityId: row.id, after: { soonThresholdHours: row.soonThresholdHours } });
    return { soonThresholdHours: row.soonThresholdHours, updatedAt: row.updatedAt };
  });
}

export async function aggregatePlanner(actor: Actor, input: unknown, now = new Date()) {
  const f = parseInput(rangeSchema, input);
  if (f.clientId && !await db.client.count({ where: { id: f.clientId, ...clientScope(actor) } })) throw new NotFoundError();
  const timeZone = getConfig().APP_TIMEZONE;
  const { soonThresholdHours } = await getPlannerSetting();
  const yes = Prisma.sql`TRUE`, uid = actor.userId;
  const employee = (alias: string) => f.employee ? Prisma.sql`${Prisma.raw(alias)} = ${f.employee}::uuid` : yes;
  const taskClient = f.clientId ? Prisma.sql`(EXISTS (SELECT 1 FROM task_clients l WHERE l.task_id=t.id AND l.client_id=${f.clientId}::uuid) OR EXISTS (SELECT 1 FROM task_needs l JOIN client_needs n ON n.id=l.client_need_id WHERE l.task_id=t.id AND n.client_id=${f.clientId}::uuid))` : yes;
  const taskScope = isManager(actor) ? yes : Prisma.sql`(t.responsible_user_id=${uid}::uuid OR t.created_by=${uid}::uuid)`;
  const showingScope = isManager(actor) ? yes : Prisma.sql`(s.responsible_user_id=${uid}::uuid OR n.responsible_user_id=${uid}::uuid OR c.responsible_user_id=${uid}::uuid)`;
  const agreementScope = isManager(actor) ? yes : Prisma.sql`(a.responsible_user_id=${uid}::uuid OR c.responsible_user_id=${uid}::uuid OR p.responsible_user_id=${uid}::uuid)`;
  const safeEvent = Prisma.sql`(e.owner_user_id=${uid}::uuid OR e.visibility='public') AND ${isManager(actor) ? yes : Prisma.sql`(
    NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=e.client_id AND c.responsible_user_id<>${uid}::uuid)
    AND NOT EXISTS(SELECT 1 FROM client_needs n JOIN clients c ON c.id=n.client_id WHERE n.id=e.need_id AND (c.responsible_user_id<>${uid}::uuid OR NOT (n.responsible_user_id=${uid}::uuid OR c.responsible_user_id=${uid}::uuid)))
    AND (e.deal_id IS NULL OR EXISTS(SELECT 1 FROM deals d WHERE d.id=e.deal_id AND (d.responsible_user_id=${uid}::uuid OR EXISTS(SELECT 1 FROM deal_parties dp JOIN clients c ON c.id=dp.client_id WHERE dp.deal_id=d.id AND c.responsible_user_id=${uid}::uuid))))
    AND NOT EXISTS(SELECT 1 FROM deal_parties dp JOIN clients c ON c.id=dp.client_id WHERE dp.deal_id=e.deal_id AND c.responsible_user_id<>${uid}::uuid))`}`;
  const branches: Prisma.Sql[] = [];
  if (!f.type || f.type === "task") branches.push(Prisma.sql`SELECT t.due_at AS at, t.status, t.priority FROM tasks t WHERE ${taskScope} AND ${employee("t.responsible_user_id")} AND ${taskClient}
    AND t.due_at>=${f.from} AND t.due_at<${f.to} AND NOT(t.task_type='showing_or_meeting' AND EXISTS(SELECT 1 FROM task_showings l WHERE l.task_id=t.id))`);
  if (!f.type || f.type === "showing") branches.push(Prisma.sql`SELECT s.scheduled_at AS at, s.status, 'normal' AS priority FROM showings s JOIN client_needs n ON n.id=s.client_need_id JOIN clients c ON c.id=n.client_id
    WHERE ${showingScope} AND ${employee("s.responsible_user_id")} AND ${f.clientId ? Prisma.sql`n.client_id=${f.clientId}::uuid` : yes} AND s.scheduled_at>=${f.from} AND s.scheduled_at<${f.to}`);
  if (!f.type || f.type === "agreement") branches.push(Prisma.sql`SELECT (v.at::timestamp AT TIME ZONE ${timeZone}) AS at, a.status, 'normal' AS priority FROM agreements a
    LEFT JOIN clients c ON c.id=a.client_id LEFT JOIN properties p ON p.id=a.property_id CROSS JOIN LATERAL (VALUES(a.valid_from),(a.valid_until)) v(at)
    WHERE a.archived_at IS NULL AND ${agreementScope} AND ${employee("a.responsible_user_id")} AND ${f.clientId ? Prisma.sql`a.client_id=${f.clientId}::uuid` : yes}
    AND (v.at::timestamp AT TIME ZONE ${timeZone})>=${f.from} AND (v.at::timestamp AT TIME ZONE ${timeZone})<${f.to}`);
  if (!f.type || f.type === "calendar_event") branches.push(Prisma.sql`SELECT e.start_at AS at, CASE WHEN ${safeEvent} THEN 'scheduled' ELSE 'busy' END AS status, 'normal' AS priority FROM calendar_events e
    WHERE e.archived_at IS NULL AND e.recurrence_rule IS NULL AND ${employee("e.owner_user_id")} AND e.start_at<${f.to} AND e.end_at>${f.from}
    AND ${f.clientId ? Prisma.sql`(${safeEvent}) AND (e.client_id=${f.clientId}::uuid OR EXISTS(SELECT 1 FROM client_needs n WHERE n.id=e.need_id AND n.client_id=${f.clientId}::uuid))` : yes}`);
  const toneFilter = f.deadline ? ({ overdue: "red", soon: "yellow", controlled: "green", closed: "gray" } as const)[f.deadline] : null;
  const rows = await db.$queryRaw<DayAggregate[]>(plannerSql(Prisma.sql`WITH sources AS (${Prisma.join(branches," UNION ALL ")}), colored AS (
    SELECT to_char(at AT TIME ZONE ${timeZone},'YYYY-MM-DD') AS day, CASE
      WHEN status IN ('completed','cancelled','no_show','archived','expired','terminated') THEN 'gray'
      WHEN at<${now} OR priority='critical' THEN 'red'
      WHEN at<=${new Date(+now + soonThresholdHours*3600000)} THEN 'yellow' ELSE 'green' END AS tone
    FROM sources WHERE ${f.status ? Prisma.sql`status=${f.status}` : yes} AND ${f.priority ? Prisma.sql`priority=${f.priority}` : yes})
    SELECT day, count(*)::int AS total, count(*) FILTER(WHERE tone='red')::int AS red, count(*) FILTER(WHERE tone='yellow')::int AS yellow,
      count(*) FILTER(WHERE tone='green')::int AS green, count(*) FILTER(WHERE tone='gray')::int AS gray FROM colored
    WHERE ${toneFilter ? Prisma.sql`tone=${toneFilter}` : yes} GROUP BY day ORDER BY day`));
  if (!f.type || f.type === "calendar_event") {
    const recurring = await listCalendar(actor, { ...input as object, type: "calendar_event" }, { recurringOnly: true, now, soonHours: soonThresholdHours });
    for (const item of recurring) {
      const row: DayAggregate = { day: localDateString(new Date(item.start), timeZone), total: 1, red: 0, yellow: 0, green: 0, gray: 0 };
      row[item.tone!] = 1; rows.push(row);
    }
  }
  const days = mergeDayAggregates(rows);
  return { days, total: days.reduce((sum,d) => sum+d.total,0), soonThresholdHours };
}
