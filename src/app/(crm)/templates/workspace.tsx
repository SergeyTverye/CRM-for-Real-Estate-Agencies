"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
import { Modal } from "@/ui/client-kit";
import { FIELD_CATALOG } from "@/modules/document-templates/domain/manifest";

const formatLabel: Record<string, string> = { markdown_docx: "Markdown → DOCX", docx: "DOCX", xlsx: "XLSX", xlsx_registry: "Реестр XLSX" };
type Item = { id: string; name: string; code: string; format: string; status: string; updatedAt: string; version?: number; description: string | null; manifestYaml?: string; compatibilityNote?: string | null };
const DEFAULT_MANIFEST = 'schemaVersion: 1\nentityKind: client\nsources: [client, user]\nfields:\n  - path: client.displayName\n    label: Клиент\n    type: text\n    required: true\n';
export function TemplateManager({ items }: { items: Item[] }) {
  const [editing, setEditing] = useState<Item | "new" | null>(null), [dirty, setDirty] = useState(false);
  const action = useApiAction(), router = useRouter(); useUnsavedChangesWarning(dirty);
  const row = editing && editing !== "new" ? editing : null;
  return <div className="space-y-4">
    <button className="btn btn-primary" onClick={() => setEditing("new")}>Загрузить шаблон</button>
    <FormErrorBanner error={action.error} />
    {!items.length ? <p>Шаблонов пока нет. Загрузите первый шаблон и описание полей.</p> : <div className="overflow-x-auto"><table className="table w-full text-sm"><thead><tr><th>Название</th><th>Формат / версия</th><th>Состояние</th><th>Действия</th></tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-b"><td className="p-3">{item.name}<p className="text-muted">{item.description}</p></td><td className="whitespace-nowrap">{formatLabel[item.format] ?? item.format} · v{item.version}</td><td>{{ active: "Действует", disabled: "Отключён", archived: "Архив" }[item.status]}</td><td><div className="flex flex-wrap gap-2">
      <a className="btn btn-sm" href={`/templates/${item.id}`}>История и поля</a>
      <a className="btn btn-sm" href={`/api/v1/templates/${item.id}/preview`}>Проверить / скачать предпросмотр</a>
      {item.status !== "archived" && <button className="btn btn-sm" onClick={async () => { const detail = await action.run(() => apiCall<{ versions: { markdownBody: string | null }[] }>("GET", `/api/v1/templates/${item.id}`)); if (detail) setEditing({ ...item, ...({ markdownBody: detail.versions[0]?.markdownBody } as object) }); }}>Новая версия</button>}
      {[item.status === "active" ? "disabled" : "active", "archived"].filter((s, i, a) => s !== item.status && a.indexOf(s) === i).map(status => <button key={status} className="btn btn-sm" disabled={action.pending} onClick={async () => { if (await action.run(() => apiCall("PATCH", `/api/v1/templates/${item.id}`, { status, expectedUpdatedAt: item.updatedAt }))) router.refresh(); }}>{status === "active" ? "Включить" : status === "disabled" ? "Отключить" : "В архив"}</button>)}
    </div></td></tr>)}</tbody></table></div>}
    <details><summary>Доступные поля и правила</summary><p>Руководитель управляет шаблонами. Доступ к исходным записям проверяется при каждом формировании. ИНН — только руководителю. Синтаксис: {"{{client.displayName}}, {{#if offer.introText}}…{{/if}}, {{#each properties}}{{this.address}}{{/each}}"}.</p><ul>{Object.entries(FIELD_CATALOG).map(([path, type]) => <li key={path}>{path} — {type}</li>)}</ul><p>Дата — Новосибирск, деньги — рубли, площадь — м². Описание форматов и ограничений: docs/templates.md.</p></details>
    {editing && <Modal open title={row ? `Новая версия: ${row.name}` : "Новый шаблон"} onClose={() => { if (!dirty) setEditing(null); }}>
      <form key={row?.id ?? "new"} className="space-y-3" onChange={() => setDirty(true)} onSubmit={async e => {
        e.preventDefault(); const form = new FormData(e.currentTarget); if (row) form.set("expectedUpdatedAt", row.updatedAt);
        const result = await action.run(() => apiCall("POST", row ? `/api/v1/templates/${row.id}/versions` : "/api/v1/templates", form));
        if (result) { setDirty(false); setEditing(null); router.refresh(); }
      }}>
        <label className="block">Стабильный код<input className="input" name="code" required defaultValue={row?.code} readOnly={!!row} pattern="[a-z][a-z0-9_-]+" /></label>
        <label className="block">Название<input className="input" name="name" required defaultValue={row?.name} /></label>
        <label className="block">Описание<input className="input" name="description" defaultValue={row?.description ?? ""} /></label>
        <label className="block">Формат<select className="input" name="format" defaultValue={row?.format ?? "markdown_docx"} aria-readonly={!!row}>{(row ? [row.format] : ["markdown_docx", "docx", "xlsx", "xlsx_registry"]).map(f => <option key={f} value={f}>{formatLabel[f] ?? f}</option>)}</select></label>
        <label className="block">YAML-манифест<textarea className="input font-mono" rows={10} name="manifestYaml" required defaultValue={row?.manifestYaml ?? DEFAULT_MANIFEST} /></label>
        <label className="block">Markdown (для Markdown → DOCX)<textarea className="input" rows={6} name="markdownBody" defaultValue={(row as Item & { markdownBody?: string })?.markdownBody ?? "# Карточка клиента\n\nКлиент: {{client.displayName}}"} /></label>
        <label className="block">Файл DOCX / XLSX (до 5 МБ)<input type="file" name="file" accept=".docx,.xlsx" /></label>
        <label className="block">Совместимость и ограничения<input className="input" name="compatibilityNote" /></label>
        <FormErrorBanner error={action.error} /><p>Сохранение проверит шаблон на синтетических данных. Для проверки в Word/Excel скачайте предпросмотр из списка.</p>
        <button className="btn btn-primary" disabled={action.pending}>{action.pending ? "Проверка и сохранение…" : "Проверить и сохранить"}</button>
        <button className="btn" type="button" onClick={() => { setDirty(false); setEditing(null); }}>Отменить изменения</button>
      </form>
    </Modal>}
  </div>;
}
