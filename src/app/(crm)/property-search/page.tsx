import { requirePageActor } from "@/server/page-auth";
import { prefillSearch } from "@/modules/property-search/application/listing-service";
import { searchSettings } from "@/modules/property-search/application/dependencies";
import { pickSearchNeeds } from "@/modules/property-search/queries/picker-queries";
import { PageHeader } from "@/ui/components";
import { SearchWorkspace } from "./search-workspace";
import { accessibleRun } from "@/modules/property-search/application/search-service";
import { SearchFilters } from "@/modules/property-search/domain/types";

export const metadata = { title: "Поиск объектов" };
export default async function PropertySearchPage({ searchParams }: { searchParams: Promise<{ needId?: string; runId?: string }> }) {
  const actor = await requirePageActor();
  const params = await searchParams;
  const run = params.runId ? await accessibleRun(actor, params.runId) : null;
  const needId = run?.needId ?? params.needId;
  const [filters, settings, picked] = await Promise.all([prefillSearch(actor, needId), searchSettings(), needId ? pickSearchNeeds(actor, {needId}) : Promise.resolve(null)]);
  return <div><PageHeader title="Поиск объектов" subtitle="Рынок недвижимости · условия, доказательства и подборки клиентов" />
    <SearchWorkspace initialFilters={run ? SearchFilters.parse(run.filters) : filters} initialRun={run ? JSON.parse(JSON.stringify(run)) : undefined} initialNeedId={needId} initialNeed={picked?.items[0]} demoMode={settings.config.SCRAPER_DEMO_FIXTURES}
      aiEnabled={settings.aiEnabled} manualWebAllowed={settings.aiEnabled && settings.manualAllowed} />
  </div>;
}
