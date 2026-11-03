import { api } from "@/server/api-handler";
import { getTodayView } from "@/modules/tasks/application/task-queries";
import { searchParamsToObject } from "@/shared/validation";

export const GET = api({}, async ({ req, actor }) => getTodayView(actor, searchParamsToObject(req.nextUrl.searchParams)));
