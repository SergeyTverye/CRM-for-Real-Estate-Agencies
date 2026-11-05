"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateTimeInput, EntityPicker, Modal } from "@/ui/client-kit";
import { Field, FormErrorBanner } from "@/ui/form";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { apiCall } from "@/ui/api-client";
import { requestConfirmation } from "@/ui/confirm-dialog";
type Client = { id: string; displayName: string };
export function BulkTasks({ timeZone }: { timeZone: string }) {
  const [open, setOpen] = useState(false), [clients, setClients] = useState<Client[]>([]), [title, setTitle] = useState("Повторный контакт"), [dueAt, setDueAt] = useState("");
  const [key, setKey] = useState(""), [preview, setPreview] = useState<{ count: number; previewToken: string; clients: Client[] } | null>(null), [notice, setNotice] = useState("");
  const action = useApiAction(), router = useRouter();
  useUnsavedChangesWarning(open && clients.length > 0);
  const payload = { clientIds: clients.map(c => c.id), idempotencyKey: key, task: { title, taskType: "call_or_contact", dueAt } };
  return <><button className="btn" onClick={() => { setOpen(true); setKey(crypto.randomUUID()); setPreview(null); }}>Массовые задачи</button>{notice ? <p role="status">{notice}</p> : null}
    {open ? <Modal open onClose={async () => { if (!clients.length || await requestConfirmation("Закрыть без создания массовых задач? Выбранные клиенты и параметры будут потеряны.")) { setOpen(false); setClients([]); } }} title="Задачи выбранным клиентам"><form className="space-y-3" onSubmit={e => { e.preventDefault(); void action.run(async () => {
      if (!preview) { setPreview(await apiCall("POST", "/api/v1/tasks/bulk", payload)); return true; }
      const result = await apiCall<{ count: number }>("POST", "/api/v1/tasks/bulk", { ...payload, confirmed: true, previewToken: preview.previewToken });
      setNotice(`Создано задач: ${result.count}`); setOpen(false); setClients([]); router.refresh(); return true;
    }); }}><FormErrorBanner error={action.error} />
      <Field label="Клиенты (до 100)"><EntityPicker<Client> key={clients.length} value={null} url="/api/v1/clients/pick" render={c => c.displayName} onChange={c => { if (c && !clients.some(i => i.id === c.id)) setClients(v => [...v,c]); setPreview(null); }} /></Field>
      <ul>{clients.map(c => <li key={c.id}>{c.displayName} <button className="btn btn-sm" type="button" onClick={() => { setClients(v => v.filter(i => i.id !== c.id)); setPreview(null); }}>Убрать</button></li>)}</ul>
      <Field label="Что сделать" required><input className="input" required maxLength={300} value={title} onChange={e => { setTitle(e.target.value); setPreview(null); }} /></Field>
      <Field label="Срок" required><DateTimeInput timeZone={timeZone} value={dueAt} onChange={v => { setDueAt(v); setPreview(null); }} /></Field>
      {preview ? <div className="alert alert-info"><p>Будет создано задач: {preview.count}. {title}</p><ul>{preview.clients.map(c => <li key={c.id}>{c.displayName}</li>)}</ul><p>Одинаковое действие и срок для каждого выбранного клиента.</p></div> : null}
      <button className="btn btn-primary" disabled={action.pending || !clients.length}>{action.pending ? "Сохранение…" : preview ? "Подтвердить создание" : "Предпросмотр"}</button>
    </form></Modal> : null}</>;
}
