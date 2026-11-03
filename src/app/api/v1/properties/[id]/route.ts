import { api, readJson } from "@/server/api-handler";
import { updateProperty } from "@/modules/properties/application/property-service";
import { getPropertyCard } from "@/modules/properties/application/property-queries";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getPropertyCard(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateProperty(actor, params.id, await readJson(req)));
