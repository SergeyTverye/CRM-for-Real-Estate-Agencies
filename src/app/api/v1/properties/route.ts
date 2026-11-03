import { api, json, readJson } from "@/server/api-handler";
import { createProperty } from "@/modules/properties/application/property-service";
import { listProperties } from "@/modules/properties/application/property-queries";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listProperties(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createProperty(actor, await readJson(req)), 201));
