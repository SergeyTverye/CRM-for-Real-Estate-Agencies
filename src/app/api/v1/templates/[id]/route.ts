import { api, readJson } from "@/server/api-handler";
import { getTemplate, changeTemplateStatus } from "@/modules/document-templates/application/template-service";
export const GET = api<{ id: string }>({ access: "manager" }, ({ actor, params }) => getTemplate(actor, params.id));
export const PATCH = api<{ id: string }>({ access: "manager" }, async ({ actor, params, req }) => changeTemplateStatus(actor, params.id, await readJson(req)));
