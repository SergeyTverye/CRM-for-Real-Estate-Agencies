import { api } from "@/server/api-handler";
import { FILTER_CATALOG } from "@/modules/property-search/domain/filter-catalog";
export const GET = api({}, async () => ({ version: 1, purposeLogic: "OR", requiredLogic: "AND", filters: FILTER_CATALOG }));
