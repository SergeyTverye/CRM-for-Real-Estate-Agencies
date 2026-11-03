import { api, json, readJson } from "@/server/api-handler";
import { listShowings, scheduleShowing } from "@/modules/showings/application/showing-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listShowings(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await scheduleShowing(actor, await readJson(req)), 201));
