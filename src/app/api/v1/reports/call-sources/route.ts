import { api } from "@/server/api-handler";
import { getCallSourceReport } from "@/modules/reports/application/call-source-service";
import { searchParamsToObject } from "@/shared/validation";
export const GET = api({}, async ({ actor, req }) => getCallSourceReport(actor, searchParamsToObject(req.nextUrl.searchParams)));
