/** Offline replay of saved LIVE snapshots. No scraper, HTTP or AI dependencies. */
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db, disconnectDb, Prisma } from "../../src/shared/db/client";
import { evaluateListing } from "../../src/modules/property-search/domain/evaluation";
import { SearchFilters, type CriterionEvaluation, type NormalizedListing } from "../../src/modules/property-search/domain/types";

async function main() {
  config({ path: [".env.local", ".env"], quiet: true });
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/crm_demo" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Only local crm_demo is permitted");
  process.env.AI_ENABLED = "false";
  process.env.SCRAPER_ENABLED = "false";
  const apply = process.argv.includes("--apply");
  const evidence = JSON.parse(await readFile("docs/vkr/live-ai-evidence.json", "utf8")) as { runs: { id: string }[] };
  const runs = await db.searchRun.findMany({ where: { id: { in: evidence.runs.map(r => r.id) } }, include: { results: true, snapshots: { orderBy: { fetchedAt: "desc" } } } });
  if (runs.length !== evidence.runs.length) throw new Error("Missing saved LIVE runs");
  const changes: { id: string; runId: string; listingId: string; before: string; after: string; previousCriteria: Prisma.JsonValue; criteria: CriterionEvaluation[] }[] = [];
  let evaluated = 0;
  for (const run of runs) {
    const filters = SearchFilters.parse(run.filters);
    for (const result of run.results) {
      const snapshot = run.snapshots.find(s => s.listingId === result.listingId);
      if (!snapshot) throw new Error(`Missing snapshot for result ${result.id}`);
      const listing = snapshot.normalized as unknown as NormalizedListing;
      // Historical 2.1.0 snapshots predate provenance: Yandex/OnRealt use
      // baseParser + inferPropertyType(title), not a structured purpose field.
      const replay = { ...listing, purposeSource: listing.purposeSource ?? (["yandex", "onrealt"].includes(listing.source) ? "rule" as const : "structured" as const) };
      const evaluation = evaluateListing(replay, filters);
      evaluated++;
      const purpose = evaluation.criteria.find(c => c.criterion === "purpose" && c.state === "contradicted");
      // Scope of this repair is purpose only. Preserve historical AI and all other evidence.
      if (!purpose || result.verdict === "rejected") continue;
      const previous = result.criteria as unknown as CriterionEvaluation[];
      changes.push({ id: result.id, runId: run.id, listingId: result.listingId, before: result.verdict, after: "rejected", previousCriteria: result.criteria,
        criteria: [...previous.filter(c => c.criterion !== "purpose"), purpose] });
    }
  }
  const transitioned = changes.filter(c => c.before === "needs_review").length;
  const confirmedToRejected = changes.filter(c => c.before === "confirmed").length;
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${runs.length} runs, ${evaluated} results; needs_review → rejected: ${transitioned}; total changed: ${changes.length}`);
  if (!apply || !changes.length) return;
  const time = new Date().toISOString();
  await mkdir("data", { recursive: true });
  await writeFile(`data/reevaluate-live-before-${time.replace(/[:.]/gu, "-")}.json`, JSON.stringify(changes, null, 2) + "\n");
  await db.$transaction(async tx => {
    for (const change of changes) {
      const result = await tx.searchRunResult.updateMany({ where: { id: change.id, verdict: change.before, criteria: { equals: change.previousCriteria === null ? Prisma.JsonNull : change.previousCriteria } }, data: {
        verdict: change.after, criteria: JSON.parse(JSON.stringify(change.criteria)) as Prisma.InputJsonValue,
      } });
      if (result.count !== 1) throw new Error("Saved result changed concurrently; transaction rolled back");
    }
  });
  const perRun = runs.map(run => ({ runId: run.id, evaluated: run.results.length, needsReviewToRejected: changes.filter(c => c.runId === run.id && c.before === "needs_review").length }));
  await writeFile("docs/vkr/offline-purpose-evaluation.json", JSON.stringify({ time, database: "crm_demo", mode: "offline", aiCalls: 0, networkCalls: 0, evaluated, transitioned, confirmedToRejected, perRun,
    changes: changes.map(({ previousCriteria: _previous, criteria: _criteria, ...change }) => change) }, null, 2) + "\n");
  const report = "docs/vkr/live-ai-trials.md";
  const section = "\n## Офлайн-переоценка после правила назначения\n";
  const content = await readFile(report, "utf8");
  const text = `\n${time}: сохранённые снимки ${runs.length} живых запусков crm_demo, ${evaluated} результатов. Переход **needs_review → rejected: ${transitioned}**; всего изменений: ${changes.length}. Исходные вердикты жилых объявлений при испытании были **needs_review**. Это исправление детерминированного правила после испытания, а не новый успешный LIVE-прогон. Исходный live-ai-evidence.json не переписывался.\n\nСтруктурированная жилая категория или явные признаки жилья без коммерческих сигналов дают purpose=contradicted с фрагментом доказательства (§3.1). Смешанные случаи не отклоняются этим текстовым правилом. Пересчитан только критерий назначения; остальные исторические доказательства, score, новизна, цены и снимки объявлений сохранены. AI, web и скрапер не вызывались; новых расходов нет.\n\n| Run ID | Проверено | needs_review → rejected |\n|---|---:|---:|\n${perRun.map(r => `| ${r.runId} | ${r.evaluated} | ${r.needsReviewToRejected} |`).join("\n")}\n\nДетали: [offline-purpose-evaluation.json](offline-purpose-evaluation.json). Повтор: DATABASE_URL указывает на локальную crm_demo; \`npx tsx scripts/vkr/reevaluate-live.ts\` — dry-run, \`--apply\` — транзакционная запись. Повторный apply без изменений не переписывает первоначальный отчёт.\n`;
  const details = `\nДополнительно **confirmed → rejected: ${confirmedToRejected}**. В старых снимках Yandex/OnRealt purpose выводился пакетом real-estate-scrapper 2.1.0 через baseParser/inferPropertyType(title), а не читался из структурированного поля площадки. При replay восстановлено происхождение rule; исходные snapshots не изменены. Новая нормализация сохраняет purposeSource и category для будущих запусков.\n`;
  await writeFile(report, content.split(section)[0] + section + text + details);
}
main().catch(() => { console.error("Offline reevaluation failed; inspect local database and saved snapshots (no credentials logged)"); process.exitCode = 1; }).finally(disconnectDb);
