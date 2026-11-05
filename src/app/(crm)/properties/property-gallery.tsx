"use client";

/* eslint-disable @next/next/no-img-element -- files require authorization on each request */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PropertyMediaItem } from "@/modules/properties/application/property-media-service";
import { apiCall } from "@/ui/api-client";
import { MediaUploadQueue, useMediaQueue } from "./media-upload";

export function PropertyGallery({ propertyId, items, canEdit, kind }: { propertyId: string; items: PropertyMediaItem[]; canEdit: boolean; kind: "photo" | "document" }) {
  const router = useRouter();
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const queue = useMediaQueue();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const visible = items.filter((i) => i.kind === kind && (archived || !i.archived));
  const photo = visible.find((i) => i.id === selected);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) { dialog.current.close(); opener.current?.focus(); }
  }, [selected]);
  const step = (delta: number) => { const pos = visible.findIndex((i) => i.id === selected); setSelected(visible[(pos + delta + visible.length) % visible.length]?.id ?? null); };
  async function change(id: string, body: unknown) {
    setPending(true); setMessage("");
    try { await apiCall("PATCH", `/api/v1/properties/${propertyId}/media/${id}`, body); setMessage("Изменения сохранены"); router.refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка сервера"); }
    finally { setPending(false); }
  }
  return <section className="space-y-4" aria-label={kind === "photo" ? "Фотографии" : "Документы"}>
    <label className="flex gap-2"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Показать архив</label>
    <p role="status">{message}</p>
    {visible.length === 0 ? <p>Файлов пока нет.</p> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map((item, index) => <article key={item.id} className="space-y-2 rounded border p-3">
      {kind === "photo" ? <button type="button" className="block w-full" onClick={(e) => { opener.current = e.currentTarget; setSelected(item.id); }}><img loading="lazy" src={item.thumbnailUrl} alt={item.caption || item.name} className="h-44 w-full object-contain" /></button> : <a className="link break-all" href={item.url}>{item.name}</a>}
      <p className="break-all">{item.caption || item.name}{item.isCover ? " · Главное фото" : ""}{item.archived ? " · Архив" : ""}</p>
      {canEdit ? <div className="space-y-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void change(item.id, { caption: String(f.get("caption") || "") }); }}>
          <input key={item.caption} className="input" name="caption" aria-label={`Подпись ${item.name}`} defaultValue={item.caption ?? ""} maxLength={1000} /><button className="btn" disabled={pending}>Сохранить подпись</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {kind === "photo" && !item.archived && !item.isCover ? <button className="btn" disabled={pending} onClick={() => void change(item.id, { isCover: true })}>Сделать главным</button> : null}
          <button className="btn" disabled={pending || index === 0} onClick={() => void change(item.id, { move: "up" })}>Выше</button>
          <button className="btn" disabled={pending || index === visible.length - 1} onClick={() => void change(item.id, { move: "down" })}>Ниже</button>
          <button className="btn" disabled={pending} onClick={() => void change(item.id, { archived: !item.archived })}>{item.archived ? "Восстановить" : "В архив"}</button>
        </div>
      </div> : null}
    </article>)}</div>}
    {canEdit ? <>
      <MediaUploadQueue queue={queue} propertyId={propertyId} disabled={pending} />
      <button type="button" className="btn btn-primary" disabled={pending || queue.busy || !queue.hasPending} onClick={async () => { await queue.upload(propertyId); router.refresh(); }}>Загрузить файлы</button>
    </> : null}
    <dialog ref={dialog} aria-label="Просмотр фотографии" className="m-auto max-h-[95vh] w-[95vw] max-w-5xl rounded p-4 backdrop:bg-black/80" onCancel={(e) => { e.preventDefault(); setSelected(null); }} onKeyDown={(e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      if (e.key === "Escape") { e.preventDefault(); setSelected(null); }
    }}>
      <div className="mb-3 flex justify-between"><button className="btn" onClick={() => step(-1)}>← Предыдущее</button><button className="btn" onClick={() => setSelected(null)}>Закрыть (Esc)</button><button className="btn" onClick={() => step(1)}>Следующее →</button></div>
      {photo ? <><img src={photo.url} alt={photo.caption || photo.name} className="max-h-[75vh] w-full object-contain" /><p>{photo.caption || photo.name}</p></> : null}
    </dialog>
  </section>;
}
