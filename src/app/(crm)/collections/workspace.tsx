"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { getCollection } from "@/modules/collections/application/collection-service";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
import { EntityPicker, ActionButton } from "@/ui/client-kit";
import { requestConfirmation } from "@/ui/confirm-dialog";
import { labelOf } from "@/shared/codebook";

type Card = Awaited<ReturnType<typeof getCollection>>;
type Picker = { id: string; label?: string; addressText?: string; client?: { displayName: string } | null };
const subscribe = () => () => {};
export function CollectionCreate() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [name, setName] = useState(""); const [visibility, setVisibility] = useState("private"); const router = useRouter(); const a = useApiAction();
  useUnsavedChangesWarning(!!name);
  return <form className="card mb-4 flex flex-wrap gap-2 p-4" onSubmit={async e => { e.preventDefault(); const result = await a.run(() => apiCall<{id:string}>("POST", "/api/v1/collections", { name, visibility })); if (result) { setName(""); router.push(`/collections/${result.id}`); } }}>
    <input aria-label="Название подборки" className="input max-w-md" placeholder="Название подборки" required maxLength={200} disabled={!hydrated} value={name} onChange={e => setName(e.target.value)} /><select aria-label="Видимость" className="input max-w-40" value={visibility} onChange={e => setVisibility(e.target.value)}><option value="private">Личная</option><option value="team">Командная</option></select><button className="btn btn-primary" disabled={a.pending || !hydrated}>Создать подборку</button><FormErrorBanner error={a.error} />
  </form>;
}
export function CollectionWorkspace({ card }: { card: Card }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [need, setNeed] = useState<Picker | null>(null); const [property, setProperty] = useState<Picker | null>(null); const [selectedNeed, setSelectedNeed] = useState(""); const [selected, setSelected] = useState<string[]>([]);
  const router = useRouter(); const a = useApiAction(); const base = `/api/v1/collections/${card.id}`; const version = { expectedUpdatedAt: card.updatedAt };
  async function command(url: string, body: unknown, method = "POST") { const r = await a.run(() => apiCall<{id:string}>(method, url, body)); if (r) router.refresh(); return r; }
  async function move(index: number, offset: number) { const ids = card.items.map(i => i.id); [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!]; await command(base, { ...version, itemIds: ids }, "PATCH"); }
  return <div className="space-y-4" data-collection-ready={hydrated} inert={!hydrated}><FormErrorBanner error={a.error} />
    <div className="flex flex-wrap gap-2"><span>{card.visibility === "team" ? "Командная подборка" : "Личная подборка"} · {card.owner.displayName}</span><a className="btn btn-sm" href={`${base}/export?format=csv`}>Экспорт CSV</a><a className="btn btn-sm" href={`${base}/export?format=xlsx`}>Экспорт XLSX</a><Link className="btn btn-sm" href="/property-search">Добавить из поиска</Link></div>
    {card.canEdit && <CollectionSettings key={String(card.updatedAt)} card={card} />}
    {card.canEdit && <div className="card flex flex-wrap items-end gap-2 p-4"><label>Объект CRM<EntityPicker<Picker> url="/api/v1/properties/pick" value={property} onChange={setProperty} render={p => p.addressText ?? p.label} /></label><button className="btn" disabled={!property || a.pending} onClick={async () => { if (await command(`${base}/items`, { items: [{ propertyId: property!.id }] })) setProperty(null); }}>Добавить объект</button></div>}
    <section className="card p-4"><h2 className="mb-2 font-semibold">Потребности</h2>{card.needs.map(n => <div className="flex items-center gap-2" key={n.needId}><Link className="link" href={`/needs/${n.needId}`}>{n.need.client.displayName} · {n.need.district ?? "Потребность"}</Link>{card.canEdit && <button className="btn btn-sm" disabled={a.pending} onClick={() => command(`${base}/needs`, { ...version, needId: n.needId, unlink: true })}>Отвязать</button>}</div>)}
    {card.canEdit && <div className="mt-3 flex gap-2"><EntityPicker<Picker> url="/api/v1/property-search/pick-needs" value={need} onChange={setNeed} render={n => `${n.client?.displayName ?? "Потребность"} · ${n.label ?? ""}`} placeholder="Найти потребность по названию" /><button className="btn" disabled={!need || a.pending} onClick={async () => { if (await command(`${base}/needs`, { ...version, needId: need!.id })) setNeed(null); }}>Привязать</button></div>}</section>
    <div className="flex flex-wrap gap-2"><select className="input max-w-md" aria-label="Потребность для предложения" value={selectedNeed} onChange={e => setSelectedNeed(e.target.value)}><option value="">Выберите привязанную потребность</option>{card.needs.map(n => <option key={n.needId} value={n.needId}>{n.need.client.displayName} · {n.need.district ?? "Потребность"}</option>)}</select><button className="btn" disabled={!selectedNeed || !selected.length || a.pending} onClick={async () => { const r = await command(`${base}/offer`, { needId: selectedNeed, itemIds: selected }); if (r) router.push(`/offers/${r.id}`); }}>Создать КП из выбранных</button></div>
    {!card.items.length && <p className="card p-5">Подборка пуста. Добавьте объекты CRM или объявления из поиска.</p>}
    {!card.canReadNotes && <p className="text-sm text-slate-600">Клиентские комментарии и причины исключения скрыты по правилам доступа.</p>}
    {card.items.map((item, index) => <article className="card space-y-3 p-4" key={item.id}><div className="flex flex-wrap items-center gap-2"><input type="checkbox" aria-label={`Выбрать ${item.externalListing?.address || item.property?.addressText || "Адрес не указан"}`} checked={selected.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /><strong>{index + 1}. {item.externalListing?.address || item.property?.addressText || "Адрес не указан"}</strong><span className="badge">{labelOf("collectionItemStatus", item.status)}</span>{item.externalListing ? <a className="link" href={item.externalListing.url} target="_blank" rel="noreferrer">Первоисточник</a> : <Link className="link" href={`/properties/${item.propertyId}`}>Карточка CRM</Link>}</div>
      {card.canEdit && <div className="flex flex-wrap gap-2"><button aria-label="Выше" className="btn btn-sm" disabled={index === 0 || a.pending} onClick={() => move(index, -1)}>↑</button><button aria-label="Ниже" className="btn btn-sm" disabled={index === card.items.length - 1 || a.pending} onClick={() => move(index, 1)}>↓</button>
      {item.externalListing && !item.externalListing.propertyId && <button className="btn btn-sm" disabled={a.pending} onClick={async () => { if (await requestConfirmation("Проверьте адрес и идентичность в первоисточнике. Создать объект в каталоге CRM?")) await command(`${base}/items/${item.id}`, { action: "transfer", confirmed: true, identityConfirmed: true }); }}>Перенести в каталог</button>}
      <button className="btn btn-sm" disabled={!selectedNeed || a.pending} onClick={() => command(`${base}/items/${item.id}`, { action: "propose", needId: selectedNeed })}>Предложить клиенту</button>
      {item.externalListing && <ActionButton url={`${base}/items/${item.id}`} body={{ action: "verify", availability: "available" }} label="Подтвердить доступность" confirm="Вы проверили доступность объявления у источника?" />}</div>}
      {item.externalListing?.verifications[0] && <p className="text-sm">Проверка доступности: {item.externalListing.verifications[0].availability === "available" ? "Доступен" : "Требует уточнения"}</p>}
      {card.canReadNotes && (card.canEdit ? <ItemNotes item={item} base={base} /> : <p>{item.comment} {item.exclusionReason}</p>)}
    </article>)}
  </div>;
}
function CollectionSettings({ card }: { card: Card }) {
  const [name, setName] = useState(card.name); const [visibility, setVisibility] = useState(card.visibility); const a = useApiAction(); const router = useRouter();
  useUnsavedChangesWarning(name !== card.name || visibility !== card.visibility);
  return <form className="card flex flex-wrap gap-2 p-4" onSubmit={async e => { e.preventDefault(); const r = await a.run(() => apiCall("PATCH", `/api/v1/collections/${card.id}`, { expectedUpdatedAt: card.updatedAt, name, visibility })); if (r) router.refresh(); }}><input className="input max-w-md" aria-label="Название" required maxLength={200} value={name} onChange={e => setName(e.target.value)} /><select className="input max-w-48" aria-label="Видимость подборки" value={visibility} onChange={e => setVisibility(e.target.value)}><option value="private">Личная</option><option value="team">Командная</option></select><button className="btn" disabled={a.pending}>Сохранить подборку</button><FormErrorBanner error={a.error} /></form>;
}
function ItemNotes({ item, base }: { item: Card["items"][number]; base: string }) {
  const [comment, setComment] = useState(item.comment ?? ""); const [reason, setReason] = useState(item.exclusionReason ?? ""); const [status, setStatus] = useState(["in_collection", "check", "excluded"].includes(item.status) ? item.status : ""); const a = useApiAction(); const router = useRouter(); const dirty = comment !== (item.comment ?? "") || reason !== (item.exclusionReason ?? ""); useUnsavedChangesWarning(dirty);
  return <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const r = await a.run(() => apiCall("PATCH", `${base}/items/${item.id}`, { expectedUpdatedAt: item.updatedAt, comment, exclusionReason: reason, ...(status ? { status } : {}) })); if (r) router.refresh(); }}><input className="input max-w-md" aria-label="Комментарий" placeholder="Комментарий" value={comment} onChange={e => setComment(e.target.value)} /><select className="input max-w-48" aria-label="Статус элемента" value={status} onChange={e => setStatus(e.target.value)}><option value="">Сохранить статус</option>{["in_collection", "check", "excluded"].map(s => <option key={s} value={s}>{labelOf("collectionItemStatus", s)}</option>)}</select><input className="input max-w-md" aria-label="Причина исключения" placeholder="Причина исключения" value={reason} onChange={e => setReason(e.target.value)} /><button className="btn btn-sm" disabled={a.pending}>Сохранить</button><FormErrorBanner error={a.error} /></form>;
}
