import { api, json, readJson } from "@/server/api-handler";
import { proposeProperties } from "@/modules/matching/application/matching-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => json(await proposeProperties(actor, params.id, await readJson(req)), 201));
