import { api } from "@/server/api-handler";
import { openTemplateDocument } from "@/modules/document-templates/application/template-service";
import { fileResponse } from "@/modules/document-templates/application/http";
export const GET = api<{ id: string }>({}, async ({ actor, params }) => fileResponse(await openTemplateDocument(actor, params.id)));
