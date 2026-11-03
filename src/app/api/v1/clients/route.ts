import { api, json, readJson } from "@/server/api-handler";
import { createClient } from "@/modules/clients/application/client-service";
import { listClients } from "@/modules/clients/application/client-queries";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listClients(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await createClient(actor, await readJson(req)), 201));
