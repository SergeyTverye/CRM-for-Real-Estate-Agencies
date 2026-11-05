import { api, readJson } from "@/server/api-handler";
import { analyzeListingBatch } from "@/modules/ai/application/listing-analysis-service";
export const runtime = "nodejs";
export const maxDuration = 180;
export const POST = api({}, async ({actor, req}) => analyzeListingBatch(actor, await readJson(req)));
