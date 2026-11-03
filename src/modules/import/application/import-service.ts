import { z } from "zod";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, transaction, type Tx } from "@/shared/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/shared/config/env";
import { logger } from "@/shared/logging/logger";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { assertRecordId, parseInput, skipTake, zPagination, zUuid } from "@/shared/validation";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";
import { insertTask } from "@/modules/tasks/application/task-service";
import { assertNeedInvariants } from "@/modules/needs/domain/need-invariant";
import { loadProfiles, mappingVersion, WORKBOOK_PROFILE_CODE, type ImportProfile } from "../domain/profiles";
import { detectSections, parseSectionRows, sha256, withWarning, type DetectedSection, type ParsedRow, type SheetData } from "../domain/workbook-parser";
import { normalizeAddress } from "../domain/normalize";
import { readWorkbook } from "../infrastructure/xlsx-reader";

/**
 * UC-09 ImportDataset (FR-20, FR-35, ТЗ 28, 29.15, 37.14, 38).
 * upload → dry-run (parse → normalize → policy filter → validate → duplicates → mapping) → commit по секциям.
 * Dry-run не изменяет операционные таблицы: пишутся только import_jobs/import_row_results.
 * Исходный файл хранится во временном каталоге IMPORT_STAGING_PATH (вне backup) до завершения задания.
 * Для каждой обработанной при commit строки фиксируется commit_result; rows_read = imported + skipped + error.
 */

function requireManager(actor: Actor) {
  if (!isManager(actor)) throw new ForbiddenError("Импорт доступен только руководителю");
}

function stagingPath(jobId: string): string {
  return path.join(path.resolve(getConfig().IMPORT_STAGING_PATH), `${jobId}.xlsx`);
}

interface SectionSummary {
  sectionKey: string;
  profileCode: string | null;
  title: string | null;
  candidateProfiles: string[];
  sheetName: string;
  markerRow: number;
  markerText: string;
  headerRow: number | null;
  rowRange: [number, number];
  status: "recognized" | "unrecognized";
  mapping: { header: string; field: string }[];
  excludedByPolicy: string[];
  unresolvedFields: string[];
  unknownFields: string[];
  counts: Record<string, number>;
  committed: boolean;
}

interface Parsed {
  sheets: SheetData[];
  sections: DetectedSection[];
  rows: ParsedRow[];
  profiles: ImportProfile[];
}

async function parseFile(data: Buffer, fileSha: string): Promise<Parsed> {
  const profiles = loadProfiles();
  const sheets = await readWorkbook(data);
  const sections = detectSections(sheets, profiles);
  const rows = sections.flatMap((s) =>
    parseSectionRows(
      sheets.find((sh) => sh.name === s.sheetName)!,
      s,
      profiles.find((p) => p.code === s.profileCode) ?? null,
      fileSha,
    ),
  );
  return { sheets, sections, rows, profiles };
}

/** Поиск вероятных дублей без изменения данных (ТЗ 38.8). */
async function markDuplicates(rows: ParsedRow[]): Promise<ParsedRow[]> {
  const phones = [...new Set(rows.flatMap((r) => [...r.dedupe.phones, ...r.dedupe.emails]))];
  const existingContacts = phones.length
    ? new Set((await db.clientContact.findMany({ where: { normalizedValue: { in: phones } }, select: { normalizedValue: true } })).map((c) => c.normalizedValue!))
    : new Set<string>();
  const archiveKeys = rows.map((r) => r.dedupe.archiveKey).filter(Boolean) as string[];
  const existingArchive = archiveKeys.length
    ? new Set((await db.historicalDealArchive.findMany({ where: { sourceRowKey: { in: archiveKeys } }, select: { sourceRowKey: true } })).map((a) => a.sourceRowKey))
    : new Set<string>();
  const existingAddresses = new Set((await db.property.findMany({ select: { addressText: true } })).map((p) => normalizeAddress(p.addressText)));
  const prevImported = new Set(
    (
      await db.importRowResult.findMany({
        where: { sourceRecordKey: { in: rows.map((r) => r.recordKey) }, commitResult: "imported" },
        select: { sourceRecordKey: true },
      })
    ).map((r) => r.sourceRecordKey!),
  );

  const seenPhones = new Set<string>();
  const seenAddresses = new Set<string>();
  const seenArchive = new Set<string>();
  return rows.map((r0) => {
    let r = r0;
    if (r.validationStatus === "unrecognized" || r.validationStatus === "skipped_policy") return r;
    if (prevImported.has(r.recordKey)) r = withWarning(r, "already_imported");
    if (r.target === "client_request_need" || r.target === "property") {
      for (const v of [...r.dedupe.phones, ...r.dedupe.emails]) {
        if (existingContacts.has(v) || seenPhones.has(v)) r = withWarning(r, "probable_duplicate");
        seenPhones.add(v);
      }
    }
    const addressKey = r.dedupe.addressKey;
    if (r.target === "property" && addressKey) {
      if (existingAddresses.has(addressKey) || seenAddresses.has(addressKey)) r = withWarning(r, "probable_duplicate");
      seenAddresses.add(addressKey);
    }
    const archiveKey = r.dedupe.archiveKey;
    if (r.target === "historical_deal_archive" && archiveKey) {
      if (existingArchive.has(archiveKey)) r = withWarning(r, "already_imported");
      else if (seenArchive.has(archiveKey)) r = withWarning(r, "probable_duplicate");
      seenArchive.add(archiveKey);
    }
    return r;
  });
}

function summarize(sections: DetectedSection[], rows: ParsedRow[], profiles: ImportProfile[]): SectionSummary[] {
  return sections.map((s) => {
    const sr = rows.filter((r) => r.sectionKey === s.sectionKey);
    const counts: Record<string, number> = { total: sr.length };
    for (const r of sr) counts[r.validationStatus] = (counts[r.validationStatus] ?? 0) + 1;
    counts.probable_duplicate = sr.filter((r) => r.warningCodes.includes("probable_duplicate")).length;
    return {
      sectionKey: s.sectionKey,
      profileCode: s.profileCode,
      title: profiles.find((p) => p.code === s.profileCode)?.title ?? null,
      candidateProfiles: s.candidateProfiles,
      sheetName: s.sheetName,
      markerRow: s.markerRow,
      markerText: s.markerText,
      headerRow: s.headerRow,
      rowRange: [s.firstDataRow, s.lastRow],
      status: s.status,
      mapping: s.columns.map((c) => ({ header: c.header, field: c.field })),
      excludedByPolicy: s.excludedColumns.map((c) => c.header),
      unresolvedFields: s.unresolvedColumns.map((c) => c.header),
      unknownFields: s.unknownColumns.map((c) => c.header),
      counts,
      committed: false,
    };
  });
}

/** Загрузка файла и dry-run. Операционные таблицы не изменяются. */
export async function uploadImport(actor: Actor, file: File | null): Promise<{ id: string }> {
  requireManager(actor);
  if (!file || typeof file === "string") throw new ValidationError("Выберите файл", { file: ["Файл не передан"] });
  const name = (file.name || "import.xlsx").replace(/[\\/]/g, "_").slice(0, 200);
  if (!/\.xlsx$/i.test(name)) throw new ValidationError("Поддерживается формат .xlsx", { file: ["Ожидается файл Excel .xlsx"] });
  const cfg = getConfig();
  if (file.size > cfg.maxUploadBytes) throw new ValidationError(undefined, { file: [`Файл больше ${cfg.MAX_UPLOAD_MB} МБ`] });
  const data = Buffer.from(await file.arrayBuffer());
  const fileSha = sha256(data);
  const running = await db.importJob.count({ where: { status: { in: ["parsing", "committing"] } } });
  if (running) throw new ConflictError("IMPORT_RUNNING", "Другой импорт ещё выполняется — дождитесь завершения");
  const profiles = loadProfiles();
  const job = await db.importJob.create({
    data: {
      sourceFilename: name,
      sourceSha256: fileSha,
      sourceFormat: "xlsx",
      profileCode: WORKBOOK_PROFILE_CODE,
      status: "uploaded",
      startedBy: actor.userId,
      mappingVersion: mappingVersion(profiles),
    },
    select: { id: true },
  });
  const staged = stagingPath(job.id);
  await mkdir(path.dirname(staged), { recursive: true });
  await writeFile(staged, data, { mode: 0o600 });
  await db.importJob.update({ where: { id: job.id }, data: { status: "parsing", sourceStorageKey: path.basename(staged) } });
  try {
    const parsed = await parseFile(data, fileSha);
    const rows = await markDuplicates(parsed.rows);
    const summary = summarize(parsed.sections, rows, parsed.profiles);
    await db.$transaction(async (tx) => {
      await tx.importRowResult.createMany({
        data: rows.map((r) => ({
          importJobId: job.id,
          sheetName: r.sheetName,
          sourceSection: r.profileCode ?? `unrecognized:${r.sectionKey}`,
          sourceRowNumber: r.rowNumber,
          sourceRecordKey: r.recordKey,
          targetEntityType: r.target,
          validationStatus: r.validationStatus,
          errorCodes: r.errorCodes,
          warningCodes: r.warningCodes,
        })),
      });
      const recognized = summary.some((s) => s.status === "recognized");
      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: recognized ? "dry_run_ready" : "dry_run_failed",
          probableDuplicates: rows.filter((r) => r.warningCodes.includes("probable_duplicate")).length,
          summaryJsonb: { sections: summary } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    logger.info({ event: "import.dry_run", jobId: job.id, rows: rows.length }, "import dry-run done");
  } catch (e) {
    logger.error({ err: e, jobId: job.id }, "import dry-run failed");
    await db.importJob.update({ where: { id: job.id }, data: { status: "dry_run_failed", finishedAt: new Date() } });
    await rm(staged, { force: true });
    throw new ValidationError("Не удалось разобрать файл: проверьте, что это корректный .xlsx");
  }
  return job;
}

// ───── Просмотр ─────

export async function listImportJobs(actor: Actor) {
  requireManager(actor);
  return db.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { starter: { select: { displayName: true } } } });
}

const rowsFilterSchema = zPagination.extend({
  validationStatus: z.enum(["ready", "warning", "skipped_policy", "invalid", "unrecognized"]).optional(),
  commitResult: z.enum(["imported", "skipped", "error"]).optional(),
  section: z.string().max(100).optional(),
  problemsOnly: z.enum(["yes"]).optional(),
});

/** Безопасные исходные признаки проблемных строк для отчёта (без исключённых политикой полей). */
async function previewFor(jobId: string, sha: string, rowKeys: Set<string>): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  let data: Buffer;
  try {
    data = await readFile(stagingPath(jobId));
  } catch {
    return out;
  }
  if (sha256(data) !== sha) return out;
  const parsed = await parseFile(data, sha);
  for (const r of parsed.rows) if (rowKeys.has(r.recordKey)) out.set(r.recordKey, r.record);
  return out;
}

export async function getImportJob(actor: Actor, id: string, raw: unknown = {}) {
  assertRecordId(id);
  requireManager(actor);
  const f = parseInput(rowsFilterSchema, raw);
  const job = await db.importJob.findUnique({ where: { id }, include: { starter: { select: { displayName: true } } } });
  if (!job) throw new NotFoundError();
  const and: Prisma.ImportRowResultWhereInput[] = [{ importJobId: id }];
  if (f.validationStatus) and.push({ validationStatus: f.validationStatus });
  if (f.commitResult) and.push({ commitResult: f.commitResult });
  if (f.section) and.push({ sourceSection: f.section });
  if (f.problemsOnly) and.push({ OR: [{ validationStatus: { in: ["warning", "invalid", "unrecognized", "skipped_policy"] } }, { commitResult: "error" }] });
  const where: Prisma.ImportRowResultWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    db.importRowResult.findMany({ where, orderBy: [{ sheetName: "asc" }, { sourceRowNumber: "asc" }], ...skipTake(f) }),
    db.importRowResult.count({ where }),
  ]);
  const previews = await previewFor(id, job.sourceSha256, new Set(rows.map((r) => r.sourceRecordKey!).filter(Boolean)));
  const sections = ((job.summaryJsonb as { sections?: SectionSummary[] } | null)?.sections ?? []) as SectionSummary[];
  return {
    job,
    sections,
    rows: rows.map((r) => ({ ...r, preview: r.sourceRecordKey ? (previews.get(r.sourceRecordKey) ?? null) : null })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

// ───── Commit ─────

const commitSchema = z.object({
  sections: z.array(z.string().min(1)).min(1, "Выберите секции для загрузки"),
  options: z
    .object({
      coordinatesAsPhone: z.boolean().default(false),
      createTasksFromFixNotes: z.boolean().default(false),
      defaultResponsibleUserId: zUuid.optional(),
    })
    .default({ coordinatesAsPhone: false, createTasksFromFixNotes: false }),
});

type CommitOptions = z.output<typeof commitSchema>["options"] & { responsibleUserId: string; jobId: string; sourceFilename: string; actorId: string };

const PLATFORM_TEXT: [RegExp, string][] = [
  [/авито/i, "avito"],
  [/циан/i, "cian"],
  [/домклик/i, "domclick"],
  [/яндекс/i, "yandex_realty"],
];
const platformOf = (s: unknown) => PLATFORM_TEXT.find(([re]) => re.test(String(s ?? "")))?.[1] ?? "other";

async function findPropertyByAddress(tx: Tx, addressKey: string): Promise<string | null> {
  const candidates = await tx.property.findMany({ select: { id: true, addressText: true }, orderBy: { createdAt: "asc" } });
  return candidates.find((p) => normalizeAddress(p.addressText) === addressKey)?.id ?? null;
}

async function createPropertyFromRow(tx: Tx, rec: Record<string, unknown>, o: CommitOptions): Promise<string> {
  const p = await tx.property.create({
    data: {
      propertyType: String(rec.propertyType),
      operationType: String(rec.operationType),
      sourceType: String(rec.sourceType ?? "agency_listing"),
      sourcePlatformCode: rec.sourceType === "external_market" ? platformOf(rec.adPlatformText) : null,
      sourceUrl: (rec.sourceUrl as string | null) ?? null,
      addressText: String(rec.addressText),
      district: (rec.district as string | null) ?? null,
      area: (rec.area as string | null) ?? null,
      price: (rec.price as string | null) ?? null,
      floor: (rec.floor as number | null) ?? null,
      floorsTotal: (rec.floorsTotal as number | null) ?? null,
      roomsCount: (rec.roomsCount as number | null) ?? null,
      description: (rec.description as string | null) ?? null,
      attributesJsonb: rec.extraAttributes && Object.keys(rec.extraAttributes as object).length ? (rec.extraAttributes as Prisma.InputJsonValue) : undefined,
      status: "active",
      responsibleUserId: rec.sourceType === "external_market" ? null : o.responsibleUserId,
      createdBy: o.actorId,
    },
    select: { id: true },
  });
  return p.id;
}

/** Создание сущностей по одной строке (в собственной транзакции). Возвращает целевую сущность. */
async function commitRow(tx: Tx, row: ParsedRow, o: CommitOptions): Promise<{ type: string; id: string } | { skipped: string }> {
  const rec = row.record;
  switch (row.target) {
    case "historical_deal_archive": {
      const key = row.dedupe.archiveKey!;
      if (await tx.historicalDealArchive.findUnique({ where: { sourceRowKey: key } })) return { skipped: "already_imported" };
      // Надёжная связь с Client — только по единственному совпадению телефона (не по ФИО).
      let clientId: string | null = null;
      if (rec.contactPhone) {
        const matches = await tx.clientContact.findMany({ where: { normalizedValue: String(rec.contactPhone) }, select: { clientId: true }, distinct: ["clientId"], take: 2 });
        if (matches.length === 1) clientId = matches[0]!.clientId;
      }
      const a = await tx.historicalDealArchive.create({
        data: {
          sourceFile: o.sourceFilename,
          sourceRowId: (rec.sourceRowId as string | null) ?? String(row.rowNumber),
          sourceRowKey: key,
          dealDate: (rec.dealDate as Date | null) ?? null,
          dealDateText: (rec.dealDateText as string | null) ?? null,
          participantName: (rec.participantName as string | null) ?? null,
          contactPhone: (rec.contactPhone as string | null) ?? null,
          contactEmail: (rec.contactEmail as string | null) ?? null,
          propertyType: (rec.propertyType as string | null) ?? null,
          objectText: (rec.objectText as string | null) ?? null,
          partyRole: (rec.partyRole as string | null) ?? null,
          area: (rec.area as string | null) ?? null,
          price: (rec.price as string | null) ?? null,
          conditions: (rec.conditions as string | null) ?? null,
          realtorText: (rec.realtorText as string | null) ?? null,
          contractRef: (rec.contractRef as string | null) ?? null,
          commissionAmount: (rec.commissionAmount as string | null) ?? null,
          additionalInfo: (rec.additionalInfo as string | null) ?? null,
          clientId,
          importJobId: o.jobId,
        },
        select: { id: true },
      });
      return { type: "HistoricalDealArchive", id: a.id };
    }
    case "property": {
      if (row.warningCodes.includes("probable_duplicate")) return { skipped: "probable_duplicate" };
      const propertyId = await createPropertyFromRow(tx, rec, o);
      if (rec.adUrl) {
        await tx.advertisement.create({
          data: { propertyId, platformCode: platformOf(rec.adPlatformText ?? rec.adUrl), url: String(rec.adUrl), adText: (rec.adText as string | null) ?? null, status: "active", responsibleUserId: o.responsibleUserId, lastCheckedAt: null },
        });
      }
      const owner = rec.owner as { name: string; phone: string } | null;
      if (owner) {
        const existing = await tx.clientContact.findMany({ where: { normalizedValue: owner.phone }, select: { clientId: true }, distinct: ["clientId"], take: 2 });
        let ownerClientId = existing.length === 1 ? existing[0]!.clientId : null;
        if (!ownerClientId && existing.length === 0) {
          const c = await tx.client.create({ data: { displayName: owner.name, clientKind: "person", status: "active", responsibleUserId: o.responsibleUserId, createdBy: o.actorId }, select: { id: true } });
          await tx.clientContact.create({ data: { clientId: c.id, contactType: "phone", rawValue: owner.phone, normalizedValue: owner.phone, isPrimary: true } });
          ownerClientId = c.id;
        }
        if (ownerClientId) await tx.propertyOwner.create({ data: { propertyId, clientId: ownerClientId, ownerRole: "собственник (импорт)" } });
      }
      return { type: "Property", id: propertyId };
    }
    case "client_request_need": {
      if (row.warningCodes.includes("probable_duplicate")) return { skipped: "probable_duplicate" };
      const client = await tx.client.create({
        data: { displayName: String(rec.name), clientKind: "person", status: "active", responsibleUserId: o.responsibleUserId, createdBy: o.actorId, notes: (rec.comment as string | null) ?? null },
        select: { id: true },
      });
      if (o.coordinatesAsPhone && rec.coordinatesNormalized && (rec.coordinatesKind === "phone" || rec.coordinatesKind === "email")) {
        await tx.clientContact.create({
          data: { clientId: client.id, contactType: String(rec.coordinatesKind), rawValue: String(rec.coordinatesRaw), normalizedValue: String(rec.coordinatesNormalized), isPrimary: true },
        });
      }
      const occurredAt = (rec.receivedAt as Date | null) ?? (rec.lastActivityAt as Date | null) ?? new Date();
      let needId: string | null = null;
      if (rec.operationType) {
        const status = String(rec.needStatus ?? "active");
        const closedAt = status === "closed" || status === "success" ? ((rec.lastActivityAt as Date | null) ?? new Date()) : null;
        const need = await tx.clientNeed.create({
          data: {
            clientId: client.id,
            responsibleUserId: o.responsibleUserId,
            operationType: String(rec.operationType),
            propertyType: String(rec.propertyType),
            stage: "new",
            status,
            stopReasonCode: status === "closed" ? "no_longer_relevant" : null,
            closedAt,
            notes: (rec.comment as string | null) ?? null,
            openedAt: occurredAt,
            createdBy: o.actorId,
          },
          select: { id: true },
        });
        needId = need.id;
        await tx.needStageHistory.create({ data: { clientNeedId: need.id, toStage: "new", toStatus: status, reasonCode: "imported", changedBy: o.actorId } });
        if (status === "active" || status === "paused") {
          const due = new Date(Date.now() + 86_400_000);
          due.setUTCHours(7, 0, 0, 0);
          await insertTask(
            tx,
            o.actorId,
            { title: status === "paused" ? "Вернуться к запросу клиента (импорт)" : "Актуализировать запрос клиента (импорт)", taskType: "call_or_contact", dueAt: due, responsibleUserId: o.responsibleUserId },
            { needIds: [need.id], clientIds: [client.id] },
          );
        }
        await assertNeedInvariants(tx, [need.id]);
      }
      await tx.leadRequest.create({
        data: {
          clientId: client.id,
          clientNeedId: needId,
          responsibleUserId: o.responsibleUserId,
          occurredAt,
          channelCode: String(rec.channelCode),
          sourceCode: String(rec.sourceCode),
          resultCode: needId ? "new_need" : "no_followup",
          statusCode: needId ? "processed" : "closed",
          summary: (rec.comment as string | null) ?? "Импорт из клиентской базы",
          rawContact: (rec.coordinatesRaw as string | null) ?? null,
          createdBy: o.actorId,
        },
      });
      return { type: "Client", id: client.id };
    }
    case "property_agreement_control": {
      const addressKey = row.dedupe.addressKey!;
      const propertyId = (await findPropertyByAddress(tx, addressKey)) ?? (await createPropertyFromRow(tx, rec, o));
      if (rec.adUrl && !(await tx.advertisement.count({ where: { propertyId, url: String(rec.adUrl) } }))) {
        await tx.advertisement.create({ data: { propertyId, platformCode: platformOf(rec.adUrl), url: String(rec.adUrl), adText: (rec.adText as string | null) ?? null, status: "active", responsibleUserId: o.responsibleUserId } });
      }
      let agreementId: string | null = null;
      if (rec.agreementPresent !== null) {
        const commission = [rec.commissionFrom, rec.commissionTo].some(Boolean) ? `Комиссия: от ${rec.commissionFrom ?? "—"} до ${rec.commissionTo ?? "—"}` : null;
        const a = await tx.agreement.create({
          data: {
            propertyId,
            responsibleUserId: o.responsibleUserId,
            agreementType: "information",
            // Наличие договора без даты подписания: фиксируется черновиком с требуемым действием (signed требует signed_at).
            status: rec.agreementPresent ? "draft" : "no_agreement",
            absenceReasonCode: rec.agreementPresent ? null : "other",
            actionRequired: (rec.fixNote as string | null) ?? (rec.agreementPresent ? "Уточнить дату подписания и реквизиты договора (импорт)" : null),
            commissionNotes: commission,
            notes: rec.agreementPresent ? "Импорт: договор отмечен как имеющийся" : `Причина отсутствия: ${(rec.absenceReason as string | null) ?? "не указана"}`,
          },
          select: { id: true },
        });
        agreementId = a.id;
      }
      if (o.createTasksFromFixNotes && rec.fixNote) {
        await insertTask(
          tx,
          o.actorId,
          { title: String(rec.fixNote).slice(0, 300), taskType: "contract_check", dueAt: new Date(Date.now() + 3 * 86_400_000), responsibleUserId: o.responsibleUserId },
          { propertyIds: [propertyId], ...(agreementId ? { agreementIds: [agreementId] } : {}) },
        );
      }
      return { type: "Property", id: propertyId };
    }
    default:
      return { skipped: "unrecognized" };
  }
}

export async function commitImport(actor: Actor, id: string, input: unknown) {
  requireManager(actor);
  const d = parseInput(commitSchema, input);
  const job = await db.importJob.findUnique({ where: { id } });
  if (!job) throw new NotFoundError();
  if (job.status !== "dry_run_ready") throw new DomainError("IMPORT_NOT_READY", "Загрузка возможна только после успешной проверки (dry-run)");
  let responsibleUserId = actor.userId;
  if (d.options.defaultResponsibleUserId) {
    const u = await db.user.findUnique({ where: { id: d.options.defaultResponsibleUserId }, select: { isActive: true } });
    if (!u?.isActive) throw new ValidationError(undefined, { "options.defaultResponsibleUserId": ["Сотрудник не найден"] });
    responsibleUserId = d.options.defaultResponsibleUserId;
  }
  const sections = ((job.summaryJsonb as { sections?: SectionSummary[] } | null)?.sections ?? []) as SectionSummary[];
  const selected = sections.filter((s) => d.sections.includes(s.sectionKey));
  if (selected.length !== d.sections.length) throw new ValidationError(undefined, { sections: ["Неизвестная секция"] });
  if (selected.some((s) => s.status !== "recognized")) throw new ValidationError("Нераспознанные секции не импортируются автоматически", { sections: ["Секция требует настройки mapping"] });
  if (selected.some((s) => s.committed)) throw new ValidationError(undefined, { sections: ["Секция уже загружена"] });

  // Защита от параллельного запуска.
  const lock = await db.importJob.updateMany({ where: { id, status: "dry_run_ready" }, data: { status: "committing" } });
  if (lock.count === 0) throw new ConflictError("IMPORT_RUNNING", "Импорт уже выполняется");

  let data: Buffer;
  try {
    data = await readFile(stagingPath(id));
  } catch {
    await db.importJob.update({ where: { id }, data: { status: "failed", finishedAt: new Date() } });
    throw new DomainError("STAGED_FILE_MISSING", "Исходный файл задания недоступен — загрузите файл заново");
  }
  if (sha256(data) !== job.sourceSha256) {
    await db.importJob.update({ where: { id }, data: { status: "failed", finishedAt: new Date() } });
    throw new DomainError("STAGED_FILE_CHANGED", "Исходный файл изменён после проверки");
  }
  const parsed = await parseFile(data, job.sourceSha256);
  const rows = await markDuplicates(parsed.rows);
  const selectedKeys = new Set(selected.map((s) => s.sectionKey));
  const toProcess = rows.filter((r) => selectedKeys.has(r.sectionKey));
  const opts: CommitOptions = { ...d.options, responsibleUserId, jobId: id, sourceFilename: job.sourceFilename, actorId: actor.userId };

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of toProcess) {
    let result: "imported" | "skipped" | "error";
    let targetEntityType: string | null = null;
    let targetEntityId: string | null = null;
    const extraWarnings: string[] = [];
    const extraErrors: string[] = [];
    if (row.validationStatus === "invalid" || row.validationStatus === "unrecognized" || row.validationStatus === "skipped_policy") {
      result = "skipped";
    } else if (row.warningCodes.includes("already_imported")) {
      result = "skipped";
    } else {
      try {
        const r = await transaction((tx) => commitRow(tx, row, opts));
        if ("skipped" in r) {
          result = "skipped";
          extraWarnings.push(r.skipped);
        } else {
          result = "imported";
          targetEntityType = r.type;
          targetEntityId = r.id;
        }
      } catch (e) {
        result = "error";
        extraErrors.push((e as { code?: string }).code ?? "commit_failed");
        logger.warn({ event: "import.row_error", jobId: id, row: row.rowNumber, sheet: row.sheetName, code: (e as { code?: string }).code }, "import row failed");
      }
    }
    if (result === "imported") imported++;
    else if (result === "skipped") skipped++;
    else errors++;
    await db.importRowResult.updateMany({
      where: { importJobId: id, sourceRecordKey: row.recordKey },
      data: {
        commitResult: result,
        targetEntityType: targetEntityType ?? row.target,
        targetEntityId,
        ...(extraWarnings.length ? { warningCodes: { push: extraWarnings } } : {}),
        ...(extraErrors.length ? { errorCodes: { push: extraErrors } } : {}),
      },
    });
  }

  const updatedSections = sections.map((s) => (selectedKeys.has(s.sectionKey) ? { ...s, committed: true } : s));
  const allDone = updatedSections.filter((s) => s.status === "recognized").every((s) => s.committed);
  const totals = await db.importJob.update({
    where: { id },
    data: {
      rowsRead: { increment: toProcess.length },
      rowsImported: { increment: imported },
      rowsSkipped: { increment: skipped },
      rowsError: { increment: errors },
      summaryJsonb: { sections: updatedSections } as unknown as Prisma.InputJsonValue,
    },
  });
  const finalStatus = allDone ? (totals.rowsError > 0 ? "completed_with_errors" : "completed") : "dry_run_ready";
  await db.importJob.update({ where: { id }, data: { status: finalStatus, ...(allDone ? { finishedAt: new Date() } : {}) } });
  if (allDone) await rm(stagingPath(id), { force: true });
  await writeAudit(db, {
    actorUserId: actor.userId,
    action: "import.committed",
    entityType: "ImportJob",
    entityId: id,
    after: { sections: [...selectedKeys], rowsRead: toProcess.length, imported, skipped, errors },
  });
  // Контрольное равенство commit-набора (ТЗ 28): rows_read = imported + skipped + error.
  return { id, status: finalStatus, rowsRead: toProcess.length, rowsImported: imported, rowsSkipped: skipped, rowsError: errors };
}

export async function cancelImport(actor: Actor, id: string): Promise<void> {
  requireManager(actor);
  const job = await db.importJob.findUnique({ where: { id } });
  if (!job) throw new NotFoundError();
  if (!["uploaded", "dry_run_ready", "dry_run_failed"].includes(job.status)) throw new DomainError("IMPORT_NOT_CANCELLABLE", "Задание нельзя отменить в текущем состоянии");
  await db.importJob.update({ where: { id }, data: { status: "cancelled", finishedAt: new Date() } });
  await rm(stagingPath(id), { force: true });
}
