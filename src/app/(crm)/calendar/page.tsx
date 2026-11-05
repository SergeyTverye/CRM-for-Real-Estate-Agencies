import { requirePageActor } from "@/server/page-auth";
import { tz } from "@/server/format";
import { loadDictionaries, userOptions } from "@/server/options";
import { needLabels } from "@/ui/domain/deal-prefill";
import { CalendarClient } from "./calendar-client";
export const metadata = { title: "Календарь" };
export default async function CalendarPage() {
  const actor = await requirePageActor();
  return <CalendarClient timeZone={tz()} userId={actor.userId} users={await userOptions()} labels={needLabels(await loadDictionaries())} />;
}
