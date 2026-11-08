"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SearchFilters, NormalizedListing, CriterionEvaluation, Source } from "@/modules/property-search/domain/types";
import type { DuplicateGroupDto } from "@/modules/listing-duplicates";
import { ListingDuplicateGroups } from "@/ui/listing-duplicates";
import { StartBrowserSession } from "@/ui/browser-session/start-session";
import { ListingAnalysisPanel } from "@/ui/listing-analysis/listing-analysis-panel";
import { apiCall, ApiCallError } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { freshnessSchema } from "@/modules/property-search/domain/freshness";
import { Modal } from "@/ui/client-kit";
import { FormErrorBanner } from "@/ui/form";
import { Badge, Card, EmptyState } from "@/ui/components";
import { labelOf } from "@/shared/codebook";
import { ListingPhoto } from "./listing-photo";
import { SearchFallback } from "./search-fallback";
import { sourceReason } from "./source-reason";
import { resultAddress, resultPriceUnit, evidenceLabel, translatedEvidence } from "./result-display";
import { formatPurposeLabel, SEARCH_HELP } from "./filter-presentation";
import { HelpTooltip } from "./help-tooltip";

type Fact={note?:string|null;propertyId?:string;bookmark?:boolean;inCollection?:boolean;proposed?:boolean};
type Row={bookmark?:boolean;inCollection?:boolean;proposed?:boolean;note?:string|null;collectionIds?:string[];propertyId?:string|null;id:string;listingId:string;source:string;url:string;verdict:string;criteria:CriterionEvaluation[];snapshot:(NormalizedListing & {sourceMethod?:string})|null;publishedAt:string|null;firstSeenAt:string;lastCheckedAt?:string|null;dateSource?:string|null;datePrecision:string|null;pricePerM2Rub:string|null;pricePerM2Unit:string|null;isNew:boolean;priceChanged:boolean};
type SourceProgress={browserSession?:{id:string;status:string;closeReason:string|null}|null;source:Source;status:string;reason:string|null;receivedCount?:number;acceptedCount?:number;resultCount:number;durationMs:number|null;depthReached?:unknown;needsUserAction?:boolean;statusReasonRu?:string|null;requestedCount?:number;coverageReason?:string|null};
type Progress={id:string;status:string;cancelRequested:boolean;sources:SourceProgress[]};
type Results={page:number;rows:Row[];total:number;revision:string;counts:Record<string,number>;unknownDateCount:number;incomplete:boolean;duplicateGroups:DuplicateGroupDto[];duplicateGroupingError?:string|null};
type Listing={id:string;source:string;sourceMethod:string;url:string;address:string|null;priceRub:string|null;areaM2:string|null;floorRaw:string|null;lastSeenAt:string;propertyId:string|null;operation?:string;priceUnit?:string|null};
const SORTS={match:"Совпадение предпочтений (без ИИ)",publication:"Дата публикации",first_seen:"Первое обнаружение",source_updated:"Обновление на площадке",price:"Цена",price_per_m2:"Цена за м²",area:"Площадь",last_checked:"Последняя проверка",price_change:"Изменение цены"};
const COLUMNS={source:"Источник",url:"Ссылка",address:"Адрес",price:"Цена",priceUnit:"Единица цены",pricePerM2Rub:"Цена за м²",pricePerM2Unit:"Единица / период за м²",area:"Площадь",floor:"Этаж",publishedAt:"Дата публикации",datePrecision:"Точность даты",dateSource:"Источник даты",firstSeenAt:"Впервые найдено CRM",lastCheckedAt:"Последняя проверка",purpose:"Назначение",district:"Район",verdict:"Соответствие",unknown:"Неизвестные критерии",owner:"Проверка собственника",note:"Примечание",links:"Все ссылки дублей",photos:"Фото"};
const DEFAULT_COLUMNS=["photos","source","address","price","pricePerM2Rub","area","publishedAt"];
const statusLabels:Record<string,string>={rate_limited:"Ограничение частоты запросов",parse_failed:"Ошибка разбора площадки",fetch_failed:"Ошибка получения",queued:"В очереди",running:"Выполняется",success:"Получено",completed:"Завершён",partial:"Частично",needs_user_action:"Нужна проверка сотрудника",blocked:"Заблокирован",timeout:"Время истекло",error:"Ошибка",disabled:"Отключён",cancelled:"Остановлен",unsupported_filter:"Фильтр не поддержан"};
const number=(v:unknown)=>v===null||v===undefined?"—":Number(v).toLocaleString("ru-RU");
const date=(v:string|null|undefined)=>v?new Date(v).toLocaleString("ru-RU",{timeZone:"Asia/Novosibirsk"}):"неизвестно";
function listing(row:Row):Listing {return {id:row.listingId,source:row.source,sourceMethod:row.snapshot?.sourceMethod??"scraper",url:row.url,address:row.snapshot?.address??null,priceRub:row.snapshot?.price??null,areaM2:row.snapshot?.area==null?null:String(row.snapshot.area),floorRaw:row.snapshot?.floor.raw??null,lastSeenAt:row.snapshot?.fetchedAt??row.firstSeenAt,propertyId:row.propertyId??null,operation:row.snapshot?.operation??undefined,priceUnit:row.snapshot?.priceUnit??undefined};}
function verdictBadge(verdict:string):ReactNode {
  if (verdict==="confirmed") return <Badge tone="green">Подходит</Badge>;
  if (verdict==="rejected") return <Badge tone="red">Исключено</Badge>;
  return <Badge tone="yellow">Требует проверки</Badge>;
}
function missingFields(row:Row):string[] {
  const s=row.snapshot,missing:string[]=[];
  if (s?.price==null) missing.push("цена");
  if (!s?.priceUnit) missing.push("единица цены");
  if (s?.area==null) missing.push("площадь");
  if (!s||s.floor.kind==="unknown") missing.push("этаж");
  if (!s?.district) missing.push("район");
  if (!s?.city) missing.push("город");
  if (!s?.purpose) missing.push("тип объекта");
  return missing;
}
function isSuspected(row:Row,groups:DuplicateGroupDto[]):boolean {
  if ((row.snapshot?.possibleDuplicateKeys?.length??0)>0) return true;
  return groups.some(g=>g.members.some(m=>m.listingId===row.listingId&&!m.releasedAt));
}

export function SearchResultsV31({runId,externalRefresh,knownFacts,filters,needId,aiEnabled,aiStatusMessage,aiSettingsUrl,replay,replayDate,view,onCompare,onBusy,renderActions}:{runId:string;externalRefresh:number;knownFacts:Record<string,Fact>;filters:SearchFilters;needId:string;aiEnabled:boolean;aiStatusMessage?:string|null;aiSettingsUrl?:string|null;replay:boolean;replayDate?:string|null;view:string;onCompare:(rows:unknown[])=>void;onBusy:(busy:boolean)=>void;renderActions:(listing:Listing)=>ReactNode}) {
  const [progress,setProgress]=useState<Progress|null>(null),[result,setResult]=useState<Results|null>(null),[loading,setLoading]=useState(true);
  const [verdict,setVerdict]=useState("confirmed"),[sort,setSort]=useState("match"),[direction,setDirection]=useState("desc"),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[unknownDates,setUnknownDates]=useState(filters.freshness?.includeUnknown??false),[source,setSource]=useState(""),[priceUnit,setPriceUnit]=useState("");
  const [columns,setColumns]=useState(DEFAULT_COLUMNS),[selected,setSelected]=useState<Map<string,Row>>(new Map()),[refresh,setRefresh]=useState(0),[feedback,setFeedback]=useState("");
  const [dialog,setDialog]=useState<string|null>(null),[format,setFormat]=useState("xlsx"),[exportColumns,setExportColumns]=useState(Object.keys(COLUMNS)),[allExport,setAllExport]=useState(true);
  const [collections,setCollections]=useState<{id:string;name:string}[]>([]),[collectionPage,setCollectionPage]=useState(1),[collectionTotal,setCollectionTotal]=useState(0),[collectionId,setCollectionId]=useState(""),[collectionName,setCollectionName]=useState(""),[dueAt,setDueAt]=useState(""),[confirmed,setConfirmed]=useState(false);
  const [importSource,setImportSource]=useState<Source>("cian");
  const [facts,setFacts]=useState<Record<string,Fact>>({});
  function enriched(row:Row){return {...listing(row),propertyId:knownFacts[row.listingId]?.propertyId??facts[row.listingId]?.propertyId??row.propertyId??null};}
  const action=useApiAction(),revision=useRef<string|undefined>(undefined),queryKey=useRef("");
  const [readError,setReadError]=useState<string|null>(null);
  const active=progress?.status==="queued"||progress?.status==="running"||progress?.status==="needs_user_action";
  const query={sort,direction,verdict,pageSize,unknownDates:filters.freshness?.mode==="published"?unknownDates:false,...(source?{source}:{}),...(priceUnit?{priceUnit}:{}),...(filters.freshness?{freshness:filters.freshness}:{})};
  const key=JSON.stringify(query);
  useUnsavedChangesWarning(!!dialog&&(["collection","clarify","catalog"].includes(dialog))&&(!!collectionName||!!dueAt||confirmed));
  useEffect(()=>{const timer=setTimeout(()=>{try{const stored=JSON.parse(localStorage.getItem("search-v31-columns")??"null");if(Array.isArray(stored)&&stored.length)setColumns(stored.filter(c=>c in COLUMNS));}catch{/* unavailable storage uses defaults */}},0);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{let disposed=false;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const next=await apiCall<Progress>("GET",`/api/v1/property-search/runs/${runId}/progress`);if(!disposed){setProgress(next);onBusy(["queued","running"].includes(next.status));if(["queued","running","needs_user_action"].includes(next.status))timer=setTimeout(poll,1200);}}catch{if(!disposed){setReadError("Не удалось получить прогресс. Повторяем соединение…");timer=setTimeout(poll,4000);}}}void poll();return()=>{disposed=true;clearTimeout(timer);};},[runId,refresh,onBusy]);
  useEffect(()=>{let disposed=false;const timer=setTimeout(()=>{setLoading(true);const changed=queryKey.current!==key;if(changed){queryKey.current=key;revision.current=undefined;setSelected(new Map());if(page!==1){setPage(1);return;}}
    const query=JSON.parse(key);if(query.freshness&&!freshnessSchema.safeParse(query.freshness).success){setReadError("Укажите корректные границы периода: дата от и дата до.");setLoading(false);return;}
    const params=new URLSearchParams();for(const [k,v] of Object.entries(query))params.set(k,typeof v==="object"?JSON.stringify(v):String(v));params.set("page",String(page));if(page>1&&revision.current)params.set("revision",revision.current);
    apiCall<Results>("GET",`/api/v1/property-search/runs/${runId}/results?${params}`).then(data=>{if(!disposed){revision.current=data.revision;setResult(data);setReadError(null);}}).catch(e=>{if(!disposed){if(e instanceof ApiCallError&&e.body.code==="SEARCH_RESULTS_CHANGED"){revision.current=undefined;setPage(1);setSelected(new Map());setRefresh(v=>v+1);}setReadError(e instanceof Error?e.message:"Не удалось загрузить результаты");}}).finally(()=>{if(!disposed)setLoading(false);});},0);return()=>{disposed=true;clearTimeout(timer);};
  },[runId,key,page,refresh,progress,externalRefresh]);
  function toggle(id:string,row:Row){setSelected(current=>{const next=new Map(current);if(next.has(id))next.delete(id);else next.set(id,row);return next;});}
  async function selectAll(){await action.run(async()=>{const all=new Map<string,Row>();let rev:string|undefined;for(let p=1;;p++){const params=new URLSearchParams();for(const [k,v] of Object.entries({...JSON.parse(key),page:p,pageSize:200,...(rev?{revision:rev}:{})}))params.set(k,typeof v==="object"?JSON.stringify(v):String(v));const data=await apiCall<Results>("GET",`/api/v1/property-search/runs/${runId}/results?${params}`);if(data.total>10000)throw new Error("Уточните фильтры: выделение ограничено 10000 объявлениями");rev=data.revision;data.rows.forEach(r=>all.set(r.listingId,r));if(all.size>=data.total)break;if(!data.rows.length)throw new Error("Выдача изменилась. Повторите выделение.");}setSelected(all);return true;});}
  async function bulk(){await action.run(async()=>{let target=collectionId;if(dialog==="collection"&&!target){const created=await apiCall<{id:string}>("POST","/api/v1/collections",{name:collectionName});target=created.id;setCollectionId(target);}
    const data=dialog==="bookmark"?{status:"study"}:dialog==="collection"?{collectionId:target}:dialog==="clarify"?{dueAt:new Date(dueAt).toISOString(),...(needId?{needId}:{})}:dialog==="catalog"?{confirmed,identityConfirmed:confirmed,operation:filters.operation}:{needId};
    const ids=[...selected.keys()];let success=0;const errors:string[]=[];
    for(let i=0;i<ids.length;i+=100){const response=await apiCall<{results:{id:string;success:boolean;value?:{id?:string};error?:{message:string}}[]}>("POST",`/api/v1/property-search/runs/${runId}/bulk`,{ids:ids.slice(i,i+100),action:dialog,data});for(const row of response.results)if(row.success){success++;setFacts(current=>({...current,[row.id]:{...current[row.id],...(dialog==="bookmark"?{bookmark:true}:{}),...(dialog==="collection"?{inCollection:true}:{}),...(dialog==="catalog"&&row.value?.id?{propertyId:row.value.id}:{}),...(dialog==="propose"?{proposed:true}:{})}}));}else errors.push(row.error?.message??"Не удалось выполнить действие");}
    setFeedback(`Обработано: ${success} из ${ids.length}.${errors.length?` Ошибки: ${[...new Set(errors)].join("; ")}`:" Изменения сохранены."}`);setRefresh(v=>v+1);setDialog(null);return true;});}
  async function download(){await action.run(async()=>{const response=await fetch(`/api/v1/property-search/runs/${runId}/export`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({format,columns:exportColumns,query:JSON.parse(key),...(!allExport?{ids:[...selected.keys()]}:{})})});if(!response.ok){const body=await response.json();throw new ApiCallError(response.status,{code:"EXPORT_FAILED",message:body.error?.message??"Не удалось скачать файл"});}const url=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=url;a.download=`property-search.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setDialog(null);setFeedback("Экспорт подготовлен");return true;});}
  async function open(kind:string){setDialog(kind);setConfirmed(false);if(kind==="collection"){setCollectionPage(1);const data=await action.run(()=>apiCall<{items:{id:string;name:string}[];total:number}>("GET","/api/v1/collections"));if(data){setCollections(data.items);setCollectionTotal(data.total);}}}
  function cell(row:Row,c:string):ReactNode{
    const s=row.snapshot;
    switch(c){
      case "source":return <div>{labelOf("externalSource",row.source)}<div className="mt-1 flex flex-wrap gap-1"><Badge>Объявление площадки</Badge>{enriched(row).propertyId&&<Badge tone="green">CRM</Badge>}{(knownFacts[row.listingId]?.bookmark||facts[row.listingId]?.bookmark||row.bookmark)&&<Badge tone="blue">Закладка</Badge>}{(knownFacts[row.listingId]?.inCollection||facts[row.listingId]?.inCollection||row.inCollection)&&<Badge tone="blue">В подборке</Badge>}{(knownFacts[row.listingId]?.proposed||facts[row.listingId]?.proposed||row.proposed)&&<Badge tone="green">Предложено</Badge>}</div></div>;
      case "address":return <div className="min-w-36"><p>{resultAddress(s,listing(row))}</p><p className="text-xs text-slate-600">{formatPurposeLabel(s?.purpose)} · {s?.district??"Район неизвестен"} · этаж {s?.floor.raw??"неизвестен"}</p></div>;
      case "price":return `${number(s?.price)} ₽ · ${resultPriceUnit(s,listing(row),filters.operation)}`;
      case "priceUnit":return resultPriceUnit(s,listing(row),filters.operation);
      case "pricePerM2Rub":return row.pricePerM2Rub?`${number(row.pricePerM2Rub)} ₽ ${labelOf("pricePerM2Unit",row.pricePerM2Unit)} · ${s?.priceUnit?.includes("m2")?"ставка площадки":"расчёт по цене и площади"}`:"—";
      case "pricePerM2Unit":return labelOf("pricePerM2Unit",row.pricePerM2Unit);
      case "area":return `${number(s?.area)} м²`;
      case "floor":return s?.floor.raw??"—";
      case "publishedAt":return `${date(row.publishedAt)}${row.publishedAt?` · ${labelOf("listingDatePrecision",row.datePrecision??"unknown")}`:""}`;
      case "datePrecision":return labelOf("listingDatePrecision",row.datePrecision);
      case "dateSource":return labelOf("listingDateSource",row.dateSource);
      case "firstSeenAt":return date(row.firstSeenAt);
      case "lastCheckedAt":return date(row.lastCheckedAt);
      case "purpose":return formatPurposeLabel(s?.purpose);
      case "district":return s?.district??"Неизвестен";
      case "verdict":return verdictBadge(row.verdict);
      case "unknown":return row.criteria.filter(c=>c.state==="unknown").map(c=>evidenceLabel("criterion",c.criterion)).join("; ")||"Нет";
      case "note":return facts[row.listingId]?.note??row.note??"?";
      case "owner":return "Сведения проверки — в действиях объявления";
      case "links":{const group=result?.duplicateGroups.find(g=>g.members.some(m=>m.listingId===row.listingId&&!m.releasedAt));return group?<ul>{group.members.filter(m=>!m.releasedAt).map(m=><li key={m.listingId}><a className="link" href={m.listing.url??"#"} target="_blank" rel="noreferrer">{labelOf("externalSource",m.listing.source)} ↗</a></li>)}</ul>:cell(row,"url");}
      case "photos":return <ListingPhoto propertyId={enriched(row).propertyId} sourceUrl={row.url} compact/>;
      case "url":return <a className="link" href={row.url} target="_blank" rel="noreferrer">Первоисточник ↗</a>;
      default:return "—";
    }
  }
  function rowActions(row:Row):ReactNode {
    const selectOne=()=>setSelected(new Map([[row.listingId,row]]));
    return <div className="flex flex-wrap gap-2">
      <a className="btn btn-secondary" href={row.url} target="_blank" rel="noreferrer">Открыть источник ↗</a>
      <button className="btn btn-secondary" disabled={action.pending} onClick={()=>{selectOne();void open("collection");}}>В подборку</button>
      <button className="btn btn-secondary" disabled={action.pending} onClick={()=>{selectOne();void open("catalog");}}>Сохранить</button>
      <button className="btn btn-secondary" aria-pressed={selected.has(row.listingId)} onClick={()=>toggle(row.listingId,row)}>{selected.has(row.listingId)?"Убрать из сравнения":"К сравнению"}</button>
      <button className="btn btn-secondary" disabled={action.pending} onClick={()=>{selectOne();setAllExport(false);void open("export");}}>Экспорт</button>
    </div>;
  }
  function reviewNotes(row:Row):ReactNode {
    const missing=missingFields(row);
    return <>{isSuspected(row,result?.duplicateGroups??[])&&<Badge tone="yellow" title="Предполагаемое совпадение, идентичность не подтверждена. Слияние не выполнялось.">Возможный дубль · проверить</Badge>}
      {row.criteria.some(c=>c.criterion==="city"&&c.state==="unknown")&&<Badge tone="yellow">Локация требует проверки</Badge>}
      {missing.length>0&&<p className="text-xs text-slate-600">Площадка не указала: {missing.join(", ")}. Значения не домысливаются.</p>}
      {row.criteria.some(c=>c.source==="ai")&&<p className="rounded border border-violet-300 bg-violet-50 p-2 text-xs">Выводы AI ниже — предположения, а не факты площадки.</p>}</>;
  }
  const rows=result?.page===page?result.rows:[];
  return <section className="min-w-0 space-y-4" aria-label="Выдача поиска">
    {replay&&<p className="rounded border bg-blue-50 p-3">REPLAY · сохранённые данные от {date(replayDate)}</p>}
    <Card title="Состояние источников"><div role="status" className="mb-3 flex flex-wrap items-center gap-3"><strong>{statusLabels[progress?.status??""]??"Загрузка прогресса…"}</strong><HelpTooltip label="Справка: Состояние источников" text={SEARCH_HELP.sourceStatus}/>{active&&<button className="btn btn-secondary" disabled={action.pending||progress?.cancelRequested} onClick={()=>void action.run(async()=>{await apiCall("POST",`/api/v1/property-search/runs/${runId}/cancel`);setFeedback("Отмена запрошена. Полученные данные сохраняются.");setRefresh(v=>v+1);return true;})}>{progress?.cancelRequested?"Останавливаем…":"Остановить"}</button>}<button className="btn btn-secondary" onClick={()=>setRefresh(v=>v+1)}>Обновить результаты</button></div>
      <div className="grid items-start gap-2 sm:grid-cols-2 xl:grid-cols-4">{progress?.sources.map(s=><details key={s.source} className="min-w-0 rounded border p-2" open={s.status==="needs_user_action"}>
        <summary className="cursor-pointer text-sm"><strong>{labelOf("externalSource",s.source)}</strong><span className="ml-2">{statusLabels[s.status]??"Ожидание"}</span><span className="block text-xs text-slate-600">Получено: {s.receivedCount??s.resultCount??0} · принято: {s.acceptedCount??s.resultCount??0}</span></summary>
        <p className="mt-2 text-xs">Длительность: {s.durationMs==null?"—":`${number(s.durationMs/1000)} с`} · глубина: {s.depthReached==null?"—":typeof s.depthReached==="object"?JSON.stringify(s.depthReached):String(s.depthReached)}</p><p className="text-xs">Лимит объявлений: {s.requestedCount??"—"}</p><p className="my-2 break-words text-sm">{s.statusReasonRu??sourceReason(s.reason,s.status)}</p>
        {(s.needsUserAction||s.status==="needs_user_action")&&(s.browserSession&&["pending","active"].includes(s.browserSession.status)?<Link className="btn btn-secondary" href={`/browser-sessions/${s.browserSession.id}`}>Вернуться к проверке площадки</Link>:<StartBrowserSession searchRunId={runId} source={s.source}/>)}
        {s.status==="blocked"&&<div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={()=>{setImportSource(s.source);void open("url");}}>Добавить по ссылке</button><button className="btn btn-secondary" onClick={()=>{setImportSource(s.source);void open("import");}}>Импорт выгрузки</button></div>}
      </details>)}</div>
      <p className="mt-3 text-sm">{result?.incomplete?"Выборка неполная. ":""}Сортировка полной сохранённой выборки. Ограниченный охват площадок не означает полноту рынка.</p>
    </Card>
    <div className="flex flex-wrap gap-3"><label>Сортировка<select aria-label="Сортировка" className="input block" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}>{Object.entries(SORTS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>Направление<select aria-label="Направление" className="input block" value={direction} onChange={e=>{setDirection(e.target.value);setPage(1);}}><option value="desc">По убыванию ↓</option><option value="asc">По возрастанию ↑</option></select></label><label>Источник<select className="input block" value={source} onChange={e=>setSource(e.target.value)}><option value="">Все источники</option>{filters.sources.map(s=><option key={s} value={s}>{labelOf("externalSource",s)}</option>)}</select></label><label>Единица цены<select className="input block" value={priceUnit} onChange={e=>setPriceUnit(e.target.value)}><option value="">Все совместимые группы</option>{["rub_total","rub_month","rub_year","rub_m2_month","rub_m2_year"].map(s=><option key={s} value={s}>{({rub_total:"₽ всего",rub_month:"₽/мес",rub_year:"₽/год",rub_m2_month:"₽/м²/мес",rub_m2_year:"₽/м²/год"})[s]}</option>)}</select></label></div>
    <div className="flex flex-wrap items-center gap-2"><div role="tablist" aria-label="Статусы результатов" className="flex flex-wrap gap-2">{[["confirmed","Совпадения"],["needs_review","Требуют проверки"],["rejected","Исключены"]].map(([v,l])=><button role="tab" aria-selected={verdict===v} key={v} className={`btn ${verdict===v?"btn-primary":"btn-secondary"}`} onClick={()=>{setVerdict(v!);setPage(1);}}>{l} ({result?.counts[v!]??0})</button>)}</div><HelpTooltip label="Справка: Статусы результатов" text={SEARCH_HELP.resultVerdicts}/></div>
    {filters.freshness?.mode==="published"&&<label className="block rounded border border-amber-200 bg-amber-50 p-3"><input type="checkbox" checked={unknownDates} onChange={e=>{setUnknownDates(e.target.checked);setPage(1);}}/> Дата неизвестна ({result?.unknownDateCount??0}) · отдельный блок, не считается свежим</label>}
    {readError&&<div role="alert" className="rounded border border-red-200 p-3">{readError}<button className="btn btn-secondary ml-2" onClick={()=>setRefresh(v=>v+1)}>Повторить</button></div>}<FormErrorBanner error={action.error}/>{feedback&&<p role="status" className="rounded bg-green-50 p-3">{feedback}</p>}
    <div className="flex flex-wrap items-center gap-2 rounded border bg-white p-3"><button className="btn btn-secondary" disabled={loading} onClick={()=>setSelected(new Map(rows.map(r=>[r.listingId,r])))}>Выделить страницу</button><button className="btn btn-secondary" disabled={loading||action.pending} onClick={()=>void selectAll()}>Выделить всю выборку ({result?.total??0})</button><span>Выбрано: {selected.size}</span><button className="btn btn-secondary" onClick={()=>setSelected(new Map())}>Сбросить выделение</button><button className="btn btn-secondary" disabled={selected.size<2||selected.size>4} onClick={()=>onCompare([...selected.values()].map(r=>({...r,listing:enriched(r)})))}>Сравнить 2–4</button>
      <details open={selected.size>0} className="text-sm"><summary className="cursor-pointer">Действия с выбранными</summary><div className="mt-2 flex flex-wrap gap-2">{[["bookmark","Закладка"],["collection","В именованную подборку"],["clarify","Назначить уточнение"],["catalog","Сохранить в каталог"],["propose","Отметить предложенным"],["offer","Подготовить КП"]].map(([v,l])=><button key={v} className="btn btn-secondary" disabled={!selected.size||action.pending||(["propose","offer"].includes(v!)&&!needId)} onClick={()=>void open(v!)}>{l}</button>)}</div></details><button className="btn btn-primary" disabled={action.pending||!result} onClick={()=>{setAllExport(true);void open("export");}}>Экспорт XLSX / CSV</button>
    </div>
    {view==="table"&&<details className="rounded border p-3"><summary>Видимые колонки (запоминаются)</summary><div className="mt-3 flex flex-wrap gap-3">{Object.keys(COLUMNS).map(c=><label key={c}><input type="checkbox" checked={columns.includes(c)} onChange={e=>{const next=e.target.checked?[...columns,c]:columns.filter(x=>x!==c);setColumns(next);try{localStorage.setItem("search-v31-columns",JSON.stringify(next));}catch{/* optional preference */}}}/> {COLUMNS[c as keyof typeof COLUMNS]}</label>)}</div></details>}
    {loading&&<p role="status">Загрузка результатов…</p>}
    <ListingDuplicateGroups groups={result?.duplicateGroups??[]} loading={loading} error={result?.duplicateGroupingError??undefined} onChanged={()=>setRefresh(v=>v+1)}/>
    {!loading&&!rows.length&&<EmptyState title="В этой вкладке нет объявлений" hint="Проверьте вкладку «Требуют проверки» и статусы площадок. Попробуйте расширить локацию до «Новосибирск и пригороды» или области, увеличить диапазон площади и убрать ограничение свежести."/>}
    {view==="table"?<div className="max-w-full overflow-x-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Выбор</th>{columns.map(c=><th className="p-3" key={c}>{COLUMNS[c as keyof typeof COLUMNS]}</th>)}<th className="p-3">Соответствие, доказательства и действия</th></tr></thead><tbody>{rows.map(r=><tr data-listing-id={r.listingId} key={r.id} className="border-t"><td className="p-3"><input type="checkbox" aria-label={`Выбрать ${r.snapshot?.address??"объявление"}`} checked={selected.has(r.listingId)} onChange={()=>toggle(r.listingId,r)}/></td>{columns.map(c=><td className="p-3" key={c}>{cell(r,c)}</td>)}<td className="min-w-64 space-y-2 p-3">{verdictBadge(r.verdict)}{reviewNotes(r)}<Evidence criteria={r.criteria}/>{rowActions(r)}{renderActions(enriched(r))}</td></tr>)}</tbody></table></div>:<div className="grid min-w-0 gap-3 xl:grid-cols-2">{rows.map(r=>{return <article data-listing-id={r.listingId} key={r.id} className="min-w-0 space-y-2 rounded border bg-white p-3"><div className="flex flex-wrap items-center gap-2"><label className="flex min-w-0 flex-1 gap-2 font-medium"><input type="checkbox" checked={selected.has(r.listingId)} onChange={()=>toggle(r.listingId,r)}/><span className="min-w-0 truncate">{resultAddress(r.snapshot,listing(r))}</span></label>{verdictBadge(r.verdict)}</div><p className="break-words text-sm text-slate-600">{r.snapshot?.title}</p><div className="flex flex-wrap gap-1"><Badge>Объявление площадки</Badge><Badge>{labelOf("externalSource",r.source)}</Badge>{r.snapshot?.purpose&&<Badge>{formatPurposeLabel(r.snapshot.purpose)}</Badge>}{r.snapshot?.district&&<Badge>{r.snapshot.district}</Badge>}{r.isNew&&<Badge tone="blue">Новое</Badge>}{r.priceChanged&&<Badge tone="yellow">Цена изменилась</Badge>}</div><ListingPhoto propertyId={enriched(r).propertyId} sourceUrl={r.url}/><p className="text-lg font-semibold">{cell(r,"price")}</p><p className="text-sm">{cell(r,"pricePerM2Rub")} · {cell(r,"area")} · этаж {cell(r,"floor")}</p><p className="text-xs text-slate-600">{r.publishedAt?`Опубликовано: ${cell(r,"publishedAt")}`:"Дата публикации неизвестна"} · Впервые найдено CRM: {cell(r,"firstSeenAt")}{r.lastCheckedAt?` · Проверено: ${cell(r,"lastCheckedAt")}`:""}</p>{reviewNotes(r)}<Evidence criteria={r.criteria}/>{rowActions(r)}{renderActions(enriched(r))}</article>;})}</div>}
    <nav aria-label="Страницы результатов" className="flex flex-wrap items-center gap-3"><button className="btn btn-secondary" disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>Назад</button><span>Страница {page} из {Math.max(1,Math.ceil((result?.total??0)/pageSize))} · всего {result?.total??0}</span><button className="btn btn-secondary" disabled={loading||page*pageSize>=(result?.total??0)} onClick={()=>setPage(p=>p+1)}>Далее</button><label>На странице<select aria-label="На странице" className="input ml-2" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}>{[10,25,50,100].map(n=><option key={n}>{n}</option>)}</select></label></nav>
    {(aiEnabled||!!aiStatusMessage)&&selected.size>0&&<ListingAnalysisPanel key={key+[...selected.keys()].join()} listingIds={[...selected.keys()]} filters={filters} needId={needId||undefined} labels={Object.fromEntries([...selected].map(([id,r])=>[id,r.snapshot?.address??"Объявление"]))} enabled={aiEnabled} statusMessage={aiStatusMessage} settingsUrl={aiSettingsUrl}/>}
    <Modal open={!!dialog} title={dialog==="export"?"Экспорт результатов":dialog==="url"?"Добавить по ссылке":dialog==="import"?"Импорт официальной выгрузки":"Действие с выбранными объявлениями"} onClose={()=>{if(!action.pending){setDialog(null);}}}>
      <div className="space-y-4"><FormErrorBanner error={action.error}/>
      {dialog==="export"?<><label className="block">Формат<select className="input ml-2" value={format} onChange={e=>setFormat(e.target.value)}><option value="xlsx">XLSX</option><option value="csv">CSV</option></select></label><label className="block">Область<select aria-label="Область" className="input block" value={allExport?"all":"selected"} onChange={e=>setAllExport(e.target.value==="all")}><option value="all">Весь отфильтрованный набор</option><option value="selected" disabled={!selected.size}>Только выбранные ({selected.size})</option></select></label><fieldset><legend>Колонки файла</legend><div className="grid gap-2 sm:grid-cols-2">{Object.entries(COLUMNS).map(([c,l])=><label key={c}><input type="checkbox" checked={exportColumns.includes(c)} onChange={e=>setExportColumns(v=>e.target.checked?[...v,c]:v.filter(x=>x!==c))}/> {l}</label>)}</div></fieldset><button className="btn btn-primary" disabled={action.pending||!exportColumns.length||(!allExport&&!selected.size)} onClick={()=>void download()}>Скачать файл</button></>:(dialog==="url"||dialog==="import")?<SearchFallback key={dialog+importSource} mode={dialog} source={importSource} filters={filters}/>:<>
        <p>Выбрано объявлений: {selected.size}. Успех и ошибки будут показаны отдельно.</p>
        {dialog==="collection"&&<><label className="block">Именованная подборка<select className="input w-full" value={collectionId} onChange={e=>setCollectionId(e.target.value)}><option value="">Создать новую</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{collections.length<collectionTotal&&<button className="btn btn-secondary" onClick={()=>void action.run(async()=>{const next=await apiCall<{items:{id:string;name:string}[]}>("GET",`/api/v1/collections?page=${collectionPage+1}`);setCollections(v=>[...v,...next.items]);setCollectionPage(p=>p+1);return true;})}>Ещё подборки</button>}{!collectionId&&<label className="block">Название новой подборки<input className="input w-full" value={collectionName} onChange={e=>setCollectionName(e.target.value)} maxLength={200}/></label>}</>}
        {dialog==="clarify"&&<label className="block">Срок уточнения<input className="input block" type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label>}
        {dialog==="catalog"&&<label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Подтверждаю идентичность и перенос выбранных объявлений в каталог CRM</label>}
        {["propose","offer"].includes(dialog??"")&&<p>Требуется предварительный подтверждённый перенос в каталог CRM. Неперенесённые объявления останутся без изменений.</p>}
        <button className="btn btn-primary" disabled={action.pending||!selected.size||(dialog==="collection"&&!collectionId&&!collectionName.trim())||(dialog==="clarify"&&!dueAt)||(dialog==="catalog"&&!confirmed)} onClick={()=>void bulk()}>Подтвердить действие</button>
      </>}{action.pending&&<p role="status">Выполняется…</p>}</div>
    </Modal>
  </section>;
}
function Evidence({criteria}:{criteria:CriterionEvaluation[]}){return <details><summary className="cursor-pointer text-sm font-medium">Доказательства критериев ({criteria.length})</summary><ul className="mt-2 space-y-2">{criteria.map((c,i)=><li className={c.source==="ai"?"rounded border border-violet-300 bg-violet-50 p-2 text-sm":"rounded border p-2 text-sm"} key={i}><Badge tone={c.state==="matched"?"green":c.state==="contradicted"?"red":"yellow"}>{evidenceLabel("criterion_state",c.state)}</Badge> {evidenceLabel("criterion",c.criterion)} · {c.source==="ai"?<strong>Вывод AI — требует проверки</strong>:evidenceLabel("criterion_source",c.source)}<p>{translatedEvidence(c.evidence)}</p></li>)}</ul></details>;}
