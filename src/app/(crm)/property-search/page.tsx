import { requirePageActor } from "@/server/page-auth";
import { prefillSearch } from "@/modules/property-search/application/listing-service";
import { searchSettings } from "@/modules/property-search/application/dependencies";
import { PageHeader } from "@/ui/components";
import { SearchWorkspace } from "./search-workspace";

export const metadata = { title: "Поиск объектов" };
export default async function PropertySearchPage({ searchParams }: { searchParams: Promise<{ needId?: string }> }) {
  const actor = await requirePageActor();
  const { needId } = await searchParams;
  const [filters, settings] = await Promise.all([prefillSearch(actor, needId), searchSettings()]);
  return <div><PageHeader title="Поиск объектов" subtitle="Рынок недвижимости · условия, доказательства и подборки клиентов" />
    <SearchWorkspace initialFilters={filters} initialNeedId={needId} demoMode={settings.config.SCRAPER_DEMO_FIXTURES}
      aiEnabled={settings.aiEnabled} manualWebAllowed={settings.aiEnabled && settings.manualAllowed} />
  </div>;
}
