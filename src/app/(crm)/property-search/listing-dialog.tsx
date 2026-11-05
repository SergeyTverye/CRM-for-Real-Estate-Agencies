"use client";

import { useState } from "react";
import { Modal, DateTimeInput } from "@/ui/client-kit";
import { Field, FormErrorBanner } from "@/ui/form";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";

export type ListingDialogKind = "bookmark" | "selection" | "clarify" | "transfer" | "propose" | "offer" | "verification" | "delete";
const titles: Record<ListingDialogKind, string> = { bookmark: "Личная закладка", selection: "Комментарий к подборке", clarify: "Уточнить объявление", transfer: "Перенос в каталог CRM", propose: "Предложить клиенту", offer: "Добавить в КП", verification: "Проверка сотрудника", delete: "Удалить сохранённый поиск" };

export function ListingDialog({ kind, address, url, initialNote = "", needsTransfer = false, onClose, onSubmit }: {
  kind: ListingDialogKind; address?: string | null; url?: string; initialNote?: string; needsTransfer?: boolean;
  onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const action = useApiAction();
  const [note, setNote] = useState(initialNote);
  const [title, setTitle] = useState("Уточнить объявление");
  const [dueAt, setDueAt] = useState(() => new Date(Date.now() + 86400000).toISOString());
  const [nextCheckAt, setNextCheckAt] = useState("");
  const [verifiedAddress, setAddress] = useState(address ?? "");
  const [identity, setIdentity] = useState(false);
  const [availability, setAvailability] = useState("unknown");
  const [owner, setOwner] = useState("unknown");
  const [price, setPrice] = useState("unknown");
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesWarning(dirty);
  const transfer = kind === "transfer" || needsTransfer;
  return <Modal open title={titles[kind]} onClose={() => { if (!action.pending) onClose(); }}><form className="space-y-4" onChange={() => setDirty(true)} onSubmit={async e => {
    e.preventDefault();
    const ternary = (value: string) => value === "unknown" ? null : value === "yes";
    const body = kind === "bookmark" ? { note, status: "study" } : kind === "selection" ? { comment: note } : kind === "clarify" ? { title, dueAt } : kind === "verification" ? {
      availability, ownerConfirmed: ternary(owner), priceConfirmed: ternary(price), nextCheckAt: nextCheckAt || null, note,
    } : { comment: note };
    const result = await action.run(() => onSubmit({ ...body, ...(transfer ? { confirmed: true, identityConfirmed: identity, address: verifiedAddress } : {}) }));
    if (result !== undefined) { setDirty(false); onClose(); }
  }}>
    {address && <p className="break-words text-sm text-slate-600">{address}</p>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="link">Проверить первоисточник ↗</a>}
    {transfer && <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-3"><p className="text-sm">Объект будет доступен в общем каталоге CRM. Проверьте адрес и убедитесь, что это нужное помещение.</p>
      <Field label="Проверенный адрес" required><input className="input w-full" required maxLength={1000} value={verifiedAddress} onChange={e => setAddress(e.target.value)} /></Field>
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required checked={identity} onChange={e => setIdentity(e.target.checked)} />Я проверил первоисточник и подтверждаю идентичность помещения</label>
    </div>}
    {kind === "propose" && <p className="text-sm">Будет зафиксирован факт предложения выбранной потребности клиента.</p>}
    {kind === "offer" && <p className="text-sm">Объект будет добавлен в черновик КП выбранной потребности.</p>}
    {kind === "delete" && <p>Удалить сохранённые условия? История запусков сохранится.</p>}
    {kind === "clarify" && <><Field label="Что уточнить" required><input className="input w-full" required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Срок · Новосибирск" required><DateTimeInput timeZone="Asia/Novosibirsk" value={dueAt} onChange={setDueAt} /></Field></>}
    {kind === "verification" && <><Field label="Актуальность"><select className="input w-full" value={availability} onChange={e => setAvailability(e.target.value)}><option value="unknown">Неизвестно</option><option value="available">Доступен</option><option value="reserved">Забронирован</option><option value="withdrawn">Снят</option></select></Field>
      {([["Собственник подтверждён", owner, setOwner], ["Цена подтверждена", price, setPrice]] as const).map(([label, value, setter]) => <Field key={label} label={label}><select className="input w-full" value={value} onChange={e => setter(e.target.value)}><option value="unknown">Неизвестно</option><option value="yes">Да</option><option value="no">Нет</option></select></Field>)}
      <Field label="Следующая проверка · Новосибирск"><DateTimeInput timeZone="Asia/Novosibirsk" value={nextCheckAt} onChange={setNextCheckAt} /></Field></>}
    {!["delete", "transfer", "clarify"].includes(kind) && <Field label={kind === "bookmark" ? "Личная заметка" : "Комментарий"}><textarea className="input w-full" rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></Field>}
    <FormErrorBanner error={action.error} />
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-secondary" disabled={action.pending} onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={action.pending || transfer && (!identity || !verifiedAddress.trim()) || kind === "clarify" && !dueAt}>{action.pending ? "Сохранение…" : kind === "delete" ? "Удалить" : "Подтвердить"}</button></div>
  </form></Modal>;
}
