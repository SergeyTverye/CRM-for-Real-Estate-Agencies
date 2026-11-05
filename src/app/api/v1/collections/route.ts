import { api, json, readJson } from "@/server/api-handler";
import { searchParamsToObject } from "@/shared/validation";
import { createCollection, listCollections } from "@/modules/collections/application/collection-service";
export const GET = api({}, async ({ actor, req }) => listCollections(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ actor, req }) => json(await createCollection(actor, await readJson(req)), 201));
