import { api, json, readJson } from "@/server/api-handler";
import { createAdvertisement, listAdvertisements } from "@/modules/advertisements/application/advertisement-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listAdvertisements(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createAdvertisement(actor, await readJson(req)), 201));
