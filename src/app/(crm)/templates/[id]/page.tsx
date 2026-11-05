import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { getTemplate } from "@/modules/document-templates/application/template-service";
import { PageHeader } from "@/ui/components";
import { fmtDateTime } from "@/server/format";
export default async function TemplateHistory({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor({ manager: true }); const { id } = await params;
  const template = await getTemplate(actor, id);
  return <div><PageHeader title={template.name} subtitle="История неизменяемых версий" back={{ href: "/templates", label: "Шаблоны документов" }} />
    {template.versions.map(v => <section className="card mb-4 space-y-3 p-4" key={v.id}><h2 className="font-semibold">Версия {v.version} · {fmtDateTime(v.createdAt)}</h2><p>{v.compatibilityNote ?? "Специальные ограничения не указаны"}</p><Link className="btn" href={`/api/v1/templates/${id}/preview?versionId=${v.id}`}>Синтетический предпросмотр этой версии</Link><details><summary>Описание полей и содержимое</summary><pre className="overflow-auto whitespace-pre-wrap text-sm">{v.manifestYaml}</pre>{v.markdownBody && <pre className="whitespace-pre-wrap text-sm">{v.markdownBody}</pre>}</details></section>)}
  </div>;
}
