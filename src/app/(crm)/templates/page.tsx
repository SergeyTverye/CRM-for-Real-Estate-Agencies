import { requirePageActor } from "@/server/page-auth";
import { listTemplates } from "@/modules/document-templates/application/template-service";
import { PageHeader } from "@/ui/components";
import { TemplateManager } from "./workspace";
export const metadata = { title: "Шаблоны документов" };
export default async function TemplatesPage() {
  const actor = await requirePageActor({ manager: true });
  const items = await listTemplates(actor, undefined, true);
  return <div><PageHeader title="Шаблоны документов" subtitle="Версии, поля и проверка на синтетических данных" /><TemplateManager items={items} /></div>;
}
