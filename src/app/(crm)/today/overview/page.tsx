import { ContactControl } from "../../requests/contact-control";
import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { getManagerReport } from "@/modules/reports/application/report-service";
import { getTodayView } from "@/modules/tasks/application/task-queries";
import { listDeals } from "@/modules/deals/application/deal-service";
import { getOperationsStatus } from "@/modules/operations/application/operations-service";
import { labelOf } from "@/shared/codebook";
import { fmtDate, fmtDateOnly, fmtDateTime, fmtMoney } from "@/server/format";
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/ui/components";

export const metadata = { title: "Обзор руководителя" };

function hoursSince(d: Date): number {
  return (Date.now() - d.getTime()) / 3_600_000;
}

/**
 * Режим «Обзор» стартового экрана руководителя (ТЗ 37.18): KPI за период по тем же первичным данным,
 * «Требует внимания», договоры и реклама с ближайшим сроком, нагрузка по сотрудникам, последние сделки,
 * состояние backup. Каждая цифра ведёт к отфильтрованному списку. вручную редактируемых цифр нет.
 */
export default async function ManagerOverviewPage() {
  const actor = await requirePageActor({ manager: true });
  const [report, today, deals, ops] = await Promise.all([
    getManagerReport(actor, {}),
    getTodayView(actor, { scope: "all" }),
    listDeals(actor, { pageSize: 5 }),
    getOperationsStatus(actor),
  ]);
  const kpiKeys = ["newRequests", "activeNeeds", "staleNeeds", "overdue", "showings", "dealsActive"];
  const kpis = report.kpis.filter((k) => kpiKeys.includes(k.key));
  const deadlines = [...today.controls.documents, ...today.controls.advertising].sort((a, b) => a.dateLabel.getTime() - b.dateLabel.getTime()).slice(0, 10);
  const lastBackup = ops.lastLocalBackup;
  const backupAgeHours = lastBackup ? hoursSince(lastBackup.startedAt) : null;
  return (
    <div>
      <PageHeader
        title="Обзор руководителя"
        subtitle={`Период показателей: ${fmtDateOnly(new Date(`${report.period.from}T00:00:00Z`))} — ${fmtDateOnly(new Date(`${report.period.to}T00:00:00Z`))}`}
        actions={
          <>
            <Link href="/today?scope=all" className="btn">
              Действия всех сотрудников
            </Link>
            <Link href="/reports" className="btn">
              Подробный отчёт
            </Link>
          </>
        }
      />
      <ContactControl actor={actor} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Link key={k.key} href={k.href ?? "/reports"} className="card block p-3 hover:border-brand-500">
            <div className="text-xs text-slate-500">{k.label}</div>
            <div className={`mt-1 text-2xl font-semibold ${k.key === "overdue" && k.value > 0 ? "text-red-700" : "text-slate-900"}`}>{k.value}</div>
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={`Требует внимания: просрочено ${today.counters.overdue}`} bodyClassName="">
          {today.overdue.length === 0 ? (
            <EmptyState title="Просроченных действий нет" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {today.overdue.slice(0, 12).map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-2 px-4 py-2">
                  <div>
                    <Link href={`/tasks/${t.id}`} className="link">
                      {t.title}
                    </Link>
                    <div className="text-xs text-red-700">срок {fmtDateTime(t.dueAt)}</div>
                  </div>
                  <span className="text-xs text-slate-500">{t.responsible.displayName}</span>
                </li>
              ))}
            </ul>
          )}
          {today.counters.needsWithoutNextAction > 0 ? (
            <div className="border-t border-slate-100 px-4 py-2 text-sm">
              <Link className="link" href="/needs?withoutNextAction=yes">
                Потребностей без следующего действия: {today.counters.needsWithoutNextAction}
              </Link>
            </div>
          ) : null}
        </Card>
        <Card title="Договоры и реклама с ближайшим сроком" bodyClassName="">
          {deadlines.length === 0 ? (
            <EmptyState title="Ближайших сроков нет" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {deadlines.map((c) => (
                <li key={`${c.kind}-${c.id}`} className="flex items-start justify-between gap-2 px-4 py-2">
                  <Link href={c.href} className="link">
                    {c.title}
                  </Link>
                  <span className={`text-xs ${c.overdue ? "text-red-700" : "text-slate-500"}`}>
                    {c.isDateOnly ? fmtDateOnly(c.dateLabel) : fmtDateTime(c.dateLabel)}
                    {c.responsibleName ? ` · ${c.responsibleName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="По сотрудникам (за период)" bodyClassName="">
          <table className="table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Обращения</th>
                <th>Показы</th>
                <th>Задачи выполнено</th>
                <th>Просрочено</th>
              </tr>
            </thead>
            <tbody>
              {report.activity.map((a) => (
                <tr key={a.user.id}>
                  <td>
                    <Link className="link" href={`/today?userId=${a.user.id}`}>
                      {a.user.displayName}
                    </Link>
                  </td>
                  <td>{a.requests}</td>
                  <td>{a.showingsCompleted}</td>
                  <td>{a.tasksCompleted}</td>
                  <td className={a.overdue ? "font-medium text-red-700" : ""}>{a.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Последние сделки" bodyClassName="" actions={<Link href="/deals" className="btn btn-sm">Все сделки</Link>}>
          {deals.items.length === 0 ? (
            <EmptyState title="Сделок пока нет" />
          ) : (
            <table className="table">
              <tbody>
                {deals.items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link className="link" href={`/deals/${d.id}`}>
                        {d.property.addressText}
                      </Link>
                      <div className="text-xs text-slate-500">{d.legalEntity.displayName}</div>
                    </td>
                    <td>
                      <StatusBadge status={d.status} label={labelOf("dealStatus", d.status)} />
                    </td>
                    <td>{fmtMoney(d.dealPrice)}</td>
                    <td className="text-xs text-slate-500">{fmtDate(d.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Резервное копирование" actions={<Link href="/operations" className="btn btn-sm">Эксплуатация</Link>}>
          {lastBackup ? (
            <div className="space-y-1 text-sm">
              <div>
                Последняя локальная копия: <span className="font-medium">{lastBackup.backupId}</span>{" "}
                {backupAgeHours !== null && backupAgeHours > 26 ? <Badge tone="red">старше суток</Badge> : <Badge tone="green">актуальна</Badge>}
              </div>
              <div className="text-slate-500">Off-site targets: {ops.remotes.length ? ops.remotes.map((r) => `${r.remoteCode} — ${r.lastVerified ? "verified" : "нет проверенной копии"}`).join("; ") : "не настроены"}</div>
            </div>
          ) : (
            <div className="alert alert-warning">Успешных резервных копий нет — создайте копию в разделе «Эксплуатация».</div>
          )}
        </Card>
      </div>
    </div>
  );
}
