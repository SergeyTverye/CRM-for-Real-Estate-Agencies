import { config } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { db, disconnectDb } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { exportSearch } from "@/modules/property-search/application/export-service";
import { exportCollection } from "@/modules/collections/application/export-service";

config({ path: [".env.local", ".env"], quiet: true });
assert.equal(new URL(process.env.DATABASE_URL ?? "http://invalid").pathname, "/crm_demo", "Requires explicit crm_demo DATABASE_URL");
Object.assign(process.env, { AI_ENABLED: "false", SCRAPER_ENABLED: "false", YANDEX_WEB_SEARCH_ENABLED: "false", LOG_LEVEL: "silent" });

async function actorFor(userId: string): Promise<Actor> {
  // Maintenance export of saved evidence; no login/session or user-state changes.
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return { userId, login: user.login, displayName: user.displayName, role: user.roleCode as Actor["role"], mustChangePassword: false, sessionId: "maintenance-export" };
}
async function main() {
  const evidence = JSON.parse(await readFile("docs/vkr/p0a-closure-evidence.json", "utf8"));
  const runId: string = evidence.runs.find((r: { scenario: string }) => r.scenario === "office-repeat").id;
  const run = await db.searchRun.findUniqueOrThrow({ where: { id: runId } });
  const actor = await actorFor(run.userId);
  const urls = ["https://onrealt.ru/novosibirsk/kypit-ofis/86529231", "https://onrealt.ru/novosibirsk/kypit-ofis/86528546", "https://realty.yandex.ru/offer/7567068812130613984/", "https://onrealt.ru/novosibirsk/kypit-ofis/86529524"];
  const selected = await db.searchRunResult.findMany({ where: { runId, listing: { url: { in: urls } } }, select: { listingId: true } });
  assert.equal(selected.length, 4);
  const collection = await db.propertyCollection.findUniqueOrThrow({ where: { id: "a8cac82f-e6e8-4ead-a9c5-3ed3651b4baa" } });
  const records = [];
  await mkdir("docs/vkr/exports/v31", { recursive: true });
  for (const name of ["search-all", "search-selected", "collection"]) {
    for (const format of ["xlsx", "csv"] as const) {
      const result = name === "collection" ? await exportCollection(await actorFor(collection.ownerUserId), collection.id, { format })
        : await exportSearch(actor, runId, { format, ...(name === "search-selected" ? { ids: selected.map(r => r.listingId) } : {}) });
      const file = `docs/vkr/exports/v31/${name}.${format}`;
      await writeFile(file, result.bytes);
      let rows: number;
      let hyperlinks = 0;
      if (format === "xlsx") {
        const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(result.bytes) as never);
        const sheet = book.worksheets[0]!; rows = sheet.rowCount - 1;
        sheet.eachRow((row, n) => row.eachCell(cell => {
          assert.equal(cell.formula, undefined);
          if (cell.hyperlink) hyperlinks++;
          if (n > 1) assert.ok(!/^(?:unknown|exact|site_published|rub_total|per_m2|confirmed|needs_review|rejected|office|sale|rent)$/u.test(cell.text));
        }));
      } else {
        const text = Buffer.from(result.bytes).toString("utf8");
        assert.ok(text.startsWith("\uFEFF"));
        // CSV may contain quoted newlines in duplicate links.
        rows = (text.slice(1).match(/(?:^|\r\n)"(?:[^"\r\n]|"")*";/gu) ?? []).length - 1;
      }
      assert.equal(rows, name === "search-all" ? 70 : name === "search-selected" ? 4 : 24);
      records.push({ file, rows, hyperlinks: format === "xlsx" ? hyperlinks : undefined, sha256: createHash("sha256").update(result.bytes).digest("hex") });
    }
  }
  await writeFile("docs/vkr/business-export-refresh.json", JSON.stringify({ mode: "REPLAY of saved LIVE data in crm_demo", date: new Date().toISOString(), runId, collectionId: collection.id, selectedUrls: urls, externalCalls: 0, aiCalls: 0, records }, null, 2) + "\n");
  await writeFile("docs/vkr/exports/v31/SHA256SUMS", [...records].sort((a, b) => a.file.localeCompare(b.file)).map(record => `${record.sha256}  ${record.file.split("/").at(-1)}\n`).join(""));
  console.log("Refreshed 6 CRM exports: search 70/4 rows, collection 24 rows; labels, BOM, formulas and links checked.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Export failed"); process.exitCode = 1; }).finally(disconnectDb);
