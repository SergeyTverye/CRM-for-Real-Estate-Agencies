"use client";
import { useState } from "react";
import type { SearchFilters } from "@/modules/property-search/domain/types";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
type Preview = {filters:SearchFilters|null;clarificationQuestion:string|null;pendingActionId?:string;diff:{field:string;before:unknown;after:unknown}[]};
const labels:Record<string,string>={city:"Город",operation:"Операция",priceFrom:"Цена от",priceTo:"Цена до",areaFrom:"Площадь от",areaTo:"Площадь до",purposes:"Назначения",districts:"Районы",floorMode:"Этаж",requiredFeatures:"Обязательные признаки",preferredFeatures:"Предпочтения",features:"Характеристики",seller:"Продавец",priceUnit:"Единица цены",sources:"Источники",hasPhotos:"Фотографии",freshness:"Свежесть",verification:"Проверка",floorFrom:"Этаж от",floorTo:"Этаж до"};
export function QueryRefinement({currentFilters,onConfirmed,enabled=true}:{currentFilters:SearchFilters;onConfirmed:(filters:SearchFilters)=>void;enabled?:boolean}) {
  const action=useApiAction(),[text,setText]=useState(""),[preview,setPreview]=useState<Preview|null>(null);
  useUnsavedChangesWarning(!!text || !!preview?.pendingActionId);
  async function parse() {const result=await action.run(()=>apiCall<Preview>("POST","/api/v1/property-search/analysis/parse",{text,currentFilters}));if(result)setPreview(result);}
  async function confirm() {const result=await action.run(()=>apiCall<{filters:SearchFilters}>("POST","/api/v1/property-search/analysis/parse/confirm",{pendingActionId:preview?.pendingActionId,confirmed:true,currentFilters}));if(result){onConfirmed(result.filters);setPreview(null);setText("");}}
  return <section className="space-y-3" aria-label="Уточнение условий поиска">
    <label className="block">Запрос или уточнение<textarea className="input w-full" maxLength={4000} value={text} onChange={e=>{setText(e.target.value);setPreview(null);}} placeholder="Добавь отдельный вход, остальные условия сохрани"/></label>
    <button className="btn btn-secondary" disabled={!enabled || !text.trim() || action.pending} onClick={parse}>Разобрать и показать изменения</button>
    {!enabled && <p>ИИ отключён. Используйте ручные фильтры.</p>}
    {action.pending && <p role="status">Разбираем условия…</p>}<FormErrorBanner error={action.error}/>
    {preview?.clarificationQuestion && <p role="status">{preview.clarificationQuestion}</p>}
    {preview?.pendingActionId && <><table className="w-full text-left text-sm"><thead><tr><th>Условие</th><th>Было</th><th>Предлагается</th></tr></thead><tbody>{preview.diff.map(d=><tr key={d.field}><td>{labels[d.field] ?? d.field}</td><td>{JSON.stringify(d.before)}</td><td>{JSON.stringify(d.after)}</td></tr>)}</tbody></table>{!preview.diff.length && <p>Изменений условий нет.</p>}<button className="btn btn-primary" disabled={action.pending} onClick={confirm}>Подтвердить условия</button><button className="btn btn-secondary ml-2" onClick={()=>setPreview(null)}>Отменить</button></>}
  </section>;
}
