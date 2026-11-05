import { api } from "@/server/api-handler";
import { searchProgress } from "@/modules/property-search/application/progress-service";
export const GET = api<{ id: string }>({}, async ({ actor, params }) => searchProgress(actor, params.id));
