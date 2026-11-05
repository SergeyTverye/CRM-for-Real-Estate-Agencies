"use client";
import { requestConfirmation } from "@/ui/confirm-dialog";
import { useState } from "react";
import { DateTimeInput, Modal, type Option } from "@/ui/client-kit";
import { NeedPicker, PropertySelect, type NeedLabels, type NeedPick, type PropertyPick } from "@/ui/domain/deal-pickers";
import { Field, FormErrorBanner } from "@/ui/form";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { apiCall } from "@/ui/api-client";

export function CalendarQuickCreate({ timeZone, users, labels, onDone }: { timeZone: string; users: Option[]; labels: NeedLabels; onDone: () => void }) {
  const [type, setType] = useState<"task" | "showing" | null>(null);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [responsibleUserId, setResponsible] = useState("");
  const [need, setNeed] = useState<NeedPick | null>(null);
  const [property, setProperty] = useState<PropertyPick | null>(null);
  const [dirty, setDirty] = useState(false);
  const action = useApiAction();
  useUnsavedChangesWarning(!!type && dirty);
  function open(next: "task" | "showing") { setType(next); setAt(new Date(Date.now()+3600000).toISOString()); setTitle(""); setNeed(null); setProperty(null); setResponsible(""); setDirty(false); action.setError(null); }
  async function close() { if (!dirty || await requestConfirmation("Закрыть без сохранения?")) setType(null); }
  return <>
    <button className="btn" onClick={() => open("task")}>+ Звонок / задача</button><button className="btn" onClick={() => open("showing")}>+ Показ</button>
    <Modal open={!!type} onClose={close} title={type === "showing" ? "Назначить показ" : "Быстрая задача"}>
      <form className="space-y-3" onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); void action.run(async () => {
        const data = type === "task" ? { title, taskType: "call_or_contact", dueAt: at, ...(responsibleUserId ? { responsibleUserId } : {}), ...(need ? { links: { needIds: [need.id] } } : {}) }
          : { clientNeedId: need?.id, propertyId: property?.id, scheduledAt: at, ...(responsibleUserId ? { responsibleUserId } : {}) };
        await apiCall("POST", "/api/v1/calendar", { type, data }); setDirty(false); setType(null); onDone(); return true;
      }); }}>
        <FormErrorBanner error={action.error} />
        {type === "task" ? <Field label="Что сделать" required error={action.fieldError("title")}><input required maxLength={300} className="input" value={title} onChange={e=>setTitle(e.target.value)} /></Field> : null}
        <Field label={type === "task" ? "Потребность (если задача по клиенту)" : "Потребность"} required={type === "showing"} error={action.fieldError("clientNeedId")}><NeedPicker labels={labels} value={need} onChange={v=>{setNeed(v);setDirty(true);}} /></Field>
        {type === "showing" ? <Field label="Объект" required error={action.fieldError("propertyId")}><PropertySelect value={property} onChange={v=>{setProperty(v);setDirty(true);}} /></Field> : null}
        <Field label={type === "task" ? "Срок" : "Время показа"} required error={action.fieldError(type === "task" ? "dueAt" : "scheduledAt")}><DateTimeInput value={at} timeZone={timeZone} onChange={v=>{setAt(v);setDirty(true);}} /></Field>
        <Field label="Ответственный" error={action.fieldError("responsibleUserId")}><select className="input" value={responsibleUserId} onChange={e=>setResponsible(e.target.value)}><option value="">По действующим правилам назначения</option>{users.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}</select></Field>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={action.pending || (type === "showing" && (!need || !property))}>{action.pending ? "Сохранение…" : "Создать"}</button><button className="btn" type="button" onClick={close}>Отмена</button></div>
      </form>
    </Modal>
  </>;
}
