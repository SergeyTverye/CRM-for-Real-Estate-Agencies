import { notFound } from "next/navigation";
import Link from "next/link";
import { NotFoundError } from "@/shared/errors";
import { requirePageActor } from "@/server/page-auth";
import { searchParamsToObject } from "@/shared/validation";
import { getReportDetail } from "@/modules/reports/application/report-service";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { loadDictionaries, userOptions } from "@/server/options";
import { fmtDateTime, fmtDateOnly, fmtMoney } from "@/server/format";
import { Card, EmptyState, PageHeader, Pagination } from "@/ui/components";
import { reportRecord, type NamedLink } from "./record-presentation";
import { metricTitle } from "./metric-presentation";
const named = (link?: NamedLink) => link ? <Link className="link" href={link.href}>{link.label}</Link> : "—";
const dateOnly = (s: string) => fmtDateOnly(new Date(`${s}T00:00:00Z`));
export default async function ReportDetailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor({ manager: true });
  const sp = searchParamsToObject(await searchParams);
  const detail = await getReportDetail(actor, sp.metric ?? "newRequests", sp).catch(e => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [dicts, users] = await Promise.all([loadDictionaries(), userOptions()]);
  const title = metricTitle(detail.metric, (category, code) => dictLabel(dicts, category, code), id => users.find(u => u.value === id)?.label ?? "Сотрудник");
  const page = Math.max(1, Math.min(Math.ceil(detail.total / 50) || 1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const rows = await Promise.all(detail.rows.slice((page - 1) * 50, page * 50).map(async r => ({ ...r, record: await reportRecord(actor, r) })));
  const params = { from: detail.period.from, to: detail.period.to, ...(detail.filters.userId ? { userId: detail.filters.userId } : {}), ...(detail.filters.sourceCode ? { sourceCode: detail.filters.sourceCode } : {}) };
  return <div><PageHeader title={`${title} · ${detail.total}`} subtitle={`${dateOnly(detail.period.from)} — ${dateOnly(detail.period.to)} (${detail.period.timeZone})${detail.filters.userId ? ` · ${users.find(u => u.value === detail.filters.userId)?.label ?? "Сотрудник"}` : ""}${detail.filters.sourceCode ? ` · ${dictLabel(dicts, "lead_source", detail.filters.sourceCode)}` : ""}`} back={{ href: `/reports?${new URLSearchParams(params)}`, label: "К отчёту с теми же фильтрами" }} />
    <Card title="Первичные записи" bodyClassName="table-scroll">
      {rows.length ? <table className="table"><thead><tr><th>Запись</th><th>Клиент / объект</th><th>Сотрудник</th><th>Источник</th><th>Статус</th><th>Дата и время</th><th>Сумма</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}>
        <td><Link className="link" href={r.href}>{r.record.label}</Link></td><td>{named(r.record.client)}<br />{named(r.record.property)}</td>
        <td>{detail.metric.startsWith("activity:") ? users.find(u => u.value === detail.metric.split(":")[1])?.label ?? "Сотрудник" : r.record.employee ?? "—"}</td><td>{r.record.sourceCode ? dictLabel(dicts, "lead_source", r.record.sourceCode) : "—"}</td><td>{r.record.status ?? "—"}</td><td className="whitespace-nowrap">{fmtDateTime(r.record.at).replace(",", "")}</td><td>{fmtMoney(r.amount)}</td>
      </tr>)}</tbody></table> : <EmptyState title="Записей в выбранном срезе нет" />}
      <Pagination page={page} pageSize={50} total={detail.total} basePath="/reports/detail" params={{ ...params, metric: detail.metric }} />
    </Card>
  </div>;
}
