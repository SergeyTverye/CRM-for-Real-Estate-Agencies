/** Re-index existing LIVE evidence, never issue network requests or invent missing bodies. */
import { readFile, writeFile } from "node:fs/promises";
import type { Source } from "../../../../src/modules/property-search/domain/types";
async function main() {
  const dir = "tests/fixtures/scraper/p0a-final";
  const prior = JSON.parse(await readFile("docs/vkr/live-search-v31-evidence.json", "utf8"));
  const current = JSON.parse(await readFile(`${dir}/ledger.json`, "utf8"));
  for (const source of ["cian", "avito", "domclick", "yandex", "mirkvartir", "onrealt", "youla"] as Source[]) {
    const earlier = JSON.parse(await readFile(`tests/fixtures/scraper/v31/${source}/live.json`, "utf8"));
    const recent = [...current.responses].reverse().find(r => r.source === source);
    const oldRun = [...prior.runs].reverse().find(r => r.mode === "LIVE" && r.sources.some((s: {source: string; status: string}) => s.source === source && !["disabled", "cancelled"].includes(s.status)));
    const oldSource = oldRun?.sources.find((s: { source: string }) => s.source === source);
    const http = recent?.status ?? (Number(oldSource?.reason?.match(/HTTP (\d+)/u)?.[1]) || earlier.responses.at(-1)?.status || null);
    const snapshot = { mode: "REPLAY", capturedFrom: "LIVE", source,
      capturedAt: recent?.fetchedAt ?? [...current.attempts].reverse().find((r: {source: string}) => r.source === source)?.at ?? oldRun?.finishedAt ?? earlier.finishedAt,
      transportStatus: http, outcome: [401, 403, 439].includes(http) ? "BLOCKED" : recent?.status === 200 || oldSource?.status === "success" || earlier.status === "PASS" ? "PASS" : "PARTIAL",
      bodyFile: recent?.file ?? (source === "mirkvartir" ? `${dir}/mirkvartir-serp.html` : null),
      bodyCoverage: recent ? "date/identity-only projection" : "Latest body not retained; only prior markup structure and transport/application metadata available",
      previousReplay: `tests/fixtures/scraper/v31/${source}/live.json`, normalized: earlier.normalized,
      reason: recent ? "Bounded public HTTPS capture" : oldSource?.reason ?? earlier.failure ?? null,
      caveat: "Not a full source-body replay. Missing text/attributes cannot be reconstructed from status metadata. No new LIVE request was made by this indexer." };
    await writeFile(`${dir}/${source}-response.json`, JSON.stringify(snapshot, null, 2) + "\n");
  }
}
void main();
