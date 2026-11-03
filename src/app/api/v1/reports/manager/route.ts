import { api } from "@/server/api-handler";
import { getManagerReport } from "@/modules/reports/application/report-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({ access: "manager" }, async ({ req, actor }) => getManagerReport(actor, searchParamsToObject(req.nextUrl.searchParams)));
