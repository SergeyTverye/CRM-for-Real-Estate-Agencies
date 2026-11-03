import { api, readJson } from "@/server/api-handler";
import { updateClient } from "@/modules/clients/application/client-service";
import { getClientCard } from "@/modules/clients/application/client-queries";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getClientCard(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateClient(actor, params.id, await readJson(req)));
