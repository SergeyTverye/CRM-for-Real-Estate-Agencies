import { api } from "@/server/api-handler";
import { readNotification } from "@/modules/notifications/application/notification-service";
export const POST = api({}, async ({ actor }) => readNotification(actor));
