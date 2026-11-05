import { api, readJson } from "@/server/api-handler";
import { compareAnalysisListings } from "@/modules/ai/application/listing-analysis-service";
export const runtime = "nodejs";
export const maxDuration = 180;
export const POST = api({}, async ({actor, req}) => compareAnalysisListings(actor, await readJson(req)));
