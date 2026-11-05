import Link from "next/link";
import { AdvertisementFilter } from "./advertisement-filter";
import { requirePageActor } from "@/server/page-auth";
import { getCallSourceReport, getCallSourceDetails } from "@/modules/reports/application/call-source-service";
import { pickCallContext } from "@/modules/requests/application/call-pickers";
import { searchParamsToObject } from "@/shared/validation";
import { dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { fmtDateTime } from "@/server/format";
import { labelOf, optionsOf } from "@/shared/codebook";
import { ValidationError } from "@/shared/errors";
import { PageHeader, Card, FilterBar, FilterField, Select, EmptyState } from "@/ui/components";
export const metadata = { title: "Звонки и источники" };
export default async function CallSourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  let report, details;
  try { [report, details] = await Promise.all([getCallSourceReport(actor, sp), getCallSourceDetails(actor, sp)]); }
  catch(e) { if (e instanceof ValidationError) return <div role="alert" className="alert alert-warning">{e.message} <Link href="/reports/sources" className="link">Сбросить фильтры</Link></div>; throw e; }
  const [dicts, users, ads] = await Promise.all([loadDictionaries(), userOptions(), sp.advertisementId ? pickCallContext(actor, {kind:"advertisement", id: sp.advertisementId}) : Promise.resolve({items:[]})]);
  const href = (patch: Record<string, string>) => `/reports/sources?${new URLSearchParams({...sp, page:"1", ...patch})}`;
  const metrics = { calls: "Все звонки", clients: "Звонки доступных клиентов", needs: "Звонки с потребностью", showings: "Звонки с проведённым показом", deals: "Звонки с завершённой сделкой" };
  return <div><PageHeader title="Звонки и источники" subtitle="Ручной журнал: звонки считаются отдельно от уникальных доступных клиентов" back={{href:"/requests",label:"Обращения"}} />
    <FilterBar action="/reports/sources" resetHref="/reports/sources">
      <FilterField label="Источник"><Select name="sourceCode" value={sp.sourceCode} placeholder="Все" options={dictOptions(dicts,"lead_source",sp.sourceCode)} /></FilterField>
      <FilterField label="Сотрудник"><Select name="employeeId" value={sp.employeeId} placeholder="Все доступные" options={users} /></FilterField>
      <FilterField label="Реклама"><AdvertisementFilter initial={ads.items[0] ?? null} /></FilterField>
      <FilterField label="Результат"><Select name="outcomeCode" value={sp.outcomeCode} placeholder="Все" options={optionsOf("callOutcome")} /></FilterField>
      <FilterField label="С даты"><input type="date" name="from" defaultValue={sp.from} className="input" /></FilterField>
      <FilterField label="По дату"><input type="date" name="to" defaultValue={sp.to} className="input" /></FilterField>
    </FilterBar>
    <Card title="Статистика источников"><p className="mb-3 text-sm text-slate-600">Конверсия: число звонков, достигших этапа / все звонки выборки, включая спам, ошибочные и разовые. Потребность — явная связь; показ — проведён после звонка; сделка — завершена после звонка с тем же клиентом и объектом из его потребности. Последующие этапы учитываются по текущему состоянию, даже за пределами периода звонков. Уникальные клиенты считаются только среди доступных карточек.</p>
      <table className="table"><thead><tr><th>Источник</th><th>Звонки</th><th>Уникальные клиенты</th><th>В потребности</th><th>В показы</th><th>В сделки</th></tr></thead><tbody>
        {[...report.sources,{sourceCode:"__total",...report.total}].map(r=><tr key={r.sourceCode}><td>{r.sourceCode === "__total" ? "Всего" : dictLabel(dicts,"lead_source",r.sourceCode)}</td>
          <td><Link className="link" href={href({metric:"calls",sourceCode:r.sourceCode === "__total" ? sp.sourceCode ?? "" : r.sourceCode})}>{r.calls}</Link></td><td>{r.clients}</td>
          {(["needs","showings","deals"] as const).map(metric=><td key={metric}><Link className="link" href={href({metric,sourceCode:r.sourceCode === "__total" ? sp.sourceCode ?? "" : r.sourceCode})}>{r[metric]} / {r.calls} ({r.calls ? `${Math.round(r[metric]/r.calls*1000)/10}%` : "—"})</Link></td>)}</tr>)}
      </tbody></table>
    </Card>
    <div className="mt-4"><Card title="Первичные записи"><div className="mb-3 flex flex-wrap gap-2">{Object.entries(metrics).map(([metric,label])=><Link className={`btn btn-sm ${(sp.metric ?? "calls") === metric ? "btn-primary" : ""}`} key={metric} href={href({metric})}>{label}</Link>)}</div>
      {details.items.length ? <table className="table"><thead><tr><th>Время</th><th>Источник</th><th>Итог</th><th>Результат</th><th>Ответственный</th></tr></thead><tbody>{details.items.map(r=><tr key={r.id}><td><Link className="link" href={`/requests/${r.id}`}>{fmtDateTime(r.at)}</Link></td><td>{dictLabel(dicts,"lead_source",r.sourceCode)}</td><td>{r.summary ?? "—"}</td><td>{r.outcomeCode ? labelOf("callOutcome",r.outcomeCode) : labelOf("leadResult",r.resultCode)}</td><td>{r.responsible}</td></tr>)}</tbody></table> : <EmptyState title="Звонков по выбранным условиям нет" />}
      <div className="mt-3 flex gap-2">{details.page > 1 ? <Link className="btn" href={href({page:String(details.page-1)})}>Назад</Link>:null}{details.hasNext ? <Link className="btn" href={href({page:String(details.page+1)})}>Далее</Link>:null}</div>
    </Card></div>
  </div>;
}
