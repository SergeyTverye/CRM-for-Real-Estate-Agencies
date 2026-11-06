import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { normalizeHeader } from './profiles';
import { cellText, contactKind, normalizeAddress, parseDate } from './normalize';
import { sha256, type ParsedRow } from './workbook-parser';
export const fields = ['addressText', 'district', 'area', 'floor', 'propertyTypeText', 'operationText', 'price', 'priceUnit', 'description', 'stateMark', 'ownerName', 'ownerPhone', 'receivedDate', 'name', 'phone', 'email', 'request', 'source', 'responsible', 'comment', 'sourceRowId', 'contractRef', 'commissionAmount'] as const;
const patternSchema = z.string().max(120).refine(value => { if (/[(){}+\\]/.test(value))
    return false; try {
    new RegExp(value, 'iu');
    return true;
}
catch {
    return false;
} }, 'INVALID_PATTERN');
export const enterpriseProfileSchema = z.object({ version: z.literal(2), code: z.literal('enterprise_workbook_v2'), sheets: z.array(z.object({
        index: z.number().int().positive().optional(), namePattern: patternSchema.optional(), target: z.enum(['property', 'client_request_need', 'historical_deal_archive', 'ignore']), headerRow: z.union([z.literal('auto'), z.number().int().positive()]).default('auto'), columns: z.record(z.string(), z.union([z.enum(fields), z.literal('ignore'), z.null()])), hiddenRows: z.enum(['skip', 'archive']).default('skip'), statusMap: z.record(z.string(), z.enum(['draft', 'active', 'paused', 'closed', 'archived'])).default({}), purposeMap: z.record(z.string(), z.string()).default({}), sourceMap: z.record(z.string(), z.string()).default({}), responsibleMap: z.record(z.string(), z.uuid()).default({}), defaults: z.object({ propertyType: z.enum(['commercial', 'residential', 'land', 'country']).default('commercial'), operationType: z.enum(['rent', 'sale']).optional(), district: z.string().optional(), priceUnit: z.enum(['rub_total', 'rub_month', 'rub_m2', 'rub_m2_month', 'rub_year', 'rub_m2_year']).optional() }).default({ propertyType: 'commercial' }), sections: z.array(z.object({ pattern: patternSchema, propertyType: z.enum(['commercial', 'residential', 'land', 'country']).optional(), operationType: z.enum(['rent', 'sale']).optional(), district: z.string().optional() })).default([])
    })).min(1).max(30) });
export type EnterpriseProfile = z.infer<typeof enterpriseProfileSchema>;
export const dictionary: Record<string, typeof fields[number]> = { 'адрес': 'addressText', 'район': 'district', 'площадь': 'area', 'этаж': 'floor', 'назначение': 'propertyTypeText', 'операция': 'operationText', 'цена': 'price', 'ставка': 'price', 'единица': 'priceUnit', 'описание': 'description', 'статус': 'stateMark', 'метка': 'stateMark', 'собственник': 'ownerName', 'контакт собственника': 'ownerPhone', 'дата': 'receivedDate', 'клиент': 'name', 'контрагент': 'name', 'телефон': 'phone', 'e-mail': 'email', 'email': 'email', 'запрос': 'request', 'источник': 'source', 'ответственный': 'responsible', 'комментарий': 'comment', '№': 'sourceRowId', 'договор': 'contractRef', 'комиссия': 'commissionAmount' };
/** Decimal arithmetic uses integer digits: money never passes through binary multiplication. */
export function parseWorkbookNumber(value: unknown): string | null {
    if (value === null || value === undefined || value === '')
        return null;
    let s = String(value).toLowerCase().trim(), zeros = 0;
    if (/млн/.test(s))
        zeros = 6;
    else if (/тыс/.test(s))
        zeros = 3;
    s = s.replace(/(м²|м2|кв\.?\s*м|руб\.?|р\.|₽|млн\.?|тыс\.?)/g, '').replace(/[\s\u00a0]/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(s))
        return null;
    const [whole = '', fraction = ''] = s.split('.');
    const digits = (whole + fraction + '0'.repeat(Math.max(0, zeros - fraction.length))).replace(/^0+(?=\d)/, '');
    const scale = Math.max(0, fraction.length - zeros);
    if (scale > 2 || digits.length > 16)
        return null;
    const padded = digits.padStart(scale + 1, '0');
    const result = scale ? padded.slice(0, -scale) + '.' + padded.slice(-scale) : padded;
    return result.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
export const excludedHeader = (s: string) => /паспорт|выдан|регистрац|рождени/i.test(normalizeHeader(s));
export function text(v: ExcelJS.CellValue): string {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('formula' in v || 'sharedFormula' in v)
            return v.result === undefined ? '' : text(v.result as ExcelJS.CellValue);
        if ('richText' in v)
            return v.richText.map(x => x.text).join('');
        if ('text' in v)
            return String(v.text);
        return '';
    }
    return cellText(v ?? null);
}
export async function loadEnterprise(data: Buffer) {
    if (data.length > 30 * 1024 * 1024)
        throw new Error('WORKBOOK_TOO_LARGE');
    let expanded = 0;
    try {
        unzipSync(new Uint8Array(data), { filter: entry => { expanded += entry.originalSize; if (expanded > 100 * 1024 * 1024 || entry.originalSize > 32 * 1024 * 1024 || /vbaProject|externalLinks/i.test(entry.name))
                throw new Error('UNSAFE_ARCHIVE'); return false; } });
    }
    catch {
        throw new Error('INVALID_WORKBOOK');
    }
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(data as unknown as ArrayBuffer);
    }
    catch {
        throw new Error('INVALID_WORKBOOK');
    }
    if (wb.worksheets.length > 30 || wb.worksheets.some(s => s.rowCount > 50000 || s.columnCount > 200))
        throw new Error('WORKBOOK_LIMIT');
    return wb;
}
export function buildProfile(wb: ExcelJS.Workbook): EnterpriseProfile {
    return enterpriseProfileSchema.parse({ version: 2, code: 'enterprise_workbook_v2', sheets: wb.worksheets.map((ws, i) => {
            const columns: Record<string, string | null> = {};
            ws.eachRow(row => { const cells: string[] = []; row.eachCell(c => { const h = normalizeHeader(text(c.value)); if (h)
                cells.push(h); }); if (cells.filter(h => dictionary[h]).length >= 3)
                for (const h of cells)
                    if (!excludedHeader(h))
                        columns[h] = dictionary[h] ?? null; });
            return { index: i + 1, target: i < 3 ? 'property' : i === 3 ? 'client_request_need' : i === 4 ? 'historical_deal_archive' : 'ignore', columns, headerRow: 'auto', hiddenRows: 'skip', defaults: { propertyType: 'commercial' }, sections: [{ pattern: 'аренд|сда', operationType: 'rent' }, { pattern: 'прод|куп', operationType: 'sale' }] };
        }) });
}
export type EnterpriseRow = ParsedRow & {
    sheetIndex: number;
    hidden: boolean;
    sectionRow: number;
    columns: {
        column: number;
        field: string;
    }[];
};
export function parseEnterprise(wb: ExcelJS.Workbook, p: EnterpriseProfile) {
    const sectionMarkers: {
        sheet: number;
        row: number;
    }[] = [];
    const rows: EnterpriseRow[] = [], unresolved: {
        sheet: number;
        row: number;
        column: number;
    }[] = [], blocks: {
        sheet: number;
        row: number;
        columns: {
            column: number;
            field: string;
        }[];
    }[] = [];
    for (const [si, ws] of wb.worksheets.entries()) {
        const config = p.sheets.find(s => s.index === si + 1 || (s.namePattern && new RegExp(s.namePattern, 'iu').test(ws.name)));
        if (!config || config.target === 'ignore')
            continue;
        let columns: {
            column: number;
            field: string;
        }[] = [], sectionRow = 1;
        let context = { ...config.defaults };
        ws.eachRow((row, rn) => {
            const cells: {
                column: number;
                value: string;
            }[] = [];
            row.eachCell((c, cn) => { const value = text(c.value); if (value)
                cells.push({ column: cn, value }); });
            const hits = cells.filter(c => dictionary[normalizeHeader(c.value)] || Object.hasOwn(config.columns, normalizeHeader(c.value)));
            if ((config.headerRow === 'auto' && hits.length >= 3) || config.headerRow === rn) {
                columns = [];
                for (const c of cells) {
                    const h = normalizeHeader(c.value);
                    if (excludedHeader(h))
                        continue;
                    const field = config.columns[h];
                    if (field === 'ignore')
                        continue;
                    if (field)
                        columns.push({ column: c.column, field });
                    else
                        unresolved.push({ sheet: si + 1, row: rn, column: c.column });
                }
                blocks.push({ sheet: si + 1, row: rn, columns: [...columns] });
                sectionRow = rn;
                context = { ...config.defaults };
                return;
            }
            if (cells.length <= 2 && cells.some(c => row.getCell(c.column).font?.bold)) {
                sectionMarkers.push({ sheet: si + 1, row: rn });
                const label = cells.map(c => c.value).join(' ');
                for (const rule of config.sections)
                    if (new RegExp(rule.pattern, 'iu').test(label))
                        context = { ...context, ...rule };
                sectionRow = rn;
                return;
            }
            if (!columns.length || !cells.length)
                return;
            const raw: Record<string, string> = {};
            for (const c of columns)
                raw[c.field] = [raw[c.field], text(row.getCell(c.column).value)].filter(Boolean).join('; ');
            const cc = [...new Map([raw.phone, raw.email].filter(Boolean).join(';').split(/[;,\n]+|\s\/\s/).flatMap(t => t.match(/[^\s<>;,]+@[^\s<>;,]+\.[^\s<>;,]+|\+?\d[\d() -]{8,}\d/g) ?? [t]).map(t => contactKind(t.trim())).filter(c => c.normalized).map(c => [c.normalized, c])).values()];
            const operation = raw.operationText || (config.target === 'client_request_need' ? raw.request : '') || '';
            const op = /аренд|rent/i.test(operation) ? 'rent' : /прод|куп|sale/i.test(operation) ? 'sale' : context.operationType;
            const floor = /^(\d+)(?:\/(\d+))?/.exec(raw.floor ?? '');
            const dateColumn = columns.find(c => c.field === 'receivedDate');
            const dateValue = dateColumn ? row.getCell(dateColumn.column).value : null;
            const received = parseDate(typeof dateValue === 'number' && wb.properties.date1904 ? dateValue + 1462 : dateValue as string | number | Date);
            const linkColumn = columns.find(c => c.field === 'description');
            const hyperlink = linkColumn ? row.getCell(linkColumn.column).hyperlink : undefined;
            const safeLink = hyperlink && /^https?:\/\//i.test(hyperlink) && !/^https?:\/\/[^/]*@/i.test(hyperlink) ? hyperlink : null;
            const rec: Record<string, unknown> = { addressText: raw.addressText || null, district: raw.district || context.district || null, area: parseWorkbookNumber(raw.area), price: parseWorkbookNumber(raw.price), floor: floor ? Number(floor[1]) : null, floorsTotal: floor?.[2] ? Number(floor[2]) : null, propertyType: context.propertyType, operationType: config.target === 'client_request_need' ? (/сда|lease_out/i.test(operation) ? 'lease_out' : /куп|buy/i.test(operation) ? 'buy' : /прод|sell/i.test(operation) ? 'sell' : op === 'rent' ? 'rent' : null) : op, sourceType: 'agency_listing', description: raw.description?.replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '[контакт скрыт]') || null, sourceUrl: safeLink, commercialPurpose: config.purposeMap[normalizeHeader(raw.propertyTypeText)] ?? null, extraAttributes: raw.propertyTypeText ? { purposeText: raw.propertyTypeText } : undefined, name: raw.name || null, receivedAt: received, comment: [raw.request, raw.comment].filter(Boolean).join('; ') || null, channelCode: 'other', sourceCode: config.sourceMap[normalizeHeader(raw.source)] ?? 'other', needStatus: 'active', contacts: cc, coordinatesRaw: cc[0]?.normalized ?? null, coordinatesNormalized: cc[0]?.normalized ?? null, coordinatesKind: cc[0]?.type ?? null, sourceRowId: raw.sourceRowId || null, objectText: raw.addressText || null, contractRef: raw.contractRef || null, commissionAmount: parseWorkbookNumber(raw.commissionAmount), dealDate: received, participantName: raw.name || null, priceUnit: raw.priceUnit || context.priceUnit || (op === 'sale' ? 'rub_total' : null), status: row.hidden ? 'archived' : config.statusMap[normalizeHeader(raw.stateMark)] ?? 'active', responsibleUserId: config.responsibleMap[normalizeHeader(raw.responsible)] ?? null, owner: raw.ownerName && raw.ownerPhone && contactKind(raw.ownerPhone).type === 'phone' ? { name: raw.ownerName, phone: contactKind(raw.ownerPhone).normalized } : null };
            const keyFields = config.target === 'client_request_need' ? [cc.map(c => c.normalized).sort(), received] : [normalizeAddress(raw.addressText ?? ''), rec.area, op ?? '', config.target === 'historical_deal_archive' ? raw.sourceRowId : ''];
            const key = sha256(JSON.stringify([si + 1, config.target, keyFields]));
            const errors: string[] = [];
            if(raw.area&&(rec.area===null||rec.area==='0'||String(rec.area).split('.')[0]!.length>10))errors.push('INVALID_AREA');
            if(raw.commissionAmount&&rec.commissionAmount===null)errors.push('INVALID_COMMISSION');
            if(raw.floor&&!floor)errors.push('INVALID_FLOOR');
            if(rec.price&&String(rec.price).split('.')[0]!.length>14)errors.push('INVALID_PRICE');
            if(rec.priceUnit&&!['rub_total','rub_month','rub_m2','rub_m2_month','rub_year','rub_m2_year'].includes(String(rec.priceUnit)))errors.push('INVALID_PRICE_UNIT');
            if (config.target === 'property' && raw.price && op === 'rent' && !raw.priceUnit && !context.priceUnit)
                errors.push('PRICE_UNIT_REQUIRED');
            if (config.target === 'property' && (!rec.addressText || !rec.area || !op))
                errors.push('MISSING_PROPERTY_KEY');
            if (config.target === 'client_request_need' && (!rec.name || !cc.length))
                errors.push('MISSING_CLIENT_KEY');
            if (config.target === 'historical_deal_archive' && !rec.objectText)
                errors.push('MISSING_ADDRESS');
            if (raw.price && rec.price === null)
                errors.push('INVALID_PRICE');
            if (raw.receivedDate && !received)
                errors.push('INVALID_DATE');
            const skipped = row.hidden && config.hiddenRows === 'skip';
            const warningCodes = row.hidden ? ['HIDDEN_ROW'] : [];
            if ((raw.responsible && !rec.responsibleUserId) || (raw.source && !config.sourceMap[normalizeHeader(raw.source)]) || (raw.stateMark && !config.statusMap[normalizeHeader(raw.stateMark)]) || ((raw.ownerName || raw.ownerPhone) && !rec.owner))
                warningCodes.push('REQUIRES_MANUAL_REVIEW');
            rows.push({ sheetIndex: si + 1, hidden: row.hidden, sectionRow, columns: [...columns], sheetName: `sheet:${si + 1}`, sectionKey: `${si + 1}:${sectionRow}`, profileCode: p.code, rowNumber: rn, recordKey: key, target: config.target === 'ignore' ? null : config.target, validationStatus: skipped ? 'skipped_policy' : errors.length ? 'invalid' : warningCodes.length ? 'warning' : 'ready', errorCodes: errors, warningCodes, record: rec, dedupe: { phones: cc.filter(c => c.type === 'phone').map(c => c.normalized!), emails: cc.filter(c => c.type === 'email').map(c => c.normalized!), addressKey: rec.addressText ? normalizeAddress(String(rec.addressText)) : null, archiveKey: config.target === 'historical_deal_archive' ? key : null } });
        });
    }
    return { rows, unresolved, blocks, sectionMarkers };
}
