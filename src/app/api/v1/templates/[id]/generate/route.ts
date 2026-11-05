import { api, readJson } from "@/server/api-handler";
import { generateFromTemplate } from "@/modules/document-templates/application/template-service";
import { previewResponse } from "@/modules/document-templates/application/http";
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => {
  const result = await generateFromTemplate(actor, params.id, await readJson(req), req.nextUrl.searchParams.get("preview") === "true");
  return "data" in result ? previewResponse(result) : result;
});
