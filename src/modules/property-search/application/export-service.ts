import { businessLabel, exportDisplayLabel, exportDateLabel, exportCriterion } from "@/modules/export/application/business-labels";
import { tabularExport, formatExportDate, type ExportColumnType } from "@/modules/export/application/tabular-export";
export { escapeSpreadsheet, csvCell } from "@/modules/export/application/tabular-export";
import { z } from "zod";
import { db } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import { ConflictError, NotFoundError } from "@/shared/errors";
import type { Actor } from "@/modules/auth/domain/actor";
import { querySearchResults, resultQuerySchema } from "../queries/results-query";
import { jsonValue } from "./search-service";
import { groupsForExport } from "./duplicate-ingestion";

export const EXPORT_COLUMNS = { source: "Источник", url: "URL", publishedAt: "Дата публикации", datePrecision: "Точность даты", dateSource: "Источник даты", firstSeenAt: "Впервые найдено CRM", lastCheckedAt: "Проверено", purpose: "Тип / назначение", address: "Адрес", district: "Район", area: "Площадь, м²", floor: "Этаж", price: "Цена", priceUnit: "Единица цены", pricePerM2Rub: "Цена за м²", pricePerM2Unit: "Единица / период за м²", verdict: "Соответствие", unknown: "Неизвестные критерии", owner: "Проверка собственника", note: "Примечание риелтора", links: "Все ссылки группы дублей", photos: "Фото (первоисточник)" } as const;
type Column = keyof typeof EXPORT_COLUMNS;
export const exportInput = z.object({ format: z.enum(["csv", "xlsx"]).default("csv"), ids: z.array(zUuid).min(1).max(10000).optional(),
  columns: z.array(z.enum(Object.keys(EXPORT_COLUMNS) as [Column, ...Column[]])).min(1).max(22).refine(v => new Set(v).size === v.length).default(Object.keys(EXPORT_COLUMNS) as Column[]), query: resultQuerySchema.partial().optional() }).strict();
export async function exportSearch(actor: Actor, runId: string, raw: unknown) {
  const input = parseInput(exportInput, raw), ids = input.ids ? [...new Set(input.ids)] : undefined;
  // The table's page/revision belongs to its own page size; export starts a fresh stable selection.
  const { revision: _revision, ...selection } = input.query ?? {};
  void _revision;
  const query = { ...selection, page: 1, pageSize: 2000 };
  const first = await querySearchResults(actor, runId, query, ids, true);
  if (first.total > 10000) throw new ConflictError("EXPORT_LIMIT", "Не более 10000 строк. Уточните фильтры.");
  const rows = [...first.rows];
  for (let page = 2; rows.length < first.total; page++) {
    const next = await querySearchResults(actor, runId, { ...query, page, revision: first.revision }, ids, true);
    if (!next.rows.length) throw new ConflictError("SEARCH_RESULTS_CHANGED", "Выдача изменилась. Повторите экспорт.");
    rows.push(...next.rows);
  }
  if (ids && rows.length !== ids.length) throw new NotFoundError();
  const listingIds = rows.map(r => String(r.listingId));
  const [bookmarks, verifications, duplicates] = await Promise.all([
    db.searchBookmark.findMany({ where: { userId: actor.userId, listingId: { in: listingIds } } }),
    db.externalListingVerification.findMany({ where: { listingId: { in: listingIds } }, orderBy: [{ verifiedAt: "desc" }, { id: "asc" }] }),
    groupsForExport(actor, listingIds),
  ]);
  const values = rows.map(row => {
    const snap = (row.snapshot ?? {}) as Record<string, unknown>;
    const criteria = (Array.isArray(row.criteria) ? row.criteria : []) as { criterion: string; state: string }[];
    const verification = verifications.find(v => v.listingId === row.listingId);
    const record: Record<Column, unknown> = { source: exportDisplayLabel("external_source", row.source), url: snap.url ?? row.url, publishedAt: row.publishedAt ?? "Дата неизвестна", datePrecision: exportDateLabel("listingDatePrecision", row.datePrecision), dateSource: exportDateLabel("listingDateSource", row.dateSource), firstSeenAt: row.firstSeenAt, lastCheckedAt: row.lastCheckedAt,
      purpose: exportDisplayLabel("property_type", snap.purpose), address: snap.address, district: snap.district, area: snap.area, floor: (snap.floor as { raw?: string } | undefined)?.raw, price: snap.price, priceUnit: exportDisplayLabel("price_unit", snap.priceUnit), pricePerM2Rub: row.pricePerM2Rub, pricePerM2Unit: businessLabel("pricePerM2Unit", row.pricePerM2Unit), verdict: businessLabel("searchVerdict", row.verdict),
      unknown: criteria.filter(c => c.state === "unknown").map(c => exportCriterion(c.criterion)).join("; "), owner: verification?.ownerConfirmed === true ? `Проверка сотрудника ${formatExportDate(verification.verifiedAt)}` : "Не подтверждён",
      note: bookmarks.find(b => b.listingId === row.listingId)?.note, links: duplicates.find(d => d.members.some(m => m.listingId === row.listingId && !m.releasedAt))?.members.filter(m => !m.releasedAt).map(m => m.listing.url).join("\n") ?? row.url,
      photos: Array.isArray(snap.images) && snap.images.length ? snap.url : "" };
    return input.columns.map(c => record[c]);
  });
  const header = input.columns.map(c => EXPORT_COLUMNS[c]);
  const columnTypes = input.columns.map((column): ExportColumnType => ["publishedAt", "firstSeenAt", "lastCheckedAt"].includes(column) ? "date" : ["price", "pricePerM2Rub"].includes(column) ? "money" : column === "area" ? "number" : ["url", "photos"].includes(column) ? "url" : "text");
  const bytes = await tabularExport(input.format, header, values, "Результаты поиска", columnTypes);
  const log = await db.searchExport.create({ data: { userId: actor.userId, format: input.format, scope: ids ? "selected" : "all_filtered", params: jsonValue({ runId, query: input.query ?? {}, ids: ids ?? null, revision: first.revision }), columns: input.columns, rowCount: rows.length } });
  return { bytes, exportId: log.id, filename: `property-search.${input.format}`, contentType: input.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
