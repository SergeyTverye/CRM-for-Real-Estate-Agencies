import { api, readJson } from "@/server/api-handler";
import { changeNeedState } from "@/modules/needs/application/need-service";

export const POST = api<{ id: string }>({}, async ({ req, actor, params }) => changeNeedState(actor, params.id, await readJson(req)));
