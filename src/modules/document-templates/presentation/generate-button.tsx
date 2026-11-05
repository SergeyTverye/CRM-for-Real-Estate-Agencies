"use client";
import { useState } from "react";
import { apiCall, ApiCallError } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
import { Modal } from "@/ui/client-kit";
import type { EntityKind } from "../domain/manifest";
export function GenerateTemplateButton({ entityKind, entityId }: { entityKind: EntityKind; entityId: string }) {
  const [items, setItems] = useState<{ id: string; name: string; version: number; versionId: string }[] | null>(null), [chosen, setChosen] = useState(""), [ready, setReady] = useState(false), [documentId, setDocumentId] = useState(""), [requestId, setRequestId] = useState("");
  const action = useApiAction();
  const [history, setHistory] = useState<{ id: string; name: string; createdAt: string }[]>([]);
  return <><button className="btn btn-sm" disabled={action.pending} onClick={async () => { const r = await action.run(async () => { const templates = await apiCall<{ items: { id: string; name: string; version: number; versionId: string }[] }>("GET", `/api/v1/templates?entityKind=${entityKind}`); const files = await apiCall<{ items: { id: string; name: string; createdAt: string }[] }>("GET", `/api/v1/templates/documents?entityKind=${entityKind}&entityId=${entityId}`); setHistory(files.items); return templates; }); if (r) { setItems(r.items); setChosen(r.items[0]?.id ?? ""); setReady(false); setDocumentId(""); } }}>Сформировать по шаблону</button>
    <FormErrorBanner error={action.error} />
    {items && <Modal open title="Сформировать документ" onClose={() => setItems(null)}><div className="space-y-4">
      {!items.length ? <p>Нет действующих шаблонов для этой карточки. Руководитель может добавить шаблон в разделе «Шаблоны документов».</p> : <>
        <label>Шаблон<select className="input" value={chosen} onChange={e => { setChosen(e.target.value); setReady(false); }} >{items.map(i => <option key={i.id} value={i.id}>{i.name} · версия {i.version}</option>)}</select></label>
        <button className="btn" disabled={action.pending} onClick={() => action.run(async () => {
          const res = await fetch(`/api/v1/templates/${chosen}/generate?preview=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityKind, entityId, versionId: items.find(i => i.id === chosen)?.versionId }) });
          if (!res.ok) { const json = await res.json(); throw new ApiCallError(res.status, json.error); }
          const blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = res.headers.get("content-type")?.includes("spreadsheet") ? "preview.xlsx" : "preview.docx"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setReady(true); setRequestId(crypto.randomUUID()); return true;
        })}>{action.pending ? "Формирование…" : "Скачать предпросмотр"}</button>
        <p>Проверьте предпросмотр перед сохранением. При сохранении значения CRM считываются повторно.</p>
        <button className="btn btn-primary" disabled={!ready || action.pending || !!documentId} onClick={async () => { const r = await action.run(() => apiCall<{ id: string }>("POST", `/api/v1/templates/${chosen}/generate`, { entityKind, entityId, versionId: items.find(i => i.id === chosen)?.versionId, requestId })); if (r) setDocumentId(r.id); }}>Подтвердить и сохранить документ</button>
        {documentId && <a className="btn" href={`/api/v1/templates/documents/${documentId}/file`}>Скачать сохранённый документ</a>}
      </>}
      <FormErrorBanner error={action.error} />
      {!!history.length && <section><h3 className="font-semibold">Ранее сформированные файлы</h3><ul>{history.map(file => <li key={file.id}><a className="underline" href={`/api/v1/templates/documents/${file.id}/file`}>{file.name}</a> · {new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Novosibirsk", dateStyle: "short", timeStyle: "short" }).format(new Date(file.createdAt))}</li>)}</ul></section>}
    </div></Modal>}
  </>;
}
