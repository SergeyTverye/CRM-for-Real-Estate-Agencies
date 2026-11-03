import { api } from "@/server/api-handler";
import { getImportJob } from "@/modules/import/application/import-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api<{ id: string }>({ access: "manager" }, async ({ req, actor, params }) => getImportJob(actor, params.id, searchParamsToObject(req.nextUrl.searchParams)));
