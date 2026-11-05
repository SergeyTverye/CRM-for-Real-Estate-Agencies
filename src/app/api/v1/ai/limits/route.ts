import { api } from "@/server/api-handler";
import { getSearchAiLimits } from "@/modules/property-search/queries/ai-limit-queries";
export const GET = api({ access: "authenticated" }, async ({ actor }) => getSearchAiLimits(actor));
