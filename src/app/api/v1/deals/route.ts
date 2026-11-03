import { api, json, readJson } from "@/server/api-handler";
import { createDeal, listDeals } from "@/modules/deals/application/deal-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listDeals(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createDeal(actor, await readJson(req)), 201));
