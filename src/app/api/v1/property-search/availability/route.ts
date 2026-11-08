import { api } from "@/server/api-handler";
import { searchAvailability } from "@/modules/property-search/application/availability";
export const GET = api({ access: "authenticated" }, async () => searchAvailability());
