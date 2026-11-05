import { notFound } from "next/navigation";
import { NotFoundError } from "@/shared/errors";
import Link from "next/link";
import type { Actor } from "@/modules/auth/domain/actor";
import { getChecklist } from "@/modules/deals/application/checklist-service";
import { Card } from "@/ui/components";
import { ActionButton, QuickFormButton } from "@/ui/client-kit";
import { labelOf, optionsOf } from "@/shared/codebook";
import { userOptions } from "@/server/options";
import { fmtDateTime, tz } from "@/server/format";
export async function ChecklistPanel({ actor, dealId, canEdit, print = false }: { actor: Actor; dealId: string; canEdit: boolean; print?: boolean }) {
  const { items, documents } = await getChecklist(actor, dealId).catch(e => { if (e instanceof NotFoundError) notFound(); throw e; });
  const users = canEdit ? await userOptions() : [];
  return <Card title="Чек-лист документов сделки" className="mb-4" actions={!print ? <Link className="btn" href={`/deals/${dealId}/checklist/print`}>Печать</Link> : undefined}>
    <p>Применимость и достаточность документов определяет сотрудник.</p>
    {!items.length && canEdit ? <ActionButton url={`/api/v1/deals/${dealId}/checklist`} label="Создать по шаблону сделки" /> : null}
    <table className="table"><thead><tr><th>Материал</th><th>Статус</th><th>Ответственный / дата</th><th>Файл</th>{!print ? <th>Действия</th> : null}</tr></thead><tbody>
      {items.map(i => <tr key={i.id}><td>{i.title}</td><td>{labelOf("dealChecklistStatus", i.status)}</td><td>{i.responsible.displayName}<br/>{fmtDateTime(i.checkedAt)}</td><td>{i.documentId ? <a href={`/api/v1/documents/${i.documentId}/download`}>{documents.find(d => d.id === i.documentId)?.originalName}</a> : "—"}</td>
      {!print ? <td>{canEdit ? <QuickFormButton label="Изменить" title={i.title} method="PATCH" url={`/api/v1/deals/${dealId}/checklist/${i.id}`} timeZone={tz()} extraBody={{ expectedUpdatedAt: i.updatedAt.toISOString() }} fields={[
        { name: "status", label: "Статус", type: "select", options: optionsOf("dealChecklistStatus"), initial: i.status, required: true },
        { name: "responsibleUserId", label: "Ответственный", type: "select", options: users, initial: i.responsibleUserId, required: true },
        { name: "checkedAt", label: "Дата", type: "datetime", initial: i.checkedAt?.toISOString() ?? "" },
        { name: "documentId", label: "Документ сделки", type: "select", options: documents.map(d => ({ value: d.id, label: d.originalName })), initial: i.documentId ?? "" },
      ]} /> : null}</td> : null}</tr>)}
    </tbody></table>
  </Card>;
}
