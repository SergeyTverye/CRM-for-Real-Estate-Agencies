import { api } from "@/server/api-handler";
import { pickCallContext } from "@/modules/requests/application/call-pickers";
import { searchParamsToObject } from "@/shared/validation";
export const GET = api({}, async ({ actor, req }) => pickCallContext(actor, searchParamsToObject(req.nextUrl.searchParams)));
