import { api } from "@/server/api-handler";
import { getAiLimits } from "@/modules/ai/application/settings-service";
export const GET = api({ access: "authenticated" }, async ({ actor }) => getAiLimits(actor));
