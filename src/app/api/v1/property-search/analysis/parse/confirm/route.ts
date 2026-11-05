import { api, readJson } from "@/server/api-handler";
import { confirmAnalysisQuery } from "@/modules/ai/application/listing-analysis-service";
export const runtime = "nodejs";
export const maxDuration = 180;
export const POST = api({}, async ({actor, req}) => confirmAnalysisQuery(actor, await readJson(req)));
