import { z } from 'zod';
import { db, transaction, type Tx } from '@/shared/db/client';
import type { Prisma } from '@/generated/prisma/client';
import { isManager, type Actor } from '@/modules/auth/domain/actor';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/shared/errors';
import { getStorage } from '@/shared/storage/storage-adapter';
import { parseInput } from '@/shared/validation';
import { getConfig } from '@/shared/config/env';
import { writeAudit } from '@/modules/audit/application/audit';
import { commitRow } from './import-service';
import { buildProfile, enterpriseProfileSchema, loadEnterprise, parseEnterprise, text, type EnterpriseProfile, type EnterpriseRow } from '../domain/enterprise-workbook';
import { normalizeAddress } from '../domain/normalize';
import { sha256 } from '../domain/workbook-parser';
function manager(actor: Actor) { if (!isManager(actor))
    throw new ForbiddenError('Импорт рабочей книги доступен руководителю'); }
type Summary = {
    profile: EnterpriseProfile;
    unresolved: {
        sheet: number;
        row: number;
        column: number;
    }[];
    counts: Record<string, number>;
    checksumRepeated: boolean;
    exportDates?: Record<string, string>;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function readSource(key: string) { const { stream } = await getStorage().read(key); const parts: Buffer[] = []; for await (const part of stream)
    parts.push(Buffer.from(part)); return Buffer.concat(parts); }
async function source(job: {
    sourceStorageKey: string | null;
    sourceSha256: string;
}) { if (!job.sourceStorageKey)
    throw new ValidationError('SOURCE_MISSING'); const data = await readSource(job.sourceStorageKey); if (sha256(data) !== job.sourceSha256)
    throw new ValidationError('SOURCE_CHANGED'); return loadEnterprise(data); }
function countRows(rows: EnterpriseRow[]) { const counts: Record<string, number> = { total: rows.length }; for (const row of rows)
    counts[row.validationStatus] = (counts[row.validationStatus] ?? 0) + 1; return counts; }
async function duplicates(tx: Tx, rows: EnterpriseRow[]) {
    const previous = new Set((await tx.importRowResult.findMany({ where: { sourceRecordKey: { in: rows.map(r => r.recordKey) }, commitResult: 'imported' }, select: { sourceRecordKey: true } })).map(r => r.sourceRecordKey));
    const props = await tx.property.findMany({ select: { addressText: true, area: true, operationType: true } });
    const propertyKeys = new Set(props.map(p => JSON.stringify([normalizeAddress(p.addressText), p.area?.toString() ?? null, p.operationType])));
    const contacts = new Set((await tx.clientContact.findMany({ where: { normalizedValue: { in: rows.flatMap(r => [...r.dedupe.phones, ...r.dedupe.emails]) } }, select: { normalizedValue: true } })).map(c => c.normalizedValue));
    const seen = new Set<string>();
    for (const r of rows) {
        if (['invalid', 'skipped_policy'].includes(r.validationStatus))
            continue;
        const pk = JSON.stringify([r.dedupe.addressKey, r.record.area, r.record.operationType]);
        const contactKeys = [...r.dedupe.phones, ...r.dedupe.emails];
        if (previous.has(r.recordKey) || seen.has(r.recordKey))
            r.warningCodes.push('already_imported');
        else if ((r.target === 'property' && propertyKeys.has(pk)) || contactKeys.some(c => contacts.has(c)))
            r.warningCodes.push('probable_duplicate');
        seen.add(r.recordKey);
        if (r.target === 'property')
            propertyKeys.add(pk);
        for (const c of contactKeys)
            contacts.add(c);
        if (r.warningCodes.length && r.validationStatus === 'ready')
            r.validationStatus = 'warning';
    }
    return rows;
}
export async function uploadEnterprise(actor: Actor, file: File, rawProfile?: unknown) {
    manager(actor);
    if (!file || !file.name.endsWith('.xlsx') || file.size > Math.min(getConfig().maxUploadBytes, 30 * 1024 * 1024))
        throw new ValidationError('Ожидается .xlsx допустимого размера');
    const data = Buffer.from(await file.arrayBuffer());
    let wb;
    try {
        wb = await loadEnterprise(data);
    }
    catch {
        throw new ValidationError('INVALID_WORKBOOK');
    }
    const profile = rawProfile ? parseInput(enterpriseProfileSchema, rawProfile) : buildProfile(wb);
    const parsed = parseEnterprise(wb, profile);
    const checksum = sha256(data);
    const checksumRepeated = !!await db.importJob.count({ where: { sourceSha256: checksum, profileCode: profile.code } });
    const stored = await getStorage().put(data, { prefix: 'private-import' });
    try {
        return await transaction(async (tx) => {
            const rows = await duplicates(tx, parsed.rows);
            const summary: Summary = { profile, unresolved: parsed.unresolved, counts: countRows(rows), checksumRepeated };
            const job = await tx.importJob.create({ data: { sourceFilename: 'enterprise-workbook.xlsx', sourceSha256: checksum, sourceFormat: 'xlsx', profileCode: profile.code, status: 'dry_run_ready', startedBy: actor.userId, mappingVersion: sha256(JSON.stringify(profile)), sourceStorageKey: stored.storageKey, summaryJsonb: json(summary), probableDuplicates: rows.filter(r => r.warningCodes.includes('probable_duplicate')).length } });
            await tx.importRowResult.createMany({ data: rows.map(r => ({ importJobId: job.id, sheetName: r.sheetName, sourceSection: r.sectionKey, sourceRowNumber: r.rowNumber, sourceRecordKey: r.recordKey, targetEntityType: r.target, validationStatus: r.validationStatus, errorCodes: r.errorCodes, warningCodes: r.warningCodes })) });
            return { id: job.id, ...summary };
        });
    }
    catch (e) {
        await getStorage().remove(stored.storageKey);
        if (e instanceof AppError)
            throw e;
        throw new ValidationError('IMPORT_DRY_RUN_FAILED');
    }
}
export async function enterpriseJobExists(actor: Actor, id: string) { manager(actor); return !!await db.importJob.count({ where: { id, profileCode: 'enterprise_workbook_v2' } }); }
export async function inspectEnterprise(actor: Actor, id: string) { manager(actor); const job = await db.importJob.findFirst({ where: { id, profileCode: 'enterprise_workbook_v2' } }); if (!job)
    throw new NotFoundError(); const summary = job.summaryJsonb as unknown as Summary; const rows = await db.importRowResult.findMany({ where: { importJobId: id }, select: { sheetName: true, sourceSection: true, sourceRowNumber: true, validationStatus: true, commitResult: true, errorCodes: true, warningCodes: true } }); return { id, status: job.status, mappingVersion: job.mappingVersion,rowsImported:job.rowsImported,rowsSkipped:job.rowsSkipped,rowsError:job.rowsError, ...summary, rows }; }
export async function remapEnterprise(actor: Actor, id: string, input: unknown) {
    manager(actor);
    const profile = parseInput(enterpriseProfileSchema, input);
    const job = await db.importJob.findFirst({ where: { id, profileCode: profile.code } });
    if (!job)
        throw new NotFoundError();
    const parsed = parseEnterprise(await source(job), profile);
    return transaction(async (tx) => {
        const lock = await tx.importJob.updateMany({ where: { id, status: 'dry_run_ready', updatedAt: job.updatedAt }, data: { mappingVersion: sha256(JSON.stringify(profile)) } });
        if (!lock.count)
            throw new ConflictError('IMPORT_RUNNING', 'Проверка уже изменена');
        const rows = await duplicates(tx, parsed.rows);
        const summary: Summary = { profile, unresolved: parsed.unresolved, counts: countRows(rows), checksumRepeated: (job.summaryJsonb as unknown as Summary).checksumRepeated };
        await tx.importRowResult.deleteMany({ where: { importJobId: id } });
        await tx.importRowResult.createMany({ data: rows.map(r => ({ importJobId: id, sheetName: r.sheetName, sourceSection: r.sectionKey, sourceRowNumber: r.rowNumber, sourceRecordKey: r.recordKey, targetEntityType: r.target, validationStatus: r.validationStatus, errorCodes: r.errorCodes, warningCodes: r.warningCodes })) });
        await tx.importJob.update({ where: { id }, data: { summaryJsonb: json(summary) } });
        return summary;
    });
}
export async function commitEnterprise(actor: Actor, id: string, input: unknown) {
    try {
        return await commitEnterpriseInternal(actor, id, input);
    }
    catch (e) {
        if (e instanceof AppError)
            throw e;
        throw new ValidationError('IMPORT_COMMIT_FAILED');
    }
}
async function commitEnterpriseInternal(actor: Actor, id: string, input: unknown) {
    manager(actor);
    const confirmation = parseInput(z.object({ confirmed: z.literal(true), expectedMappingVersion: z.string(), acceptWarnings: z.boolean().default(false) }), input);
    const job = await db.importJob.findFirst({ where: { id, profileCode: 'enterprise_workbook_v2' } });
    if (!job)
        throw new NotFoundError();
    if (job.status === 'completed')
        return { id, status: 'completed', imported: job.rowsImported, skipped: job.rowsSkipped };
    const summary = job.summaryJsonb as unknown as Summary;
    if (confirmation.expectedMappingVersion !== job.mappingVersion)
        throw new ConflictError('MAPPING_CHANGED', 'Повторите проверку');
    const parsed = parseEnterprise(await source(job), enterpriseProfileSchema.parse(summary.profile));
    if (parsed.unresolved.length)
        throw new ValidationError('UNRESOLVED_COLUMNS');
    if (!confirmation.acceptWarnings && parsed.rows.some(r => r.warningCodes.length))
        throw new ValidationError('WARNINGS_REQUIRE_CONFIRMATION');
    // A single transaction owns the job claim, business records and receipts. A crash rolls everything back.
    // One stable existing User row serializes all v2 imports, on both Prisma backends, without raw SQL.
    return transaction(async (tx) => {
        const gate = await tx.user.findFirst({ where: { roleCode: 'manager' }, orderBy: { id: 'asc' }, select: { id: true } });
        if (!gate)
            throw new ForbiddenError();
        await tx.user.update({ where: { id: gate.id }, data: { updatedAt: new Date() } });
        const lock = await tx.importJob.updateMany({ where: { id, status: 'dry_run_ready', mappingVersion: job.mappingVersion }, data: { status: 'committing' } });
        if (!lock.count)
            throw new ConflictError('IMPORT_RUNNING', 'Импорт уже выполняется');
        const rows = await duplicates(tx, parsed.rows);
        const eligible = (r: EnterpriseRow) => !['invalid', 'unrecognized', 'skipped_policy'].includes(r.validationStatus)
            && !r.warningCodes.some(c => ['already_imported', 'probable_duplicate'].includes(c));
        let imported = 0, skipped = 0;
        const exportDates: Record<string, string> = {};
        for (const r of rows.filter(eligible)) {
            if (r.record.commercialPurpose && !await tx.dictionaryItem.count({ where: { category: 'commercial_purpose', code: String(r.record.commercialPurpose), isActive: true } }))
                throw new ValidationError('INVALID_PURPOSE_CODE');
            if (r.record.responsibleUserId && !await tx.user.count({ where: { id: String(r.record.responsibleUserId), isActive: true } }))
                throw new ValidationError('INVALID_RESPONSIBLE');
            if (!await tx.dictionaryItem.count({ where: { category: 'lead_source', isActive: true, code: String(r.record.sourceCode) } }))
                throw new ValidationError('INVALID_SOURCE_CODE');
        }
        for (const r of rows) {
            let target: {
                type: string;
                id: string;
            } | null = null;
            if (eligible(r)) {
                const result = await commitRow(tx, r, { coordinatesAsPhone: true, createTasksFromFixNotes: false, responsibleUserId: String(r.record.responsibleUserId ?? actor.userId), jobId: id, sourceFilename: 'enterprise-workbook.xlsx', actorId: actor.userId });
                if (!('skipped' in result)) {
                    target = result;
                    imported++;
                    if (result.type === 'Property')
                        await tx.property.update({ where: { id: result.id }, data: { status: String(r.record.status), archivedAt: r.record.status === 'archived' ? new Date() : null, commercialPurpose: r.record.commercialPurpose as string | null, attributesJsonb: json({ ...(r.record.extraAttributes as Record<string,unknown>??{}),priceUnit: r.record.priceUnit }) } });
                    if (result.type === 'Client') {
                        const lead = await tx.leadRequest.findFirst({ where: { clientId: result.id }, orderBy: { createdAt: 'asc' } });
                        if (lead) exportDates[`${r.sheetIndex}:${r.rowNumber}`] = lead.occurredAt.toISOString();
                        const cc = r.record.contacts as {
                            type: string;
                            normalized: string;
                            raw: string;
                        }[];
                        for (const c of cc.slice(1))
                            await tx.clientContact.create({ data: { clientId: result.id, contactType: c.type, rawValue: c.raw, normalizedValue: c.normalized } });
                    }
                }
            }
            if (!target)
                skipped++;
            await tx.importRowResult.updateMany({ where: { importJobId: id, sourceRowNumber: r.rowNumber, sheetName: r.sheetName }, data: { commitResult: target ? 'imported' : 'skipped', targetEntityType: target?.type ?? r.target, targetEntityId: target?.id ?? null, warningCodes: r.warningCodes, errorCodes: r.errorCodes } });
        }
        await tx.importJob.update({ where: { id }, data: { status: 'completed', rowsRead: rows.length, rowsImported: imported, rowsSkipped: skipped, finishedAt: new Date(), summaryJsonb: json({ ...summary, exportDates }) } });
        await writeAudit(tx, { actorUserId: actor.userId, action: 'import.enterprise.committed', entityType: 'ImportJob', entityId: id, after: { imported, skipped } });
        return { id, status: 'completed', imported, skipped };
    });
}
export async function exportEnterprise(actor: Actor, id: string) {
    manager(actor);
    const job = await db.importJob.findFirst({ where: { id, profileCode: 'enterprise_workbook_v2', status: 'completed' } });
    if (!job)
        throw new NotFoundError();
    const profile = enterpriseProfileSchema.parse((job.summaryJsonb as unknown as Summary).profile);
    const wb = await source(job);
    const parsed = parseEnterprise(wb, profile);
    const occupiedColumnSpans = wb.worksheets.map(ws => ws.columnCount);
    // Only this closed vocabulary may supply source-only context. Never copy arbitrary cells,
    // ignored mappings, formulas, or excluded personal fields back into the cleared workbook.
    const contextFields = new Set(['sourceRowId', 'contractRef', 'operationText', 'propertyTypeText', 'source', 'responsible', 'stateMark', 'request', 'comment']);
    const sourceContext = new Map(parsed.rows.map(row => [row, new Map(row.columns.filter(c => contextFields.has(c.field)).map(c => [c.field, text(wb.worksheets[row.sheetIndex - 1]!.getCell(row.rowNumber, c.column).value)]))]));
    const sourceContacts = new Map(parsed.rows.map(row => [row, row.columns.filter(c => ['phone', 'email'].includes(c.field)).map(c => ({ ...c, value: text(wb.worksheets[row.sheetIndex - 1]!.getCell(row.rowNumber, c.column).value) }))]));
    const receipts = await db.importRowResult.findMany({ where: { importJobId: id, commitResult: 'imported' } });
    const headers = new Set(parsed.blocks.flatMap(b => Array.from({ length: b.endRow - b.row + 1 }, (_, i) => `${b.sheet}:${b.row + i}`)));
    const sections = new Set(parsed.sectionMarkers.map(r => `${r.sheet}:${r.row}`));
    const report: Record<string, number> = { UNSUPPORTED_COLUMN: parsed.unresolved.length + profile.sheets.reduce((n, s) => n + Object.values(s.columns).filter(v => v === 'ignore').length, 0), HYPERLINK_CLEARED: 0, UNSUPPORTED_FIELD: 0, HYPERLINK_PRESERVED: 0, FORMULA_CLEARED: 0,NUMBER_AS_TEXT:0, IMAGE_PRESERVED: wb.worksheets.reduce((n, s) => n + s.getImages().length, 0) };
    // Clear every non-header/non-section cell, including ignored sheets and rejected rows. Never export stale source data.
    for (const [si, ws] of wb.worksheets.entries())
        ws.eachRow((r, rn) => { if (headers.has(`${si + 1}:${rn}`) || sections.has(`${si + 1}:${rn}`))
            return; r.eachCell(c => { if (c.hyperlink)
            report.HYPERLINK_CLEARED!++; if (c.type === 6)
            report.FORMULA_CLEARED!++; c.value = null; }); });
    for (const row of parsed.rows) {
        const receipt = receipts.find(r => r.sheetName === row.sheetName && r.sourceRowNumber === row.rowNumber);
        if (!receipt?.targetEntityId)
            continue;
        const config = profile.sheets.find(s => s.index === row.sheetIndex || (s.namePattern && new RegExp(s.namePattern, 'iu').test(wb.worksheets[row.sheetIndex - 1]!.name)));
        let values: Record<string, unknown> = {};
        const original = sourceContext.get(row)!;
        let unchangedContacts = false;
        let sourceUrl: string | null = null;
        if (receipt.targetEntityType === 'Property') {
            const p = await db.property.findUnique({ where: { id: receipt.targetEntityId } });
            if (p)
                sourceUrl = p.sourceUrl;
            if (p)
                values = { ...p, sourceRowId: original.get('sourceRowId'), contractRef: original.get('contractRef'), comment: original.get('comment'), receivedDate: row.record.receivedAt, propertyTypeText: p.commercialPurpose === row.record.commercialPurpose ? original.get('propertyTypeText') : p.commercialPurpose ?? p.propertyType, area: p.area?.toString(), price: p.price?.toString(), operationText: p.operationType === row.record.operationType ? original.get('operationText') : p.operationType === 'sale' ? 'Продажа' : 'Аренда', floor: p.floor !== null && p.floorsTotal !== null ? `${p.floor}/${p.floorsTotal} эт.` : p.floor, priceUnit: (p.attributesJsonb as {
                        priceUnit?: string;
                    } | null)?.priceUnit };
        }
        else if (receipt.targetEntityType === 'Client') {
            const c = await db.client.findUnique({ where: { id: receipt.targetEntityId }, include: { contacts: true, leadRequests: { orderBy: { createdAt: 'asc' }, take: 1 } } });
            if (c) {
                const lead = c.leadRequests[0];
                const baseline = (job.summaryJsonb as unknown as Summary).exportDates?.[`${row.sheetIndex}:${row.rowNumber}`];
                // A mandatory CRM timestamp is not evidence that the source supplied a date.
                const receivedDate = baseline && lead?.occurredAt.toISOString() !== baseline ? lead?.occurredAt : row.record.receivedAt;
                values = { name: c.displayName, responsibleUserId: c.responsibleUserId, source: lead?.sourceCode === row.record.sourceCode ? original.get('source') : Object.entries(config?.sourceMap ?? {}).find(([, code]) => code === lead?.sourceCode)?.[0], phone: c.contacts.filter(c => c.contactType === 'phone').map(c => c.rawValue || c.normalizedValue).join('; '), email: c.contacts.filter(c => c.contactType === 'email').map(c => c.rawValue || c.normalizedValue).join('; '), receivedDate, request: lead?.summary === row.record.comment ? original.get('request') : lead?.summary, comment: c.notes === row.record.comment ? original.get('comment') : c.notes, sourceRowId: original.get('sourceRowId'), operationText: original.get('operationText') };
                const importedContacts = row.record.contacts as { type: string; normalized: string; raw: string }[];
                unchangedContacts = c.contacts.length === importedContacts.length && importedContacts.every(old => c.contacts.some(current => current.contactType === old.type && current.normalizedValue === old.normalized && current.rawValue === old.raw));
            }
        }
        else if (receipt.targetEntityType === 'HistoricalDealArchive') {
            const a = await db.historicalDealArchive.findUnique({ where: { id: receipt.targetEntityId } });
            if (a)
                values = { ...a, sourceRowId: row.record.sourceRowId ?? null, addressText: a.objectText, receivedDate: a.dealDate, name: a.participantName, phone: a.contactPhone, email: a.contactEmail, area: a.area?.toString(), price: a.price?.toString(), commissionAmount: a.commissionAmount?.toString() };
        }
        if (values.responsibleUserId === (row.record.responsibleUserId ?? actor.userId)) values.responsible = original.get('responsible');
        if (receipt.targetEntityType === 'Property') values.source = original.get('source');
        if (values.status)
            values.stateMark = values.status === row.record.status ? original.get('stateMark') : Object.entries(config?.statusMap ?? {}).find(([, v]) => v === values.status)?.[0] ?? values.status;
        const used = new Set<string>();
        for (const col of row.columns) {
            if (unchangedContacts && ['phone', 'email'].includes(col.field)) {
                wb.worksheets[row.sheetIndex - 1]!.getCell(row.rowNumber, col.column).value = sourceContacts.get(row)!.find(c => c.column === col.column)!.value;
                continue;
            }
            if (used.has(col.field))
                continue;
            used.add(col.field);
            const v = values[col.field];
            const cell = wb.worksheets[row.sheetIndex - 1]!.getRow(row.rowNumber).getCell(col.column);
            if (v instanceof Date || typeof v === 'string' || typeof v === 'number')
                cell.value = v;
            else if (!Object.hasOwn(values, col.field))
                report.UNSUPPORTED_FIELD!++;
            if(typeof v==='string'&&['area','price','commissionAmount'].includes(col.field)&&/^\d+(?:\.\d+)?$/.test(v)){if(v.replace(/[^0-9]/g,'').length<=15)cell.value=Number(v);else report.NUMBER_AS_TEXT!++;}
            if (col.field === 'description' && typeof v === 'string' && sourceUrl) {
                cell.value = { text: v, hyperlink: sourceUrl };
                report.HYPERLINK_PRESERVED!++;
            }
        }
    }
    // ExcelJS otherwise loses the occupied column span on an entirely cleared sheet.
    // A blank styled anchor preserves geometry without retaining any source value.
    for (const [index, ws] of wb.worksheets.entries()) {
        // Column formatting may extend to XFD without any data there. Anchor
        // the original occupied span, not ExcelJS's full formatting array.
        const width = occupiedColumnSpans[index] ?? 0;
        if (width) {
            const anchor = ws.getCell(1, width);
            // Plain General maps to style 0, so ExcelJS drops a null cell with it.
            // Default protection serializes a real style without changing appearance,
            // enabling sheet protection, or restoring any cleared source value.
            if (anchor.value === null) anchor.protection = { locked: true, ...anchor.protection };
        }
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await writeAudit(db, { actorUserId: actor.userId, action: 'import.enterprise.exported', entityType: 'ImportJob', entityId: id, after: report });
    return { buffer, report };
}
