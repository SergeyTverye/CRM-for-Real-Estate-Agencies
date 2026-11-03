import { api, readJson } from "@/server/api-handler";
import { recordShowingResult } from "@/modules/showings/application/showing-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => recordShowingResult(actor, params.id, await readJson(req)));
