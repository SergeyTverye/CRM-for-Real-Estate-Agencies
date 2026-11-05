import { api, readJson } from "@/server/api-handler";
import { getPlannerSetting, setPlannerSetting } from "@/modules/calendar/application/planner-service";
export const GET = api({}, async () => getPlannerSetting());
export const PUT = api({}, async ({ actor, req }) => setPlannerSetting(actor, await readJson(req)));
