import { api } from "@/server/api-handler";
import { unreadCount } from "@/modules/notifications/application/notification-service";
export const GET = api({}, async ({ actor }) => unreadCount(actor));
