import ExcelJS from "exceljs";
import { z } from "zod";
import type { Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";
import { db } from "@/shared/db/client";
import { parseInput } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { csvCell, escapeSpreadsheet } from "@/modules/property-search/application/export-service";
import { getCollection } from "./collection-service";

export async function exportCollection(actor: Actor, id: string, raw: unknown) {
  const { format } = parseInput(z.object({ format: z.enum(["csv", "xlsx"]).default("csv") }), raw);
  const card = await getCollection(actor, id);
  const headers = ["Порядок", "Адрес", "Источник", "URL", "Площадь, м²", "Цена", "Единица цены", "Дата публикации", "Точность даты", "Впервые найдено CRM", "Проверено", "Доступность", "Статус", "Комментарий", "Причина исключения", "Назначение", "Район", "Этаж", "Цена за м²", "Единица / период за м²", "Источник даты"];
  const values = card.items.map((i, index) => {
    const l = i.externalListing, p = i.property;
    return [index + 1, l?.address ?? p?.addressText, l?.source ?? "CRM", l?.url ?? "", l?.areaM2 ?? p?.area, l?.priceRub ?? p?.price,
      l?.priceUnit ?? (p?.operationType === "rent" ? "per_month" : "total"), l?.publishedAt ?? "Дата неизвестна", l?.datePrecision ?? "unknown", l?.firstSeenAt, l?.lastCheckedAt,
      l?.verifications[0]?.availability ?? "unknown", labelOf("collectionItemStatus", i.status), i.comment, i.exclusionReason,
      l?.purposes.join("; ") ?? p?.commercialPurpose, l?.district ?? p?.district, l?.floorRaw ?? p?.floor, l?.pricePerM2Rub, l?.pricePerM2Unit, l?.dateSource ?? "unknown"].map(escapeSpreadsheet);
  });
  let bytes: Uint8Array;
  if (format === "csv") bytes = new TextEncoder().encode("\uFEFF" + [headers, ...values].map(row => row.map(csvCell).join(";")).join("\r\n"));
  else { const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Подборка"); sheet.addRow(headers); values.forEach(row => sheet.addRow(row)); sheet.views = [{ state: "frozen", ySplit: 1 }]; bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); }
  await writeAudit(db, { actorUserId: actor.userId, entityType: "PropertyCollection", entityId: id, action: "collection_exported", after: { format, rowCount: values.length } });
  return { bytes, filename: `collection.${format}`, contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
