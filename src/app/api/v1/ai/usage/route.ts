import { api } from "@/server/api-handler";
import { getAiUsage } from "@/modules/ai/application/settings-service";
export const GET = api({ access: "manager" }, async ({ actor, req }) => getAiUsage(actor, Object.fromEntries(req.nextUrl.searchParams)));
