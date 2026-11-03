import { api } from "@/server/api-handler";
import { listArchive } from "@/modules/archive/application/archive-service";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({ access: "manager" }, async ({ req, actor }) => listArchive(actor, searchParamsToObject(req.nextUrl.searchParams)));
