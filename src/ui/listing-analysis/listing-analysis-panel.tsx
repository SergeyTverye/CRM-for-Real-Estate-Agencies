"use client";
import { useState } from "react";
import Link from "next/link";
import type { SearchFilters } from "@/modules/property-search/domain/types";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";

type Evidence = {criterion:string;result:string;quote:string|null;reason:string};
type Result = {ranking?:{listingId:string;reasons:string[]}[];cacheHit?:boolean;text?:string;warning?:string;pendingActionId?:string|null;items?:{listingId:string;cacheHit:boolean;evidence:Evidence[];unresolved:string[];url:string}[];tasks?:{listingId?:string;title?:string;description?:string}[];questions?:{listingId:string;questions:string[]}[];tradeoffs?:{listingId:string;points:{comparedListingId:string;area:string;price:string}[]}[]};
/** Mount with key=selection+filters to discard old previews when the search changes. */
export function ListingAnalysisPanel({listingIds,filters,needId,labels={},enabled=true,statusMessage,settingsUrl}:{listingIds:string[];filters:SearchFilters;needId?:string;labels?:Record<string,string>;enabled?:boolean;statusMessage?:string|null;settingsUrl?:string|null}) {
  const action = useApiAction();
  const [result,setResult] = useState<Result|null>(null);
  const [dueAt,setDueAt] = useState("");
  const [confirmed,setConfirmed] = useState(false);
  useUnsavedChangesWarning(!!result?.pendingActionId && !confirmed);
  const label = (id:string) => labels[id] ?? "Выбранное объявление";
  async function request(kind:string) {
    const response = await action.run(()=>apiCall<Result>("POST",`/api/v1/property-search/analysis/${kind}`,{listingIds,filters,needId}));
    if(response) {setResult(response);setConfirmed(false);}
  }
  async function confirmTasks() {
    if(!dueAt || !result?.pendingActionId) return;
    const response = await action.run(()=>apiCall("POST","/api/v1/property-search/analysis/suggest-tasks/confirm",{pendingActionId:result.pendingActionId,confirmed:true,dueAt:new Date(dueAt).toISOString()}));
    if(response) setConfirmed(true);
  }
  return <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-label="Анализ объявлений ИИ">
    <h2 className="font-semibold">Анализ выбранных объявлений</h2>
    <p className="text-sm text-slate-600">Проверяются только неизвестные обязательные признаки. Анализ может расходовать бюджет ИИ; повтор неизменённых описаний берётся из кеша.</p>
    {!enabled && <p role="status">{statusMessage ?? "ИИ отключён. Ручной поиск, фильтры и экспорт доступны."}{settingsUrl && statusMessage ? <> · <Link className="link" href={settingsUrl}>Перейти к подключению Яндекс AI</Link></> : null}</p>}
    {!listingIds.length && <p>Выберите объявления в результатах поиска.</p>}
    <div className="flex flex-wrap gap-2">
      <button className="btn btn-secondary" disabled={!enabled || action.pending || !listingIds.length} onClick={()=>request("batch")}>Проверить неизвестные признаки</button>
      <button className="btn btn-secondary" disabled={!enabled || action.pending || listingIds.length<2 || listingIds.length>10} onClick={()=>request("rank")}>Ранжировать выбранные с ИИ</button>
      <button className="btn btn-secondary" disabled={!enabled || action.pending || listingIds.length<2 || listingIds.length>4} onClick={()=>request("compare")}>Сравнить объекты</button>
      <button className="btn btn-secondary" disabled={!enabled || action.pending || !listingIds.length} onClick={()=>request("collection-text")}>Текст для подборки</button>
      <button className="btn btn-secondary" disabled={!enabled || action.pending || !listingIds.length} onClick={()=>request("suggest-tasks")}>Предложить задачи уточнения</button>
    </div>
    {action.pending && <p role="status">Подготавливаем результат…</p>}
    <FormErrorBanner error={action.error}/>
    {result?.warning && <p className="text-sm text-amber-800">{result.warning}</p>}
    {result?.ranking && <aside className="rounded border border-amber-300 bg-amber-50 p-3" aria-label="Рекомендация ИИ: порядок объявлений">
      <h3 className="font-semibold">Рекомендованный ИИ порядок {result.cacheHit ? "· из кеша" : ""}</h3>
      <p className="text-sm">Рекомендация по критериям запроса; требует проверки сотрудником. Факты объявления не изменены.</p>
      <ol className="list-decimal space-y-2 pl-5">{result.ranking.map(item=><li key={item.listingId}><strong>{label(item.listingId)}</strong>{item.reasons.map((reason,index)=><p className="text-sm" key={index}>{reason}</p>)}</li>)}</ol>
    </aside>}
    {result?.text && <div className="whitespace-pre-wrap rounded bg-slate-50 p-3">{result.text}</div>}
    {result?.tradeoffs?.map(item=><div key={item.listingId}><h3 className="font-medium">{label(item.listingId)}: компромиссы</h3>{item.points.map(point=><p key={point.comparedListingId} className="text-sm">По сравнению с {label(point.comparedListingId)}: {point.area} {point.price}</p>)}</div>)}
    {result?.items?.map(item=><article key={item.listingId} className="border-t pt-3">
      <h3 className="font-medium">{label(item.listingId)} {item.cacheHit ? "· из кеша" : ""}</h3>
      <a className="text-blue-700 underline" href={item.url} target="_blank" rel="noreferrer">Источник объявления</a>
      {!item.evidence.length && <p>Неизвестных обязательных признаков для анализа описания нет.</p>}
      {item.evidence.map(e=><div key={e.criterion} className="mt-2"><strong>{e.criterion}</strong>: {e.result==="matched" ? "Указано в описании" : e.result==="contradicted" ? "Описание противоречит условию" : "Требует проверки"}{e.quote && <blockquote className="border-l-2 pl-2">{e.quote}</blockquote>}<p className="text-sm text-slate-600">{e.reason}</p></div>)}
      {!!item.unresolved.length && <p className="text-sm">Проверить сотруднику: {item.unresolved.join("; ")}</p>}
    </article>)}
    {result?.questions?.map(item=><div key={item.listingId}><h3>{label(item.listingId)}: вопросы продавцу</h3><ul className="list-disc pl-5">{item.questions.map(q=><li key={q}>{q}</li>)}</ul></div>)}
    {result?.tasks && !result.tasks.length && <p>Задачи уточнения не требуются.</p>}
    {result?.tasks?.map((task,index)=><div key={index}><strong>{task.title}</strong><p className="whitespace-pre-wrap text-sm">{task.description}</p></div>)}
    {result?.pendingActionId && !confirmed && <div className="space-y-2"><label className="block">Срок задач<input className="input ml-2" type="datetime-local" required value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label><button className="btn btn-primary" disabled={!dueAt || action.pending} onClick={confirmTasks}>Подтвердить создание задач</button></div>}
    {confirmed && <p role="status">Задачи созданы. Повторное подтверждение не создаёт дубликаты.</p>}
  </section>;
}
