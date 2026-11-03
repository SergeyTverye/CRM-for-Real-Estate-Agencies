import { api, json } from "@/server/api-handler";
import { requestOwnerContactAccess } from "@/modules/properties/application/property-service";

export const POST = api<{ id: string }>({}, async ({ actor, params }) => json(await requestOwnerContactAccess(actor, params.id), 201));
