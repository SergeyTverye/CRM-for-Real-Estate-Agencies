import { Prisma } from "@/generated/prisma/client";
import { scalarSql } from "@/shared/db/dialect";
import { strToU8, zipSync } from "fflate";
import { db } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { ForbiddenError } from "@/shared/errors";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";

/**
 * UC-14 ExportData (FR-21, ТЗ 17.6): ZIP с CSV UTF-8 по согласованным сущностям + manifest.json.
 * UUID сохраняются. Доступно руководителю. Не включаются: хэши паролей, токены, storage key,
 * исторический архив (отдельный ограниченный контур) и содержимое файлов.
 * Экспорт не заменяет технический backup PostgreSQL и файлов.
 */

type Row = Record<string, unknown>;

function csvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object" && "toString" in (v as object) && (v as { constructor?: { name?: string } }).constructor?.name === "Decimal") s = String(v);
  else if (Array.isArray(v)) s = v.join("|");
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  // Защита от CSV-инъекций в табличных редакторах.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvValue(r[c])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const ENTITIES: { file: string; load: () => Promise<Row[]>; columns: string[] }[] = [
  { file: "users.csv", load: () => db.user.findMany({ select: { id: true, login: true, displayName: true, roleCode: true, isActive: true, createdAt: true } }), columns: ["id", "login", "displayName", "roleCode", "isActive", "createdAt"] },
  { file: "legal_entities.csv", load: () => db.legalEntity.findMany(), columns: ["id", "entityType", "displayName", "isActive"] },
  { file: "clients.csv", load: () => db.client.findMany(), columns: ["id", "displayName", "clientKind", "status", "responsibleUserId", "notes", "archivedAt", "createdBy", "createdAt", "updatedAt"] },
  { file: "client_contacts.csv", load: () => db.clientContact.findMany(), columns: ["id", "clientId", "contactType", "rawValue", "normalizedValue", "contactPersonId", "isPrimary", "comment", "createdAt"] },
  { file: "client_contact_persons.csv", load: () => db.clientContactPerson.findMany(), columns: ["id", "clientId", "fullName", "position", "isPrimary", "notes"] },
  { file: "lead_requests.csv", load: () => db.leadRequest.findMany(), columns: ["id", "clientId", "clientNeedId", "propertyId", "advertisementId", "responsibleUserId", "occurredAt", "channelCode", "sourceCode", "resultCode", "statusCode", "summary", "rawContact", "createdBy", "createdAt"] },
  {
    file: "client_needs.csv",
    load: () => db.clientNeed.findMany(),
    columns: ["id", "clientId", "responsibleUserId", "operationType", "propertyType", "propertySubtype", "financingType", "mortgageStatus", "budgetMin", "budgetMax", "district", "locationText", "areaMin", "areaMax", "stage", "status", "stopReasonCode", "stopComment", "openedAt", "closedAt"],
  },
  { file: "need_stage_history.csv", load: () => db.needStageHistory.findMany(), columns: ["id", "clientNeedId", "fromStage", "toStage", "fromStatus", "toStatus", "reasonCode", "comment", "changedBy", "occurredAt"] },
  {
    file: "properties.csv",
    load: () => db.property.findMany(),
    columns: ["id", "responsibleUserId", "propertyType", "propertySubtype", "operationType", "sourceType", "sourcePlatformCode", "sourceUrl", "addressText", "district", "area", "floor", "floorsTotal", "roomsCount", "landArea", "buildingArea", "price", "commercialPurpose", "powerKw", "parkingAvailable", "hasTenant", "status", "description", "archivedAt", "createdAt"],
  },
  { file: "property_owners.csv", load: () => db.propertyOwner.findMany(), columns: ["id", "propertyId", "clientId", "ownerRole", "ownershipShare", "comment"] },
  { file: "need_property_matches.csv", load: () => db.needPropertyMatch.findMany(), columns: ["id", "clientNeedId", "propertyId", "offeredAt", "sourceCode", "status", "rejectionReasonCode", "comment", "createdBy"] },
  { file: "communications.csv", load: () => db.communication.findMany(), columns: ["id", "clientId", "clientNeedId", "leadRequestId", "authorUserId", "communicationType", "channelCode", "occurredAt", "resultCode", "comment"] },
  { file: "showings.csv", load: () => db.showing.findMany(), columns: ["id", "clientNeedId", "propertyId", "responsibleUserId", "scheduledAt", "occurredAt", "status", "resultCode", "comment"] },
  {
    file: "tasks.csv",
    load: () => db.task.findMany(),
    columns: ["id", "responsibleUserId", "createdBy", "taskType", "taskSubtypeCode", "title", "description", "dueAt", "status", "priority", "recurrenceKind", "recurrenceInterval", "recurrenceUntil", "parentTaskId", "completedAt", "resultComment"],
  },
  { file: "advertisements.csv", load: () => db.advertisement.findMany(), columns: ["id", "propertyId", "responsibleUserId", "platformCode", "url", "adText", "status", "publishedAt", "lastCheckedAt", "expiresAt", "comment"] },
  {
    file: "agreements.csv",
    load: () => db.agreement.findMany(),
    columns: ["id", "clientId", "propertyId", "dealId", "responsibleUserId", "legalEntityId", "agreementType", "status", "agreementNumber", "isExclusive", "signedAt", "validFrom", "validUntil", "commissionType", "commissionValue", "absenceReasonCode", "actionRequired", "archivedAt"],
  },
  { file: "deals.csv", load: () => db.deal.findMany(), columns: ["id", "propertyId", "responsibleUserId", "legalEntityId", "status", "openedAt", "preliminaryAgreementAt", "mainAgreementAt", "registrationAt", "closedAt", "dealPrice", "notes"] },
  { file: "deal_parties.csv", load: () => db.dealParty.findMany(), columns: ["id", "dealId", "clientId", "externalPartyName", "partyRole", "comment"] },
  { file: "deal_commissions.csv", load: () => db.dealCommission.findMany(), columns: ["id", "dealId", "payerPartyId", "amount", "status", "dueAt", "receivedAt", "comment"] },
  { file: "commercial_offers.csv", load: () => db.commercialOffer.findMany(), columns: ["id", "clientNeedId", "responsibleUserId", "legalEntityId", "status", "title", "introText", "sentAt", "expiresAt", "createdAt"] },
  { file: "commercial_offer_items.csv", load: () => db.commercialOfferItem.findMany(), columns: ["id", "commercialOfferId", "propertyId", "position", "priceSnapshot", "addressSnapshot", "areaSnapshot", "termsSnapshot", "comment"] },
  { file: "documents.csv", load: () => db.document.findMany({ select: { id: true, originalName: true, documentTypeCode: true, mimeType: true, fileSize: true, checksum: true, uploadedBy: true, legalEntityId: true, archivedAt: true, createdAt: true } }), columns: ["id", "originalName", "documentTypeCode", "mimeType", "fileSize", "checksum", "uploadedBy", "legalEntityId", "archivedAt", "createdAt"] },
  { file: "dictionary_items.csv", load: () => db.dictionaryItem.findMany(), columns: ["id", "category", "code", "displayName", "isActive", "sortOrder"] },
];

export async function exportData(actor: Actor): Promise<{ fileName: string; data: Uint8Array }> {
  if (!isManager(actor)) throw new ForbiddenError("Экспорт доступен руководителю");
  const cfg = getConfig();
  const files: Record<string, Uint8Array> = {};
  const manifestFiles: { file: string; rows: number; columns: string[] }[] = [];
  for (const e of ENTITIES) {
    const rows = (await e.load()) as Row[];
    files[e.file] = strToU8(toCsv(rows, e.columns));
    manifestFiles.push({ file: e.file, rows: rows.length, columns: e.columns });
  }
  const migration = await db.$queryRaw<{ migration_name: string }[]>(scalarSql(Prisma.sql`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`));
  const exportedAt = new Date();
  const manifest = {
    format: "crm-export",
    formatVersion: 1,
    exportedAt: exportedAt.toISOString(),
    deploymentId: cfg.DEPLOYMENT_ID,
    appVersion: `${cfg.APP_VERSION}+${cfg.APP_COMMIT}`,
    schemaVersion: migration[0]?.migration_name ?? null,
    encoding: "UTF-8 (BOM), CSV RFC 4180, разделитель запятая",
    note: "Экспорт справочных данных не заменяет технический backup PostgreSQL и файлов. Исторический архив и содержимое файлов не включены.",
    files: manifestFiles,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const data = zipSync(files, { level: 6 });
  await writeAudit(db, { actorUserId: actor.userId, action: "data.exported", entityType: "Export", entityId: actor.userId, after: { files: manifestFiles.length, at: manifest.exportedAt } });
  const stamp = exportedAt.toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return { fileName: `crm-export-${stamp}.zip`, data };
}
