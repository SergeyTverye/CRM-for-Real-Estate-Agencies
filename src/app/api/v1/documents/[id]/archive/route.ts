import { api } from "@/server/api-handler";
import { archiveDocument } from "@/modules/documents/application/document-service";

export const POST = api<{ id: string }>({}, async ({ actor, params }) => {
  await archiveDocument(actor, params.id);
  return { ok: true };
});
