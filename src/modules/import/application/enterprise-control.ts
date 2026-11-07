import { z } from 'zod';
import type { Tx } from '@/shared/db/client';
import { ValidationError } from '@/shared/errors';
import { insertTask } from '@/modules/tasks/application/task-service';
import { normalizeAddress } from '../domain/normalize';
import { controlAdPlatforms, controlAdStatuses, parseWorkbookNumber, type EnterpriseRow } from '../domain/enterprise-workbook';

const recordSchema = z.object({
    addressText: z.string().min(1), area: z.string().nullable(), price: z.string().nullable(),
    district: z.string().nullable(), propertyType: z.string(), operationType: z.enum(['rent', 'sale']),
    status: z.string(), priceUnit: z.string().nullable(), agreementPresent: z.boolean(),
    absenceReason: z.string().nullable(), commissionFrom: z.string().nullable(), commissionTo: z.string().nullable(),
    commissionAmount: z.string().refine(v => parseWorkbookNumber(v) !== null && v.split('.')[0]!.length <= 14, 'INVALID_COMMISSION').nullable().default(null),
    adPlatform: z.enum(controlAdPlatforms).nullable().default(null), adStatus: z.enum(controlAdStatuses).nullable().default(null),
    fixNote: z.string().nullable(), taskText: z.string().nullable(), adText: z.string().nullable(), adUrl: z.string().nullable(),
});
export type ControlLinks = { propertyId: string; agreementId: string; advertisementId: string | null; taskId: string | null };

/** v2 deliberately does not use v1's first-address-match heuristic. */
export async function commitEnterpriseControl(tx: Tx, row: EnterpriseRow, responsibleUserId: string, actorId: string): Promise<ControlLinks> {
    const r = recordSchema.parse(row.record);
    const candidates = (await tx.property.findMany({ where: { operationType: r.operationType }, select: { id: true, addressText: true, area: true } }))
        .filter(p => normalizeAddress(p.addressText) === normalizeAddress(r.addressText) && (r.area === null || p.area?.toString() === r.area));
    if (candidates.length > 1) throw new ValidationError('AMBIGUOUS_CONTROL_PROPERTY');
    const propertyId = candidates[0]?.id ?? (await tx.property.create({ data: {
        addressText: r.addressText, area: r.area, price: r.price, district: r.district,
        propertyType: r.propertyType, operationType: r.operationType, sourceType: 'agency_listing',
        status: r.status, archivedAt: r.status === 'archived' ? new Date() : null,
        attributesJsonb: { priceUnit: r.priceUnit }, responsibleUserId, createdBy: actorId,
    } })).id;
    const agreement = await tx.agreement.create({ data: {
        propertyId, responsibleUserId, agreementType: 'information',
        status: r.agreementPresent ? 'draft' : 'no_agreement', absenceReasonCode: r.agreementPresent ? null : 'other',
        actionRequired: r.fixNote,
        commissionType: r.commissionAmount !== null ? 'fixed' : null, commissionValue: r.commissionAmount,
        commissionNotes: r.commissionFrom !== null || r.commissionTo !== null ? `Комиссия: от ${r.commissionFrom ?? '—'} до ${r.commissionTo ?? '—'}` : null,
        notes: r.agreementPresent ? 'Импорт: договор отмечен как имеющийся' : `Причина отсутствия: ${r.absenceReason ?? 'не указана'}`,
    } });
    // Missing metadata is visible in dry-run as AD_DETAILS_REQUIRED, never evidence of publication.
    const ad = r.adUrl || r.adText || r.adPlatform || r.adStatus ? await tx.advertisement.create({ data: {
        propertyId, responsibleUserId, platformCode: r.adPlatform ?? 'other', url: r.adUrl, adText: r.adText, status: r.adStatus ?? 'draft',
    } }) : null;
    const task = r.taskText ? await insertTask(tx, actorId, {
        title: r.taskText.slice(0, 300), description: r.taskText, taskType: 'contract_check',
        dueAt: new Date(Date.now() + 3 * 86_400_000), responsibleUserId,
    }, { propertyIds: [propertyId], agreementIds: [agreement.id], ...(ad ? { advertisementIds: [ad.id] } : {}) }) : null;
    return { propertyId, agreementId: agreement.id, advertisementId: ad?.id ?? null, taskId: task?.id ?? null };
}

export async function exportEnterpriseControl(tx: Tx, links: ControlLinks) {
    const a = await tx.agreement.findUnique({ where: { id: links.agreementId } });
    const ad = links.advertisementId ? await tx.advertisement.findUnique({ where: { id: links.advertisementId } }) : null;
    const task = links.taskId ? await tx.task.findUnique({ where: { id: links.taskId } }) : null;
    const commission = /^Комиссия: от (\d+(?:\.\d+)?|—) до (\d+(?:\.\d+)?|—)$/.exec(a?.commissionNotes ?? '');
    return {
        agreementPresence: a ? a.status === 'no_agreement' ? 'Нет' : 'Да' : null,
        absenceReason: a?.status === 'no_agreement' ? a.notes?.replace(/^Причина отсутствия: /, '') : null,
        commissionFrom: commission?.[1] === '—' ? null : commission?.[1] ?? null,
        commissionTo: commission?.[2] === '—' ? null : commission?.[2] ?? null,
        commissionAmount: a?.commissionType === 'fixed' && a.commissionValue !== null ? a.commissionValue.toString() : null,
        fixNote: a?.actionRequired ?? null, taskText: task?.description ?? task?.title ?? null,
        adText: ad?.adText ?? null, adUrl: ad?.url ?? null,
        adPlatform: ad?.platformCode ?? null, adStatus: ad?.status ?? null,
    };
}
