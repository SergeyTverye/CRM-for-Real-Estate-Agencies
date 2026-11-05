import { api } from "@/server/api-handler";
import { propertyMediaResponse } from "@/modules/documents/application/property-media-response";
export const GET = api<{ id: string; documentId: string }>({}, async ({ actor, params }) => propertyMediaResponse(actor, params.id, params.documentId));
