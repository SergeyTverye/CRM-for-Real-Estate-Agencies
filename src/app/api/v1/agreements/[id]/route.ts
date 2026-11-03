import { api, readJson } from "@/server/api-handler";
import { getAgreement, updateAgreement } from "@/modules/agreements/application/agreement-service";

export const GET = api<{ id: string }>({}, async ({ actor, params }) => getAgreement(actor, params.id));
export const PATCH = api<{ id: string }>({}, async ({ req, actor, params }) => updateAgreement(actor, params.id, await readJson(req)));
