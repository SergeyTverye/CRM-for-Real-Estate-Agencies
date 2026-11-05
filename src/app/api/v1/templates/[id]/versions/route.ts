import { api, json } from "@/server/api-handler";
import { saveTemplate } from "@/modules/document-templates/application/template-service";
import { readTemplateForm } from "@/modules/document-templates/application/http";
export const POST = api<{ id: string }>({ access: "manager" }, async ({ actor, req, params }) => { const d = await readTemplateForm(req); return json(await saveTemplate(actor, d.raw, d.file, params.id, d.expectedUpdatedAt), 201); });
