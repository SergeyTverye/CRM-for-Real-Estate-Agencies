import { notFound } from "next/navigation";
import { NotFoundError } from "@/shared/errors";
import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { searchParamsToObject } from "@/shared/validation";
import { getReportDetail } from "@/modules/reports/application/report-service";
import { Card, PageHeader } from "@/ui/components";
export default async function ReportDetailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor({ manager: true }); const sp = searchParamsToObject(await searchParams);
  const detail = await getReportDetail(actor, sp.metric ?? "newRequests", sp).catch(e => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <div><PageHeader title={`Детализация · ${detail.total}`} subtitle={`${detail.period.from} — ${detail.period.to} (${detail.period.timeZone})`} />
    <Card title="Первичные записи"><table className="table"><thead><tr><th>Запись</th><th>Сумма (если применимо)</th></tr></thead><tbody>{detail.rows.map(r => <tr key={r.id}><td><Link className="link" href={r.href}>{r.label} · {r.id}</Link></td><td>{r.amount ?? "—"}</td></tr>)}</tbody></table>{!detail.total ? <p>Записей в выбранном срезе нет.</p> : null}</Card>
  </div>;
}
