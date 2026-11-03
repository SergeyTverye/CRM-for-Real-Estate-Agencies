import { api, json, readJson } from "@/server/api-handler";
import { createAgreement, listAgreements } from "@/modules/agreements/application/agreement-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listAgreements(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createAgreement(actor, await readJson(req)), 201));
