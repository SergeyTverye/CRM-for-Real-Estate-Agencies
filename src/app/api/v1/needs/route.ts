import { api, json, readJson } from "@/server/api-handler";
import { createNeed } from "@/modules/needs/application/need-service";
import { listNeeds } from "@/modules/needs/application/need-queries";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listNeeds(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createNeed(actor, await readJson(req)), 201));
