"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateTimeInput, Modal } from "@/ui/client-kit";
import { Field, FormErrorBanner } from "@/ui/form";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { apiCall } from "@/ui/api-client";
import { requestConfirmation } from "@/ui/confirm-dialog";
type Item = { id: string; title: string; sortOrder: number; responsibleUserId: string | null; dueAt: string | null; required: boolean; status: string; result: string | null; updatedAt: string };
export function TaskChecklist({ taskId, items, timeZone, users, open }: { taskId: string; items: Item[]; timeZone: string; users: { value: string; label: string }[]; open: boolean }) {
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [dirty, setDirty] = useState(false);
  const router = useRouter(); const action = useApiAction();
  useUnsavedChangesWarning(dirty);
  const done = items.filter(i => i.status === "done").length;
  async function close() { if (!dirty || await requestConfirmation("Закрыть без сохранения изменений пункта?")) { setEditing(null); setDirty(false); } }
  const change = (patch: Partial<Item>) => { setDirty(true); setEditing(v => ({ ...v, ...patch })); };
  return <section className="space-y-3" aria-label="Чек-лист задачи">
    <p>Выполнено {done} из {items.length}</p><progress className="w-full" aria-label="Прогресс чек-листа" value={done} max={items.length || 1} />
    {!items.length ? <p className="text-sm text-slate-500">Добавьте шаги выполнения задачи.</p> : <ol className="space-y-2">{items.map(i => <li key={i.id} className="rounded border p-2">
      <div className="flex items-center gap-2"><span aria-label={i.status === "done" ? "Выполнен" : "Открыт"}>{i.status === "done" ? "✓" : "○"}</span><span className={i.status === "done" ? "line-through" : ""}>{i.title}</span>{i.required ? <span className="text-xs">Обязательный</span> : null}
        {open ? <button className="btn btn-sm ml-auto" onClick={() => { setEditing(i); setDirty(false); }}>Изменить</button> : null}</div>
      <p className="text-xs text-slate-600">{users.find(u => u.value === i.responsibleUserId)?.label ?? "Ответственный задачи"}{i.dueAt ? ` · ${new Intl.DateTimeFormat("ru", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(i.dueAt))}` : ""}</p>
      {i.status === "open" && i.dueAt && new Date(i.dueAt) < new Date() ? <p className="text-sm text-red-700">Пункт просрочен</p> : null}{i.result ? <p className="text-sm">{i.result}</p> : null}
    </li>)}</ol>}
    {open ? <button className="btn btn-sm" onClick={() => { setEditing({ title: "", sortOrder: items.length, required: false, status: "open" }); setDirty(false); }}>+ Пункт</button> : null}
    {editing ? <Modal open onClose={close} title={editing.id ? "Пункт чек-листа" : "Новый пункт"}><form className="space-y-3" onSubmit={e => { e.preventDefault(); void action.run(async () => {
      await apiCall(editing.id ? "PATCH" : "POST", `/api/v1/tasks/${taskId}/checklist${editing.id ? `/${editing.id}` : ""}`, { ...editing, responsibleUserId: editing.responsibleUserId || null, dueAt: editing.dueAt || null, expectedUpdatedAt: editing.updatedAt });
      setDirty(false); setEditing(null); router.refresh(); return true;
    }); }}><FormErrorBanner error={action.error} onRetry={() => { setDirty(false); setEditing(null); router.refresh(); }} />
      <Field label="Название" required><input className="input" required maxLength={300} value={editing.title ?? ""} onChange={e => change({ title: e.target.value })} /></Field>
      <Field label="Порядок"><input className="input" type="number" min={0} max={10000} value={editing.sortOrder ?? 0} onChange={e => change({ sortOrder: Number(e.target.value) })} /></Field>
      <Field label="Ответственный"><select className="input" value={editing.responsibleUserId ?? ""} onChange={e => change({ responsibleUserId: e.target.value || null })}><option value="">Ответственный задачи</option>{users.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select></Field>
      <Field label="Срок"><DateTimeInput timeZone={timeZone} value={editing.dueAt ?? ""} onChange={dueAt => change({ dueAt })} /><button type="button" className="btn btn-sm" onClick={() => change({ dueAt: null })}>Без срока</button></Field>
      <label className="block"><input type="checkbox" checked={editing.required ?? false} onChange={e => change({ required: e.target.checked })} /> Обязательный пункт</label>
      <label className="block"><input type="checkbox" checked={editing.status === "done"} onChange={e => change({ status: e.target.checked ? "done" : "open" })} /> Выполнен</label>
      <Field label="Результат"><textarea className="input" maxLength={4000} value={editing.result ?? ""} onChange={e => change({ result: e.target.value })} /></Field>
      <button className="btn btn-primary" disabled={action.pending}>Сохранить пункт</button><button className="btn ml-2" type="button" onClick={close}>Закрыть</button>
    </form></Modal> : null}
  </section>;
}
