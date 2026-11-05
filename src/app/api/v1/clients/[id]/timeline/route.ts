import { api } from "@/server/api-handler";
import { getClientTimelinePage } from "@/modules/clients/application/timeline-service";
import { searchParamsToObject } from "@/shared/validation";
export const GET = api<{ id: string }>({}, async ({ actor, params, req }) => getClientTimelinePage(actor, params.id, searchParamsToObject(req.nextUrl.searchParams)));
