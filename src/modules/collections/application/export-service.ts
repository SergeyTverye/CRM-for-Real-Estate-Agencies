import { z } from "zod";
import type { Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";
import { db } from "@/shared/db/client";
import { parseInput } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { tabularExport, type ExportColumnType } from "@/modules/export/application/tabular-export";
import { businessLabel, exportDisplayLabel, exportDateLabel } from "@/modules/export/application/business-labels";
import { getCollection } from "./collection-service";

export async function exportCollection(actor: Actor, id: string, raw: unknown) {
  const { format } = parseInput(z.object({ format: z.enum(["csv", "xlsx"]).default("csv") }), raw);
  const card = await getCollection(actor, id);
  const headers = ["Порядок", "Адрес", "Источник", "URL", "Площадь, м²", "Цена", "Единица цены", "Дата публикации", "Точность даты", "Впервые найдено CRM", "Проверено", "Доступность", "Статус", "Комментарий", "Причина исключения", "Назначение", "Район", "Этаж", "Цена за м²", "Единица / период за м²", "Источник даты"];
  const values = card.items.map((i, index) => {
    const l = i.externalListing, p = i.property;
    return [index + 1, l?.address ?? p?.addressText, exportDisplayLabel("external_source", l?.source ?? "CRM"), l?.url ?? "", l?.areaM2 ?? p?.area, l?.priceRub ?? p?.price,
      exportDisplayLabel("price_unit", l?.priceUnit ?? (p?.operationType === "rent" ? "per_month" : "total")), l?.publishedAt ?? "Дата неизвестна", exportDateLabel("listingDatePrecision", l?.datePrecision), l?.firstSeenAt, l?.lastCheckedAt,
      businessLabel("listingAvailability", l?.verifications[0]?.availability ?? "unknown"), labelOf("collectionItemStatus", i.status), i.comment, i.exclusionReason,
      l ? l.purposes.map(purpose => exportDisplayLabel("property_type", purpose)).join("; ") : exportDisplayLabel("property_type", p?.commercialPurpose), l?.district ?? p?.district, l?.floorRaw ?? p?.floor, l?.pricePerM2Rub, businessLabel("pricePerM2Unit", l?.pricePerM2Unit), exportDateLabel("listingDateSource", l?.dateSource)];
  });
  const types: ExportColumnType[] = ["text", "text", "text", "url", "number", "money", "text", "date", "text", "date", "date", "text", "text", "text", "text", "text", "text", "text", "money", "text", "text"];
  const bytes = await tabularExport(format, headers, values, "Подборка", types);
  await writeAudit(db, { actorUserId: actor.userId, entityType: "PropertyCollection", entityId: id, action: "collection_exported", after: { format, rowCount: values.length } });
  return { bytes, filename: `collection.${format}`, contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
