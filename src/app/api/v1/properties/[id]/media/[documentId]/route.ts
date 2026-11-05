import { api, readJson } from "@/server/api-handler";
import { updatePropertyMedia } from "@/modules/properties/application/property-media-service";

export const PATCH = api<{ id: string; documentId: string }>({}, async ({ actor, params, req }) => updatePropertyMedia(actor, params.id, params.documentId, await readJson(req)));
