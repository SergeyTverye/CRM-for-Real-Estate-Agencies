import { requirePageActor } from "@/server/page-auth";
import { tz } from "@/server/format";
import { loadDictionaries, userOptions } from "@/server/options";
import { needLabels } from "@/ui/domain/deal-prefill";
import { CalendarClient } from "./calendar-client";
import { getPlannerSetting } from "@/modules/calendar/application/planner-service";
export const metadata = { title: "Календарь" };
export default async function CalendarPage() {
  const actor = await requirePageActor();
  const setting = await getPlannerSetting();
  return <CalendarClient timeZone={tz()} userId={actor.userId} isManager={actor.role === "manager"} setting={{ ...setting, updatedAt: setting.updatedAt?.toISOString() ?? null }} users={await userOptions()} labels={needLabels(await loadDictionaries())} />;
}
