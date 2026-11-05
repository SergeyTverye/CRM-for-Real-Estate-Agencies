import { api } from "@/server/api-handler";
import { searchParamsToObject } from "@/shared/validation";
import { getReportDetail } from "@/modules/reports/application/report-service";
export const GET = api({ access: "manager" }, async ({ actor, req }) => { const f = searchParamsToObject(req.nextUrl.searchParams); return getReportDetail(actor, f.metric ?? "newRequests", f); });
