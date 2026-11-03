import { api, json, readJson } from "@/server/api-handler";
import { recordCommunication } from "@/modules/communications/application/communication-service";

export const POST = api({}, async ({ req, actor }) => json(await recordCommunication(actor, await readJson(req)), 201));
