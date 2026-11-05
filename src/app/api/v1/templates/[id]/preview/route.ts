import { api } from "@/server/api-handler";
import { previewTemplate } from "@/modules/document-templates/application/template-service";
import { previewResponse } from "@/modules/document-templates/application/http";
export const GET = api<{ id: string }>({ access: "manager" }, async ({ actor, params, req }) => previewResponse(await previewTemplate(actor, params.id, req.nextUrl.searchParams.get("versionId") ?? undefined)));
