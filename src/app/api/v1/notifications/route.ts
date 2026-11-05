import { api } from "@/server/api-handler";
import { listNotifications } from "@/modules/notifications/application/notification-service";
import { searchParamsToObject } from "@/shared/validation";
export const GET = api({}, async ({ actor, req }) => listNotifications(actor, searchParamsToObject(req.nextUrl.searchParams)));
