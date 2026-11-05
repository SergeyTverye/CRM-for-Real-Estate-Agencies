import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { processSearchQueue, stopSearchWorker } from "@/modules/property-search/application/search-queue";
import { logger } from "@/shared/logging/logger";
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => controller.abort());
async function main() {
  while (!controller.signal.aborted) {
    try { await processSearchQueue({ signal: controller.signal }); }
    catch { logger.error({ event: "property_search.queue_tick_failed" }, "Search worker tick failed"); }
    if (!controller.signal.aborted) await setTimeout(1000, undefined, { signal: controller.signal }).catch(() => undefined);
  }
  await stopSearchWorker();
}
void main();
