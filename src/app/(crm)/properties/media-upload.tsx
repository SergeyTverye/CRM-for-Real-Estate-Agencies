"use client";

/* eslint-disable @next/next/no-img-element -- authenticated media URLs are intentionally served without an image proxy */
import { FilePicker } from "@/ui/file-picker";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useUnsavedChangesWarning } from "@/ui/hooks";
import { optionsOf } from "@/shared/codebook";

type QueueItem = { id: string; file: File; kind: "photo" | "document"; documentTypeCode: string; preview?: string; status: "queued" | "uploading" | "success" | "error"; error?: string };

export function useMediaQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const urls = useRef(new Set<string>());
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const hasPending = items.some((i) => i.status !== "success");
  useUnsavedChangesWarning(hasPending && !busy);
  function add(files: FileList | null, kind: QueueItem["kind"]) {
    if (!files || busyRef.current) return;
    const added = Array.from(files).map((file): QueueItem => {
      const preview = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? URL.createObjectURL(file) : undefined;
      if (preview) urls.current.add(preview);
      return { id: crypto.randomUUID(), file, kind, documentTypeCode: kind === "photo" ? "photo" : "other", preview, status: "queued" };
    });
    setItems((old) => [...old, ...added]);
  }
  function remove(id: string) {
    if (busyRef.current) return;
    setItems((old) => old.filter((i) => i.id !== id));
    const url = items.find((i) => i.id === id)?.preview;
    if (url) { URL.revokeObjectURL(url); urls.current.delete(url); }
  }
  function setDocumentType(id: string, documentTypeCode: string) {
    if (busyRef.current) return;
    setItems((old) => old.map((item) => item.id === id && item.status !== "success" ? { ...item, documentTypeCode } : item));
  }
  async function upload(propertyId: string, onlyId?: string) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true);
    let ok = true;
    try {
      for (const item of items.filter((i) => i.status !== "success" && (!onlyId || i.id === onlyId))) {
        setItems((old) => old.map((i) => i.id === item.id ? { ...i, status: "uploading", error: undefined } : i));
        const form = new FormData(); form.set("file", item.file); form.set("kind", item.kind); form.set("documentTypeCode", item.documentTypeCode);
        try {
          await apiCall("POST", `/api/v1/properties/${propertyId}/media`, form);
          setItems((old) => old.map((i) => i.id === item.id ? { ...i, status: "success" } : i));
        } catch (error) {
          ok = false;
          setItems((old) => old.map((i) => i.id === item.id ? { ...i, status: "error", error: error instanceof Error ? error.message : "Ошибка загрузки" } : i));
        }
      }
    } finally { busyRef.current = false; setBusy(false); }
    return ok;
  }
  return { items, busy, hasPending, add, remove, upload, setDocumentType };
}

export function MediaUploadQueue({ queue, propertyId, disabled = false }: { queue: ReturnType<typeof useMediaQueue>; propertyId?: string; disabled?: boolean }) {
  const router = useRouter();
  return <section className="space-y-3 rounded border p-3" aria-label="Загрузка файлов" aria-busy={queue.busy}>
    <p className="font-medium">Фотографии и документы</p>
    <p className="text-sm text-slate-600">Фото видны сотрудникам в общем каталоге. Договоры и сканы добавляйте как документы. Загружайте только материалы, которые вы вправе использовать.</p>
    <div className="flex flex-wrap gap-4">
      <FilePicker label="Выбрать фотографии" multiple accept="image/jpeg,image/png,image/webp" disabled={disabled || queue.busy} selectedCount={queue.items.filter(i => i.kind === "photo").length} onFiles={files => queue.add(files, "photo")} />
      <FilePicker label="Выбрать документы" multiple disabled={disabled || queue.busy} selectedCount={queue.items.filter(i => i.kind === "document").length} onFiles={files => queue.add(files, "document")} />
    </div>
    <ul className="space-y-2" aria-live="polite">{queue.items.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-3 rounded border p-2">
      {item.preview ? <img src={item.preview} alt={`Предпросмотр ${item.file.name}`} className="h-16 w-24 object-cover" /> : null}
      <span className="break-all">{item.file.name} · {Math.ceil(item.file.size / 1024)} КБ · {item.kind === "photo" ? "Фото" : "Документ"}</span>
      {item.kind === "document" ? <label>Тип документа<select className="input" value={item.documentTypeCode} disabled={disabled || queue.busy || item.status === "success"} onChange={(e) => queue.setDocumentType(item.id, e.target.value)}>{optionsOf("documentType").filter((o) => o.value !== "photo").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> : null}
      <span>{({ queued: "В очереди", uploading: "Загрузка…", success: "Загружен", error: "Ошибка" })[item.status]}</span>
      {item.error ? <span role="alert" className="text-red-700">{item.error}</span> : null}
      {item.status === "error" && propertyId ? <button type="button" className="btn" disabled={queue.busy || disabled} onClick={async () => { await queue.upload(propertyId, item.id); router.refresh(); }}>Повторить</button> : null}
      {item.status !== "success" ? <button type="button" className="btn" disabled={queue.busy || disabled} onClick={() => queue.remove(item.id)}>Убрать</button> : null}
    </li>)}</ul>
  </section>;
}
