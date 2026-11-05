import { api, readJson } from "@/server/api-handler";
import { parseQuery } from "@/modules/property-search/application/search-service";
import { parseInput } from "@/shared/validation";
import { z } from "zod";
export const POST = api({}, async ({actor, req}) => {const d = parseInput(z.object({text:z.string(),currentFilters:z.unknown()}),await readJson(req)); return parseQuery(actor,d.text,d.currentFilters);});
