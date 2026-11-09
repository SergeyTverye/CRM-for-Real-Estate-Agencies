import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { SearchFilters, type NormalizedListing } from "../../src/modules/property-search/domain/types";
import { evaluateListing } from "../../src/modules/property-search/domain/evaluation";
import { enrichListingQuality } from "../../src/modules/property-search/infrastructure/listing-quality";

async function main() {
  const baseline = JSON.parse(await readFile("docs/vkr/live-search-v323-e2e.json", "utf8")) as { scenarios: { id: string; runId: string; filters: unknown }[] };
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const scenarios = [];
  const sources: Record<string, { total: number; unknownBefore: number; unknownAfter: number; daily: number }> = {};
  try {
    for (const scenario of baseline.scenarios) {
      const { rows } = await db.query<{ normalized: NormalizedListing }>("SELECT normalized FROM external_listing_snapshots WHERE search_run_id=$1 ORDER BY id", [scenario.runId]);
      const filters = SearchFilters.parse(scenario.filters);
      const counts = { confirmed: 0, needs_review: 0, rejected: 0 };
      let unknownBefore = 0, unknownAfter = 0, daily = 0;
      for (const { normalized: before } of rows) {
        const after = enrichListingQuality(before);
        const source = sources[before.source] ??= { total: 0, unknownBefore: 0, unknownAfter: 0, daily: 0 };
        if (filters.operation === "rent") {
          source.total++;
          if (!before.priceUnit) { unknownBefore++; source.unknownBefore++; }
          if (!after.priceUnit && after.structuredFeatures.rentalPeriod !== "day") { unknownAfter++; source.unknownAfter++; }
          if (after.structuredFeatures.rentalPeriod === "day") { daily++; source.daily++; }
        }
        counts[evaluateListing(after, filters).verdict]++;
      }
      const roomCounts = scenario.id === "b" ? rows.reduce((acc, { normalized }) => { acc[evaluateListing(enrichListingQuality(normalized), { ...filters, rooms: ["2"] }).verdict]++; return acc; }, { confirmed: 0, needs_review: 0, rejected: 0 }) : undefined;
      scenarios.push({ id: scenario.id, runId: scenario.runId, total: rows.length, counts, unknownBefore, unknownAfter, daily, ...(roomCounts ? { withRooms2: roomCounts } : {}) });
    }
    const result = { mode: "REPLAY", recordedAt: new Date().toISOString(), source: "crm_demo persisted normalized snapshots; no refetch, no CRM writes, no AI", scenarios, rentalPeriodBySource: sources };
    await writeFile("docs/vkr/replay-search-v323-quality.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.code ?? error.name); process.exitCode = 1; });
