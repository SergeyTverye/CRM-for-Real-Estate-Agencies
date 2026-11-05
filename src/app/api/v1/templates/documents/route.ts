import { api } from "@/server/api-handler";
import { listGeneratedDocuments } from "@/modules/document-templates/application/template-service";
export const GET = api({}, async ({ actor, req }) => ({ items: await listGeneratedDocuments(actor, { entityKind: req.nextUrl.searchParams.get("entityKind"), entityId: req.nextUrl.searchParams.get("entityId") }) }));
