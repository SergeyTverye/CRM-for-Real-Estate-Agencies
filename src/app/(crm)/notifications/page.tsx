import { requirePageActor } from "@/server/page-auth";
import { tz } from "@/server/format";
import { getNotificationPreference, listNotifications } from "@/modules/notifications/application/notification-service";
import { NotificationsClient } from "./notifications-client";
export const metadata = { title: "Уведомления" };
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = await searchParams;
  const rawPage = Number(sp.page);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const state = sp.state === "delivered" ? "delivered" : sp.state === "read" ? "read" : undefined;
  const [view, preference] = await Promise.all([listNotifications(actor, { page, state }), getNotificationPreference(actor)]);
  return <NotificationsClient list={{ ...view, items: view.items.map(n => ({ ...n, triggerAt: n.triggerAt.toISOString() })) }} preference={preference} timeZone={tz()} />;
}
