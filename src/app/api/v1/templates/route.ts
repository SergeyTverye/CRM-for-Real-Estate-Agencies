import { api, json } from "@/server/api-handler";
import { listTemplates, saveTemplate } from "@/modules/document-templates/application/template-service";
import { readTemplateForm } from "@/modules/document-templates/application/http";
export const GET = api({}, async ({ actor, req }) => ({ items: await listTemplates(actor, req.nextUrl.searchParams.get("entityKind") ?? undefined, req.nextUrl.searchParams.get("management") === "true") }));
export const POST = api({ access: "manager" }, async ({ actor, req }) => { const d = await readTemplateForm(req); return json(await saveTemplate(actor, d.raw, d.file), 201); });
