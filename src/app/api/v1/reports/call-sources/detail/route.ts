import { api } from "@/server/api-handler";
import { getCallSourceDetails } from "@/modules/reports/application/call-source-service";
import { searchParamsToObject } from "@/shared/validation";
export const GET = api({}, async ({ actor, req }) => getCallSourceDetails(actor, searchParamsToObject(req.nextUrl.searchParams)));
