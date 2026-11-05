"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, DateTimeInput } from "@/ui/client-kit";
import { Field, FormErrorBanner } from "@/ui/form";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import type { SearchFilters } from "@/modules/property-search/domain/types";
import type { z } from "zod";
import type { taskDraftSchema } from "@/modules/ai/domain/p2-drafts";

type NoteContext = {kind:"client"|"request"|"need";id:string};
type Metadata = {mode:"live"|"test";usage?:{inputTokens:number;outputTokens:number};expectedUpdatedAt:string|null};
type NoteDraft = Metadata & {filters:SearchFilters|null;clarificationQuestion:string|null;task:z.infer<typeof taskDraftSchema>};
function Mode({draft}:{draft:Metadata}) { return <p className="text-xs text-slate-500">{draft.mode === "live" ? "LIVE · Yandex AI" : "Режим тестирования · fake"} · токены: {draft.usage?.inputTokens ?? "?"} / {draft.usage?.outputTokens ?? "?"}. Черновик требует проверки сотрудником.</p>; }
const purposes = {retail:"Торговля",psn_universal:"ПСН",office:"Офис",production:"Производство",warehouse:"Склад",free_purpose:"Свободное назначение"} as const;
export function CallNoteButton({context,enabled,timeZone}:{context:NoteContext;enabled:boolean;timeZone:string}) {
  const [open,setOpen] = useState(false), [note,setNote] = useState(""), [draft,setDraft] = useState<NoteDraft|null>(null);
  const [discard,setDiscard] = useState(false);
  const action = useApiAction(), router = useRouter();
  useUnsavedChangesWarning(open && !!note);
  const filters = draft?.filters;
  function update(patch:Partial<SearchFilters>) { if (draft && filters) setDraft({...draft,filters:{...filters,...patch}}); }
  async function generate() { const result = await action.run(()=>apiCall<NoteDraft>("POST","/api/v1/ai/call-note",{context,note})); if(result) setDraft(result); }
  async function confirm() {
    const result = await action.run(()=>apiCall<{id:string}>("POST","/api/v1/ai/call-note/confirm",{context,confirmed:true,filters,task:draft?.task,expectedUpdatedAt:draft?.expectedUpdatedAt}));
    if(result) {setOpen(false);setNote("");setDraft(null);router.push(`/needs/${result.id}`);router.refresh();}
  }
  return <>
    <button className="btn" disabled={!enabled} title={!enabled ? "ИИ отключён — заполните данные вручную" : undefined} onClick={()=>setOpen(true)}>Разобрать заметку</button>
    <Modal wide open={open} onClose={()=>note ? setDiscard(true) : setOpen(false)} title="Разбор заметки после звонка">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Не вводите ФИО, телефоны и email. Перед отправкой известные имена и контакты удаляются. Записи появятся только после подтверждения.</p>
        <Field label="Заметка после звонка"><textarea className="input min-h-24" maxLength={4000} value={note} onChange={e=>{setNote(e.target.value);setDraft(null);}} /></Field>
        <button className="btn btn-primary" disabled={action.pending || !note.trim()} onClick={generate}>{action.pending ? "Обработка…" : "Подготовить черновик"}</button>
        <FormErrorBanner error={action.error} onRetry={()=>{setDraft(null);router.refresh();}} />
        {draft ? <>
          <Mode draft={draft}/>
          {draft.clarificationQuestion ? <p role="status" className="alert alert-warning">{draft.clarificationQuestion} Дополните заметку и повторите разбор.</p> : null}
          {filters ? <>
            <h3 className="font-semibold">Параметры потребности и поиска</h3>
            <p className="text-xs text-slate-500">Операция «Продажа» в поиске соответствует «Купить» в потребности. Первый выбранный вид назначения сохраняется как основное, остальные — в требованиях.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Операция"><select className="input" value={filters.operation} onChange={e=>update({operation:e.target.value as SearchFilters["operation"],priceUnit:e.target.value === "rent" ? "rub_month" : "rub_total"})}><option value="sale">Продажа (купить)</option><option value="rent">Аренда</option></select></Field>
              <Field label="Город"><input className="input" value={filters.city} onChange={e=>update({city:e.target.value})}/></Field>
              <Field label="Единица цены"><select className="input" value={filters.priceUnit ?? "rub_total"} onChange={e=>update({priceUnit:e.target.value as SearchFilters["priceUnit"]})}><option value="rub_total">₽ за объект</option><option value="rub_month">₽/месяц</option><option value="rub_year">₽/год</option><option value="rub_m2_month">₽/м² в месяц</option><option value="rub_m2_year">₽/м² в год</option></select></Field>
              <Field label="Этаж"><select className="input" value={filters.floorMode} onChange={e=>update({floorMode:e.target.value as SearchFilters["floorMode"]})}><option value="any">Любой</option><option value="first_floor_only">Только первый</option><option value="exclude_basement_and_semi_basement">Без подвала и цоколя</option></select></Field>
              {(["priceFrom","priceTo","areaFrom","areaTo"] as const).map((key,index)=><Field key={key} label={["Бюджет от, ₽","Бюджет до, ₽","Площадь от, м²","Площадь до, м²"][index]!}><input className="input" type="number" min="0" step="0.01" value={filters[key] ?? ""} onChange={e=>update({[key]:e.target.value === "" ? undefined : key.startsWith("area") ? Number(e.target.value) : e.target.value})}/></Field>)}
              <Field label="Районы (через запятую)"><input className="input" value={filters.districts.join(", ")} onChange={e=>update({districts:e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})}/></Field>
              <Field label="Обязательные требования (через ;)"><input className="input" value={filters.requiredFeatures.join("; ")} onChange={e=>update({requiredFeatures:e.target.value.split(";").map(s=>s.trim()).filter(Boolean)})}/></Field>
              <Field label="Предпочтения (через ;)"><input className="input" value={filters.preferredFeatures.join("; ")} onChange={e=>update({preferredFeatures:e.target.value.split(";").map(s=>s.trim()).filter(Boolean)})}/></Field>
              <Field label="Продавец"><select className="input" value={filters.seller} onChange={e=>update({seller:e.target.value as SearchFilters["seller"]})}><option value="all">Все</option><option value="confirmed_owner_only">Подтверждённый собственник</option></select></Field>
            </div>
            <fieldset><legend className="label">Назначение (ИЛИ)</legend><div className="flex flex-wrap gap-3">{Object.entries(purposes).map(([code,label])=><label key={code} className="text-sm"><input type="checkbox" checked={filters.purposes.includes(code as keyof typeof purposes)} onChange={e=>update({purposes:e.target.checked ? [...filters.purposes,code as keyof typeof purposes] : filters.purposes.filter(p=>p!==code)})}/> {label}</label>)}</div></fieldset>
            <h3 className="font-semibold">Следующая задача</h3>
            <Field label="Тип задачи"><select className="input" value={draft.task.taskType} onChange={e=>setDraft({...draft,task:{...draft.task,taskType:e.target.value as "call_or_contact"|"other"}})}><option value="call_or_contact">Звонок/контакт</option><option value="other">Прочее</option></select></Field>
            <Field label="Описание действия"><input className="input" value={draft.task.title} onChange={e=>setDraft({...draft,task:{...draft.task,title:e.target.value}})}/></Field>
            <Field label="Срок задачи" hint={timeZone}><DateTimeInput timeZone={timeZone} value={draft.task.dueAt ?? ""} onChange={value=>setDraft({...draft,task:{...draft.task,dueAt:value || null}})}/></Field>
            <Field label="Подробности задачи"><textarea className="input" value={draft.task.description ?? ""} onChange={e=>setDraft({...draft,task:{...draft.task,description:e.target.value}})}/></Field>
            <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={action.pending || !draft.task.dueAt} onClick={confirm}>Подтвердить потребность и задачу</button></div>
          </> : null}
        </> : null}
        {discard ? <div className="alert alert-warning"><p>Закрыть и удалить несохранённый черновик?</p><button className="btn" onClick={()=>setDiscard(false)}>Продолжить правку</button> <button className="btn" onClick={()=>{setOpen(false);setDraft(null);setNote("");setDiscard(false);}}>Удалить черновик</button></div> : null}
      </div>
    </Modal>
  </>;
}
export function OfferAiButtons({offerId,enabled}:{offerId:string;enabled:boolean}) {
  const [open,setOpen] = useState(false), [draft,setDraft] = useState<(Metadata & {text:string})|null>(null), [text,setText] = useState("");
  const [discard,setDiscard] = useState(false);
  const action = useApiAction(), router = useRouter();
  useUnsavedChangesWarning(open && !!text);
  async function generate(kind:"intro"|"comparison") {
    setOpen(true);setDraft(null);setText("");
    const result = await action.run(()=>apiCall<Metadata & {text:string}>("POST","/api/v1/ai/offer-text",{offerId,kind}));
    if(result) {setDraft(result);setText(result.text);}
  }
  async function save() {
    const result = await action.run(()=>apiCall("POST","/api/v1/ai/offer-text/confirm",{offerId,confirmed:true,text,expectedUpdatedAt:draft?.expectedUpdatedAt}));
    if(result) {setOpen(false);setText("");setDraft(null);router.refresh();}
  }
  return <>
    <button className="btn" disabled={!enabled || action.pending} title={!enabled ? "ИИ отключён" : undefined} onClick={()=>generate("intro")}>Сгенерировать введение</button>
    <button className="btn" disabled={!enabled || action.pending} title={!enabled ? "ИИ отключён" : undefined} onClick={()=>generate("comparison")}>Сравнительное описание объектов</button>
    <Modal wide open={open} onClose={()=>text ? setDiscard(true) : setOpen(false)} title="AI-помощь с коммерческим предложением">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Только данные снимков КП. Проверьте факты и текст. Сохранение заменит вводный текст текущего черновика, статус КП не изменится.</p>
        {action.pending && !draft ? <p role="status">Генерация черновика…</p> : null}
        <FormErrorBanner error={action.error}/>
        {draft ? <><Mode draft={draft}/><Field label="Текст КП"><textarea className="input min-h-64" value={text} maxLength={8000} onChange={e=>setText(e.target.value)}/></Field><button className="btn btn-primary" disabled={action.pending || !text.trim()} onClick={save}>Сохранить текст в КП</button></> : null}
        {discard ? <div className="alert alert-warning"><p>Удалить несохранённый текст?</p><button className="btn" onClick={()=>setDiscard(false)}>Продолжить правку</button> <button className="btn" onClick={()=>{setOpen(false);setDraft(null);setText("");setDiscard(false);}}>Удалить черновик</button></div> : null}
      </div>
    </Modal>
  </>;
}
