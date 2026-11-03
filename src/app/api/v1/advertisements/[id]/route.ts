import { api, readJson } from "@/server/api-handler";
import { getAdvertisement, updateAdvertisement } from "@/modules/advertisements/application/advertisement-service";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getAdvertisement(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateAdvertisement(actor, params.id, await readJson(req)));
