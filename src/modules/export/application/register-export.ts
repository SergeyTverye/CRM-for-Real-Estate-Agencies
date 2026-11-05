import { z } from "zod";
import { db } from "@/shared/db/client";
import { parseInput, zCode, zDateOnly, zUuid } from "@/shared/validation";
import { dealScope } from "@/modules/access/domain/scopes";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { listDeals } from "@/modules/deals/application/deal-service";
import { listTasks } from "@/modules/tasks/application/task-queries";
import { getConfig } from "@/shared/config/env";
import { startOfDayInTz } from "@/shared/time";
import { ValidationError } from "@/shared/errors";
import { toCsv } from "./export-service";
const kindSchema = z.enum(["deals", "commissions", "tasks"]);
const commissionFilters = z.object({ status: zCode("commissionStatus").optional(), responsibleUserId: zUuid.optional(), legalEntityId: zUuid.optional(), dealId: zUuid.optional(), from: zDateOnly.optional(), to: zDateOnly.optional() });
/** Reuse the list services for exactly the same filters and server-side access policy. */
export async function exportRegister(actor: Actor, kind: unknown, raw: Record<string, unknown>) {
  const name = parseInput(kindSchema, kind);
  const rows: Record<string, unknown>[] = [];
  let columns: string[];
  if (name === "commissions") {
    const f = parseInput(commissionFilters, raw);
    if (f.from && f.to && f.from > f.to) throw new ValidationError("Начало периода позже окончания");
    const zone = getConfig().APP_TIMEZONE;
    const from = f.from ? startOfDayInTz(new Date(f.from.getTime() + 12 * 3600000), zone) : undefined;
    const to = f.to ? startOfDayInTz(new Date(f.to.getTime() + 36 * 3600000), zone) : undefined;
    rows.push(...await db.dealCommission.findMany({ where: { ...(f.status ? { status: f.status } : {}), ...(from || to ? { receivedAt: { gte: from, lt: to } } : {}), deal: { AND: [dealScope(actor), { ...(f.dealId ? { id: f.dealId } : {}), ...(isManager(actor) && f.responsibleUserId ? { responsibleUserId: f.responsibleUserId } : {}), ...(f.legalEntityId ? { legalEntityId: f.legalEntityId } : {}) }] } }, select: { id: true, dealId: true, amount: true, status: true, dueAt: true, receivedAt: true }, orderBy: { id: "asc" } }));
    columns = ["id", "dealId", "amount", "status", "dueAt", "receivedAt"];
  } else {
    for (let page = 1; ; page++) {
      if (name === "deals") {
        const result = await listDeals(actor, { ...raw, page, pageSize: 100 });
        rows.push(...result.items.map(d => ({ id: d.id, address: d.property.addressText, legalEntity: d.legalEntity.displayName, status: d.status, openedAt: d.openedAt, closedAt: d.closedAt, dealPrice: d.dealPrice })));
        if (page * 100 >= result.total) break;
      } else {
        const result = await listTasks(actor, { ...raw, page, pageSize: 100 });
        rows.push(...result.items.map(t => ({ id: t.id, title: t.title, taskType: t.taskType, status: t.status, responsible: t.responsible.displayName, dueAt: t.dueAt, completedAt: t.completedAt })));
        if (page * 100 >= result.total) break;
      }
    }
    columns = name === "deals" ? ["id", "address", "legalEntity", "status", "openedAt", "closedAt", "dealPrice"] : ["id", "title", "taskType", "status", "responsible", "dueAt", "completedAt"];
  }
  return { csv: toCsv(rows, columns), fileName: `${name}.csv`, count: rows.length };
}
