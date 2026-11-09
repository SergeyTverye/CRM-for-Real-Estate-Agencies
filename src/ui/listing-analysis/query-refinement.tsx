"use client";
import { useState } from "react";
import Link from "next/link";
import type { SearchFilters } from "@/modules/property-search/domain/types";
import { SEARCH_LOCATIONS } from "@/modules/property-search/domain/geography";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
type Preview = {filters:SearchFilters|null;clarificationQuestion:string|null;pendingActionId?:string;diff:{field:string;before:unknown;after:unknown}[]};
const labels:Record<string,string>={rooms:"Комнаты",locations:"Локации",propertyKinds:"Тип объекта",city:"Город",operation:"Операция",priceFrom:"Цена от",priceTo:"Цена до",areaFrom:"Площадь от",areaTo:"Площадь до",purposes:"Назначения",districts:"Районы",floorMode:"Этаж",requiredFeatures:"Обязательные признаки",preferredFeatures:"Предпочтения",features:"Характеристики",seller:"Продавец",priceUnit:"Единица цены",sources:"Источники",hasPhotos:"Фотографии",freshness:"Свежесть",verification:"Проверка",floorFrom:"Этаж от",floorTo:"Этаж до"};
const values:Record<string,string>={studio:"Студия",sale:"Продажа",rent:"Аренда",rub_total:"₽ за объект",rub_month:"₽/мес",flat:"Квартира (жилая)",house:"Дом / коттедж",apartments:"Апартаменты (нежилое)",non_residential:"Любое нежилое",office:"Офис",warehouse:"Склад",retail:"Торговое",residential:"Жилое",...Object.fromEntries(SEARCH_LOCATIONS.map(l=>[l.id,l.label]))};
function display(value:unknown):string { if(value===null || value===undefined)return "Не задано"; if(Array.isArray(value))return value.length?value.map(display).join(", "):"Не задано"; return typeof value==="string"?values[value]??value:JSON.stringify(value); }
export function QueryRefinement({currentFilters,onConfirmed,enabled=true,statusMessage,settingsUrl}:{currentFilters:SearchFilters;onConfirmed:(filters:SearchFilters)=>void;enabled?:boolean;statusMessage?:string|null;settingsUrl?:string|null}) {
  const action=useApiAction(),[text,setText]=useState(""),[preview,setPreview]=useState<Preview|null>(null);
  useUnsavedChangesWarning(!!text || !!preview?.pendingActionId);
  async function parse() {const result=await action.run(()=>apiCall<Preview>("POST","/api/v1/property-search/analysis/parse",{text,currentFilters}));if(result)setPreview(result);}
  async function confirm() {const result=await action.run(()=>apiCall<{filters:SearchFilters}>("POST","/api/v1/property-search/analysis/parse/confirm",{pendingActionId:preview?.pendingActionId,confirmed:true,currentFilters}));if(result){onConfirmed(result.filters);setPreview(null);setText("");}}
  return <section className="space-y-3" aria-label="Уточнение условий поиска">
    <label className="block">Запрос или уточнение<textarea className="input w-full" maxLength={4000} value={text} onChange={e=>{setText(e.target.value);setPreview(null);}} placeholder="Добавь отдельный вход, остальные условия сохрани"/></label>
    <button className="btn btn-secondary" disabled={!enabled || !text.trim() || action.pending} onClick={parse}>Разобрать и показать изменения</button>
    {!enabled && <p role="status">{statusMessage ?? "ИИ отключён. Используйте ручные фильтры."}{settingsUrl && statusMessage ? <> · <Link className="link" href={settingsUrl}>Перейти к подключению Яндекс AI</Link></> : null}</p>}
    {action.pending && <p role="status">Разбираем условия…</p>}<FormErrorBanner error={action.error}/>
    {preview?.clarificationQuestion && <p role="status">{preview.clarificationQuestion}</p>}
    {preview?.pendingActionId && <><table className="w-full text-left text-sm"><thead><tr><th>Условие</th><th>Было</th><th>Предлагается</th></tr></thead><tbody>{preview.diff.map(d=><tr key={d.field}><td>{labels[d.field] ?? d.field}</td><td>{display(d.before)}</td><td>{display(d.after)}</td></tr>)}</tbody></table>{!preview.diff.length && <p>Изменений условий нет.</p>}<button className="btn btn-primary" disabled={action.pending} onClick={confirm}>Подтвердить условия</button><button className="btn btn-secondary ml-2" onClick={()=>setPreview(null)}>Отменить</button></>}
  </section>;
}
