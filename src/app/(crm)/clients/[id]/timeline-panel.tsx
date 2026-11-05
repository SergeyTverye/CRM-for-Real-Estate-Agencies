import Link from "next/link";
import type { Actor } from "@/modules/auth/domain/actor";
import { getClientTimelinePage, TIMELINE_KINDS } from "@/modules/clients/application/timeline-service";
import { ValidationError } from "@/shared/errors";
import { fmtDateTime } from "@/server/format";
import { labelOf } from "@/shared/codebook";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { loadDictionaries, userOptions } from "@/server/options";
import { Card, EmptyState, FilterBar, FilterField, Select } from "@/ui/components";

export async function ClientTimelinePanel({ actor, clientId, filters }: { actor: Actor; clientId: string; filters: Record<string, string> }) {
  let data;
  try { data = await getClientTimelinePage(actor, clientId, filters); }
  catch(e) { if (e instanceof ValidationError) return <div role="alert" className="alert alert-warning">{e.message} <Link className="link" href={`/clients/${clientId}?tab=history`}>Сбросить фильтры</Link></div>; throw e; }
  const [dicts, users] = await Promise.all([loadDictionaries(), userOptions()]);
  const base = `/clients/${clientId}`;
  const next = new URLSearchParams({ ...filters, tab: "history", ...(data.nextCursor ? { cursor: data.nextCursor } : {}) });
  return <div className="space-y-4">
    <Card title="Текущие этапы потребностей">
      {data.needs.length ? <ul className="space-y-2">{data.needs.map(n => <li key={n.id}><Link className="link" href={`/needs/${n.id}`}>{dictLabel(dicts, "need_operation_type", n.operationType)} · {dictLabel(dicts, "property_type", n.propertyType)}</Link> — {labelOf("needStage", n.stage)} · {labelOf("needStatus", n.status)}</li>)}</ul> : <p>Потребностей нет</p>}
    </Card>
    <FilterBar action={base} resetHref={`${base}?tab=history`}>
      <input type="hidden" name="tab" value="history" />
      <FilterField label="Потребность"><Select name="needId" value={filters.needId} placeholder="Все" options={data.needs.map(n => ({ value: n.id, label: `${dictLabel(dicts, "need_operation_type", n.operationType)} · ${dictLabel(dicts, "property_type", n.propertyType)} · ${labelOf("needStage", n.stage)}` }))} /></FilterField>
      <FilterField label="Вид события"><Select name="kind" value={filters.kind} placeholder="Все" options={Object.entries(TIMELINE_KINDS).map(([value,label]) => ({value,label}))} /></FilterField>
      <FilterField label="Сотрудник"><Select name="employeeId" value={filters.employeeId} placeholder="Все" options={users} /></FilterField>
      <FilterField label="С даты"><input className="input" type="date" name="from" defaultValue={filters.from} /></FilterField>
      <FilterField label="По дату"><input className="input" type="date" name="to" defaultValue={filters.to} /></FilterField>
    </FilterBar>
    <Card title="История клиента">
      {data.items.length ? <ol className="divide-y divide-slate-100">{data.items.map(e => <li key={`${e.sortKind ?? e.kind}:${e.id}`} id={e.id} className="py-3">
        <div className="text-xs text-slate-500">{fmtDateTime(e.at)} · {TIMELINE_KINDS[e.kind]} · {e.author}</div>
        <Link className="link font-medium" href={e.href}>{e.title}</Link>{e.status ? <span className="ml-2 text-sm">{e.status}</span> : null}
        {e.details ? <p className="whitespace-pre-wrap text-sm text-slate-600">{e.details}</p> : null}
      </li>)}</ol> : <EmptyState title="Событий по выбранным условиям нет" />}
      {data.nextCursor ? <Link className="btn mt-3" href={`${base}?${next}`}>Более ранние события →</Link> : null}
      {filters.cursor ? <Link className="btn ml-2 mt-3" href={`${base}?${new URLSearchParams(Object.entries({...filters, tab: "history"}).filter(([key]) => key !== "cursor"))}`}>К началу истории</Link> : null}
    </Card>
  </div>;
}
