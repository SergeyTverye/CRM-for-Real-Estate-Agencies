import { api, json, readJson } from "@/server/api-handler";
import { registerRequest } from "@/modules/requests/application/request-service";
import { listRequests } from "@/modules/requests/application/request-queries";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => listRequests(actor, searchParamsToObject(req.nextUrl.searchParams)));
export const POST = api({}, async ({ req, actor }) => json(await registerRequest(actor, await readJson(req)), 201));
