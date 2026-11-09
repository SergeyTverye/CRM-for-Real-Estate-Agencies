import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { normalizeHeader } from './profiles';
import { cellText, contactKind, normalizeAddress, parseDate } from './normalize';
import { sha256, type ParsedRow } from './workbook-parser';
export const fields = ['addressText', 'district', 'area', 'floor', 'propertyTypeText', 'operationText', 'price', 'priceUnit', 'description', 'stateMark', 'ownerName', 'ownerPhone', 'receivedDate', 'name', 'phone', 'email', 'request', 'source', 'responsible', 'comment', 'sourceRowId', 'contractRef', 'commissionAmount', 'agreementPresence', 'absenceReason', 'commissionFrom', 'commissionTo', 'fixNote', 'adText', 'adUrl', 'adPlatform', 'adStatus', 'taskText'] as const;
export const controlAdPlatforms = ['avito', 'cian', 'domclick', 'yandex_realty', 'own_site', 'other'] as const;
export const controlAdStatuses = ['draft', 'active', 'paused', 'expired', 'removed'] as const;
export const controlAdPlatformLabels: Record<typeof controlAdPlatforms[number], string> = {
    avito: 'Авито', cian: 'ЦИАН', domclick: 'Домклик', yandex_realty: 'Яндекс Недвижимость', own_site: 'Сайт агентства', other: 'Другое',
};
export const controlAdStatusLabels: Record<typeof controlAdStatuses[number], string> = {
    draft: 'Не опубликовано', active: 'Опубликовано', paused: 'Приостановлено', expired: 'Истекло', removed: 'Снято',
};
function closedAdCode<T extends string>(value: string | undefined, codes: readonly T[], labels: Record<T, string>, mapping: Record<string, T> | undefined): T | null {
    const key = normalizeHeader(value);
    if (!key) return null;
    if (codes.includes(key as T)) return key as T;
    return mapping?.[key] ?? codes.find(code => normalizeHeader(labels[code]) === key) ?? null;
}
const patternSchema = z.string().max(120).refine(value => { if (/[(){}+\\]/.test(value))
    return false; try {
    new RegExp(value, 'iu');
    return true;
}
catch {
    return false;
} }, 'INVALID_PATTERN');
export const enterpriseProfileSchema = z.object({ version: z.literal(2), code: z.literal('enterprise_workbook_v2'), sheets: z.array(z.object({
        index: z.number().int().positive().optional(), namePattern: patternSchema.optional(), target: z.enum(['property', 'client_request_need', 'historical_deal_archive', 'property_agreement_control', 'ignore']).nullable(), blockTargets: z.record(z.string(), z.enum(['property', 'client_request_need', 'historical_deal_archive', 'property_agreement_control', 'ignore']).nullable()).optional(), headerRow: z.union([z.literal('auto'), z.number().int().positive()]).default('auto'), columns: z.record(z.string(), z.union([z.enum(fields), z.literal('ignore'), z.null()])), hiddenRows: z.enum(['skip', 'archive']).default('skip'), statusMap: z.record(z.string(), z.enum(['draft', 'active', 'paused', 'closed', 'archived'])).default({}), adPlatformMap: z.record(z.string(), z.enum(controlAdPlatforms)).default({}), adStatusMap: z.record(z.string(), z.enum(controlAdStatuses)).default({}), purposeMap: z.record(z.string(), z.string()).default({}), sourceMap: z.record(z.string(), z.string()).default({}), responsibleMap: z.record(z.string(), z.uuid()).default({}), defaults: z.object({ propertyType: z.enum(['commercial', 'residential', 'land', 'country']).default('commercial'), operationType: z.enum(['rent', 'sale']).optional(), district: z.string().optional(), priceUnit: z.enum(['rub_total', 'rub_month', 'rub_m2', 'rub_m2_month', 'rub_year', 'rub_m2_year']).optional() }).default({ propertyType: 'commercial' }), sections: z.array(z.object({ pattern: patternSchema, propertyType: z.enum(['commercial', 'residential', 'land', 'country']).optional(), operationType: z.enum(['rent', 'sale']).optional(), district: z.string().optional() })).default([])
    })).min(1).max(30) });
export type EnterpriseProfile = z.infer<typeof enterpriseProfileSchema>;
export const dictionary: Record<string, typeof fields[number]> = { 'адрес': 'addressText', 'район': 'district', 'площадь': 'area', 'этаж': 'floor', 'назначение': 'propertyTypeText', 'операция': 'operationText', 'цена': 'price', 'ставка': 'price', 'единица': 'priceUnit', 'описание': 'description', 'статус': 'stateMark', 'метка': 'stateMark', 'собственник': 'ownerName', 'контакт собственника': 'ownerPhone', 'дата': 'receivedDate', 'клиент': 'name', 'контрагент': 'name', 'телефон': 'phone', 'e-mail': 'email', 'email': 'email', 'запрос': 'request', 'источник': 'source', 'ответственный': 'responsible', 'комментарий': 'comment', '№': 'sourceRowId', 'договор': 'contractRef', 'комиссия': 'commissionAmount' };
export function parseWorkbookNumber(value: unknown): string | null {
    if (value === null || value === undefined || value === '')
        return null;
    const quantity = /^(\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?)\s*(?:(млн|тыс)\.?\s*)?(?:(?:руб\.?|р\.|₽)(?:\s*\/\s*(?:м²|м2|кв\.?\s*м))?(?:\s*\/\s*(?:мес\.?|месяц|год))?|(?:м²|м2|кв\.?\s*м))?$/u.exec(String(value).toLowerCase().trim());
    if (!quantity) return null;
    const zeros = quantity[2] === 'млн' ? 6 : quantity[2] === 'тыс' ? 3 : 0;
    const s = quantity[1]!.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
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
type Field = typeof fields[number];
type Target = Exclude<EnterpriseProfile['sheets'][number]['target'], 'ignore'>;
type HeaderCell = { column: number; header: string; field: Field | null };
export type EnterpriseHeader = { row: number; endRow: number; target: Target; cells: HeaderCell[] };

const headerKey = (s: string) => normalizeHeader(s.replace(/ф\s*\.\s*и\s*\.\s*о\.?/giu, 'фио ')).replace(/²/g, '2').replace(/[ё]/g, 'е')
    .replace(/[\s.,:;()\[\]«»"_\-/]+/g, ' ').trim();
const aliases: Partial<Record<Field, string[]>> = {
    addressText: ['адрес объекта', 'местонахождение', 'местоположение объекта', 'address', 'property address'],
    district: ['район города', 'district'], area: ['общая площадь', 'площадь общая', 'площадь помещения', 's м2', 's кв м', 'area', 'total area'],
    floor: ['этаж этажность', 'floor'], propertyTypeText: ['назначение объекта', 'тип объекта', 'purpose'],
    operationText: ['тип операции', 'вид операции', 'аренда продажа', 'operation'],
    price: ['стоимость', 'стоимость объекта', 'цена объекта', 'арендная плата', 'арендная ставка', 'price', 'rent rate'],
    priceUnit: ['единица цены', 'единица измерения цены', 'price unit'], description: ['описание объекта', 'description'],
    name: ['фио', 'фио клиента', 'наименование клиента', 'имя клиента', 'client', 'client name', 'контактное лицо'],
    phone: ['тел', 'телефон клиента', 'контактный телефон', 'телефоны', 'phone'], email: ['электронная почта', 'эл почта', 'e mail'],
    ownerName: ['фио собственника', 'владелец', 'owner', 'собственник фио'], ownerPhone: ['телефон собственника', 'тел собственника', 'собственник телефон', 'собственник тел'],
    request: ['потребность', 'запрос клиента', 'что ищет', 'request'], receivedDate: ['дата обращения', 'дата заявки', 'дата сделки', 'date'],
    source: ['источник обращения', 'source'], responsible: ['риелтор', 'ответственный сотрудник', 'responsible'],
    comment: ['примечание', 'примечания', 'comment'], sourceRowId: ['номер', 'номер п п', '№ п п', 'п п', 'id', 'number'],
    contractRef: ['номер договора', '№ договора', 'договор №', 'contract'], commissionAmount: ['сумма комиссии', 'комиссионные', 'commission'],
    stateMark: ['состояние', 'status', 'актуальность'],
    agreementPresence: ['наличие договора', 'договор есть', 'есть договор', 'agreement present'],
    absenceReason: ['причины, почему его нет', 'причина отсутствия договора', 'absence reason'],
    commissionFrom: ['комиссия от', 'commission from'], commissionTo: ['комиссия до', 'commission to'],
    fixNote: ['что нужно исправить', 'что исправить', 'fix note'],
    adText: ['рекл. текст', 'рекламный текст', 'текст рекламы', 'ad text'],
    adUrl: ['ссылка на рекламу', 'ссылка на объявление', 'ad url'],
    adPlatform: ['рекламная площадка', 'площадка рекламы', 'площадка', 'ad platform'],
    adStatus: ['реклама', 'статус рекламы', 'статус объявления', 'ad status'],
    taskText: ['задача', 'task'],
};
const headerAliases = new Map<string, Field>();
for (const [label, field] of Object.entries(dictionary)) headerAliases.set(headerKey(label), field);
for (const field of fields) for (const label of aliases[field] ?? []) headerAliases.set(headerKey(label), field);
export function classifyEnterpriseHeader(label: string): Field | null {
    if (excludedHeader(label)) return null;
    const key = headerKey(label);
    const direct = headerAliases.get(key);
    if (direct) return direct;
    const withoutUnit = key.replace(/ (?:м2|кв м|кв метр(?:ов|а)?|m2|sqm|руб|рублей|р|₽)(?: (?:за|в))?(?: (?:м2|кв м|месяц|мес|год|m2|month))*$/, '');
    const measured = headerAliases.get(withoutUnit);
    return measured === 'area' || measured === 'price' || measured === 'commissionAmount' || measured === 'commissionFrom' || measured === 'commissionTo' ? measured : null;
}
function indicatorTarget(label: string): Target {
    const key = headerKey(label);
    if (['объекты', 'объекты аренды', 'объекты продажи', 'каталог объектов', 'property listings'].includes(key)) return 'property';
    if (['анализ договоров', 'контроль договоров', 'анализ наличия договора', 'agreement control'].includes(key)) return 'property_agreement_control';
    if (['архив сделок', 'история сделок', 'historical deals'].includes(key)) return 'historical_deal_archive';
    if (['обращения клиентов', 'заявки клиентов', 'client requests'].includes(key)) return 'client_request_need';
    return null;
}
function targetFor(cells: HeaderCell[], indicator: Target = null): Target {
    const f = new Set(cells.map(c => c.field));
    const historical = f.has('addressText') && f.has('contractRef') && f.has('commissionAmount');
    const client = f.has('name') && (f.has('phone') || f.has('email')) && (f.has('request') || f.has('receivedDate'));
    const property = f.has('addressText') && f.has('area');
    if (f.has('addressText') && f.has('agreementPresence'))
        return client || historical || (indicator && indicator !== 'property_agreement_control') ? null : 'property_agreement_control';
    if (client && (property || historical)) return null;
    const strong = historical ? 'historical_deal_archive' : client ? 'client_request_need' : property ? 'property' : null;
    if (strong && indicator && strong !== indicator) return null;
    if (strong) return strong;
    if (indicator === 'property' && f.has('addressText') && f.has('price')) return indicator;
    if (indicator === 'historical_deal_archive' && f.has('addressText') && (f.has('contractRef') || f.has('receivedDate'))) return indicator;
    if (indicator === 'client_request_need' && f.has('name') && (f.has('phone') || f.has('email'))) return indicator;
    return null;
}
function headerPriceUnit(label: string): string | undefined {
    const key = headerKey(label);
    if (!/(?:^| )(?:руб|рублей|р|₽)(?: |$)/.test(key)) return;
    const perArea = /(?:^| )(?:м2|кв м)(?: |$)/.test(key);
    const month = /(?:^| )(?:мес|месяц)(?: |$)/.test(key);
    const year = /(?:^| )год(?: |$)/.test(key);
    if (month && year) return;
    return perArea ? month ? 'rub_m2_month' : year ? 'rub_m2_year' : 'rub_m2' : month ? 'rub_month' : year ? 'rub_year' : 'rub_total';
}
export function detectEnterpriseHeaders(ws: ExcelJS.Worksheet, config?: EnterpriseProfile['sheets'][number]): EnterpriseHeader[] {
    const result: EnterpriseHeader[] = [];
    let indicator = indicatorTarget(ws.name);
    const mapped = (header: string): Field | null => {
        const field = config?.columns[normalizeHeader(header)];
        return field && field !== 'ignore' ? field : classifyEnterpriseHeader(header);
    };
    const read = (rn: number, child = false): HeaderCell[] => {
        const cells: HeaderCell[] = [];
        ws.getRow(rn).eachCell((c, cn) => {
            if (c.isMerged && c.master.address !== c.address) return;
            let header = text(c.value).trim();
            if (!header) return;
            if (child && rn > 1) {
                const parent = ws.getCell(rn - 1, cn);
                if (parent.isMerged && Number(parent.master.row) === rn - 1) {
                    const combined = `${text(parent.value)} ${header}`;
                    if (excludedHeader(combined) || classifyEnterpriseHeader(combined)) header = combined;
                }
            }
            cells.push({ column: cn, header, field: excludedHeader(header) ? null : mapped(header) });
        });
        if (child) ws.getRow(rn).eachCell((c, cn) => {
            if (c.isMerged && Number(c.master.row) < rn && Number(c.master.col) === cn && !cells.some(x => x.column === cn)) {
                const header = text(c.value).trim();
                if (header) cells.push({ column: cn, header, field: excludedHeader(header) ? null : mapped(header) });
            }
        });
        return cells.sort((a, b) => a.column - b.column);
    };
    const score = (cells: HeaderCell[]) => new Set(cells.filter(c => c.field).map(c => c.field)).size;
    const explicitRow = typeof config?.headerRow === 'number' ? config.headerRow : undefined;
    ws.eachRow((row, rn) => {
        if (result.length && result[result.length - 1]!.endRow >= rn) return;
        const single = read(rn);
        if (single.length <= 2 && single.some(c => row.getCell(c.column).font?.bold)) {
            indicator = indicatorTarget(single.map(c => c.header).join(' ')) ?? indicator;
        }
        const next = rn < ws.rowCount ? read(rn + 1, true) : [];
        const hasMerged = single.some(c => row.getCell(c.column).isMerged);
        const paired = hasMerged && score(next) >= 2 && score(next) > score(single);
        const cells = paired ? next : single;
        const configuredBlock = !!config?.blockTargets && Object.hasOwn(config.blockTargets, String(rn));
        const explicit = explicitRow === rn || configuredBlock;
        if (explicitRow !== undefined && !explicit) {
            const original = result.find(h => h.row === explicitRow);
            const repeated = original && rn > original.endRow && score(cells) >= 2
                && cells.length === original.cells.length && cells.every((c, i) => {
                    const previous = original.cells[i]!;
                    return c.column === previous.column && headerKey(c.header) === headerKey(previous.header);
                });
            if (!repeated) return;
        }
        const boundary = rn === 1 || !ws.getRow(rn - 1).actualCellCount;
        const styledUnknown = boundary && cells.length >= 2 && cells.every(c => row.getCell(c.column).font?.bold && c.header.length <= 80);
        if (!explicit && score(cells) < 2 && !styledUnknown) return;
        if (!explicit && !paired && !styledUnknown && !boundary && !targetFor(cells, indicator) && score(cells) < 3) return;
        result.push({ row: rn, endRow: paired ? rn + 1 : rn, target: targetFor(cells, indicator), cells });
    });
    let bi = -1;
    ws.eachRow((row, rn) => {
        while (bi + 1 < result.length && result[bi + 1]!.row <= rn) bi++;
        const block = result[bi];
        if (!block || rn <= block.endRow) return;
        const occupied: number[] = [];
        row.eachCell((c, cn) => { if (c.value !== null && (!c.isMerged || c.master.address === c.address)) occupied.push(cn); });
        if (occupied.length <= 2 && occupied.some(cn => row.getCell(cn).font?.bold)) return;
        for (const column of occupied) if (!block.cells.some(c => c.column === column)) {
            block.cells.push({ column, header: `@${block.row}:${column}`, field: null });
        }
    });
    return result;
}
export function buildProfile(wb: ExcelJS.Workbook): EnterpriseProfile {
    return enterpriseProfileSchema.parse({ version: 2, code: 'enterprise_workbook_v2', sheets: wb.worksheets.map((ws, i) => {
        const headers = detectEnterpriseHeaders(ws);
        const columns: Record<string, string | null> = {};
        for (const block of headers) for (const c of block.cells)
            if (!excludedHeader(c.header)) columns[normalizeHeader(c.header)] = c.field;
        for (const block of headers) for (const c of block.cells)
            if (c.field && !['phone', 'email'].includes(c.field) && block.cells.filter(other => other.field === c.field).length > 1)
                columns[`@${block.row}:${c.column}`] = null;
        const targets = new Set(headers.map(h => h.target));
        const target = targets.size === 1 ? headers[0]!.target : null;
        return { index: i + 1, target, ...(targets.size > 1 ? { blockTargets: Object.fromEntries(headers.map(h => [h.row, h.target])) } : {}), columns, headerRow: 'auto', hiddenRows: 'skip', defaults: { propertyType: 'commercial', ...(target === 'property_agreement_control' ? { operationType: 'rent' as const } : {}) }, sections: [{ pattern: 'аренд|сда', operationType: 'rent' }, { pattern: 'прод|куп', operationType: 'sale' }] };
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
const controlOnlyFields = new Set<string>(['agreementPresence', 'absenceReason', 'commissionFrom', 'commissionTo', 'fixNote', 'adText', 'adUrl', 'adPlatform', 'adStatus', 'taskText']);
const controlFields = new Set<string>([...controlOnlyFields, 'commissionAmount', 'addressText', 'district', 'area', 'price', 'priceUnit', 'operationText', 'stateMark', 'sourceRowId', 'responsible']);
const maskContacts = (s?: string) => s?.replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '[контакт скрыт]') || null;
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
        endRow: number;
        columns: {
            column: number;
            field: string;
        }[];
    }[] = [];
    for (const [si, ws] of wb.worksheets.entries()) {
        const config = p.sheets.find(s => s.index === si + 1 || (s.namePattern && new RegExp(s.namePattern, 'iu').test(ws.name)));
        if (config?.target === 'ignore') continue;
        if (!config) {
            unresolved.push({ sheet: si + 1, row: 1, column: 1 });
            continue;
        }
        const headers = detectEnterpriseHeaders(ws, config);
        if (!headers.length) {
            unresolved.push({ sheet: si + 1, row: 1, column: 1 });
            continue;
        }
        const headerByRow = new Map(headers.map(h => [h.row, h]));
        let target: EnterpriseProfile['sheets'][number]['target'] = config.target;
        let headerEnd = 0;
        let headerStart = 0;
        let priceUnit: string | undefined;
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
            row.eachCell((c, cn) => { if (c.isMerged && c.master.address !== c.address) return; const value = text(c.value); if (value)
                cells.push({ column: cn, value }); });
            const header = headerByRow.get(rn);
            if (header) {
                columns = [];
                headerStart = rn;
                headerEnd = header.endRow;
                const fieldFor = (c: HeaderCell) => Object.hasOwn(config.columns, `@${rn}:${c.column}`) ? config.columns[`@${rn}:${c.column}`] : config.columns[normalizeHeader(c.header)];
                const priceHeaders = header.cells.filter(c => fieldFor(c) === 'price');
                priceUnit = priceHeaders.length === 1 ? headerPriceUnit(priceHeaders[0]!.header) : undefined;
                target = config.blockTargets && Object.hasOwn(config.blockTargets, String(rn)) ? config.blockTargets[String(rn)]! : config.target;
                if (target === null) unresolved.push({ sheet: si + 1, row: rn, column: 0 });
                if (target === 'ignore') return;
                for (const c of header.cells) {
                    const h = normalizeHeader(c.header);
                    if (excludedHeader(h)) continue;
                    const field = fieldFor(c);
                    if (field === 'ignore') continue;
                    if (field && ((controlOnlyFields.has(field) && target !== 'property_agreement_control') || (target === 'property_agreement_control' && !controlFields.has(field)))) unresolved.push({ sheet: si + 1, row: header.endRow, column: c.column });
                    else if (field) columns.push({ column: c.column, field });
                    else unresolved.push({ sheet: si + 1, row: header.endRow, column: c.column });
                }
                for (const c of columns) if (!['phone', 'email'].includes(c.field) && columns.filter(other => other.field === c.field).length > 1)
                    unresolved.push({ sheet: si + 1, row: header.endRow, column: c.column });
                blocks.push({ sheet: si + 1, row: rn, endRow: header.endRow, columns: [...columns] });
                sectionRow = rn;
                return;
            }
            if (rn <= headerEnd || target === 'ignore') return;
            if (cells.length <= 2 && cells.some(c => row.getCell(c.column).font?.bold)) {
                sectionMarkers.push({ sheet: si + 1, row: rn });
                const label = cells.map(c => c.value).join(' ');
                context = { ...config.defaults };
                for (const rule of config.sections)
                    if (new RegExp(rule.pattern, 'iu').test(label))
                        context = { ...context, ...rule };
                sectionRow = rn;
                return;
            }
            if (headerStart && cells.length) {
                const known = headers.find(h => h.row === headerStart)!;
                for (const c of cells) if (!known.cells.some(h => h.column === c.column)) {
                    const field = config.columns[`@${headerStart}:${c.column}`];
                    if (field && field !== 'ignore' && !((controlOnlyFields.has(field) && target !== 'property_agreement_control') || (target === 'property_agreement_control' && !controlFields.has(field)))) {
                        if (!columns.some(x => x.column === c.column)) columns.push({ column: c.column, field });
                    } else if (field !== 'ignore' && !unresolved.some(x => x.sheet === si + 1 && x.row === headerStart && x.column === c.column)) {
                        unresolved.push({ sheet: si + 1, row: headerStart, column: c.column });
                    }
                }
            }
            if (!target || !columns.length || !cells.length)
                return;
            const raw: Record<string, string> = {};
            for (const c of columns)
                raw[c.field] = [raw[c.field], text(row.getCell(c.column).value)].filter(Boolean).join('; ');
            const cc = [...new Map([raw.phone, raw.email].filter(Boolean).join(';').split(/[;,\n]+|\s\/\s/).flatMap(t => t.match(/[^\s<>;,]+@[^\s<>;,]+\.[^\s<>;,]+|\+?\d[\d() -]{8,}\d/g) ?? [t]).map(t => ({ ...contactKind(t.trim()), raw: t.trim() })).filter(c => c.normalized).map(c => [c.normalized, c])).values()];
            const operation = raw.operationText || (target === 'client_request_need' ? raw.request : '') || '';
            const op = /аренд|rent/i.test(operation) ? 'rent' : /прод|куп|sale/i.test(operation) ? 'sale' : context.operationType;
            const floor = /^(\d+)(?:\/(\d+))?/.exec(raw.floor ?? '');
            const dateColumn = columns.find(c => c.field === 'receivedDate');
            const dateCell = dateColumn ? row.getCell(dateColumn.column).value : null;
            const dateValue = dateCell && typeof dateCell === 'object' && ('formula' in dateCell || 'sharedFormula' in dateCell) ? dateCell.result : dateCell;
            const received = parseDate(typeof dateValue === 'number' && wb.properties.date1904 ? dateValue + 1462 : dateValue as string | number | Date);
            const linkColumn = columns.find(c => c.field === 'description');
            const hyperlink = linkColumn ? row.getCell(linkColumn.column).hyperlink : undefined;
            const safeLink = hyperlink && /^https?:\/\//i.test(hyperlink) && !/^https?:\/\/[^/]*@/i.test(hyperlink) ? hyperlink : null;
            const control = target === 'property_agreement_control';
            const presenceText = (raw.agreementPresence ?? '').trim().toLowerCase();
            const presence = /^(да|есть|\+|имеется|yes|true)$/.test(presenceText) ? true : /^(нет|отсутствует|-|no|false)$/.test(presenceText) ? false : null;
            const commissionFrom = parseWorkbookNumber(raw.commissionFrom), commissionTo = parseWorkbookNumber(raw.commissionTo);
            const adPlatform = closedAdCode(raw.adPlatform, controlAdPlatforms, controlAdPlatformLabels, config.adPlatformMap);
            const adStatus = closedAdCode(raw.adStatus, controlAdStatuses, controlAdStatusLabels, config.adStatusMap)
                ?? (normalizeHeader(raw.adStatus) === 'not published' ? 'draft' : null);
            const controlLink = raw.adUrl?.trim() ?? '';
            const safeAdUrl = /^https?:\/\/\S+$/i.test(controlLink) && !/^https?:\/\/[^/]*@/i.test(controlLink) ? controlLink : null;
            const rec: Record<string, unknown> = { addressText: raw.addressText || null, district: raw.district || context.district || null, area: parseWorkbookNumber(raw.area), price: parseWorkbookNumber(raw.price), floor: floor ? Number(floor[1]) : null, floorsTotal: floor?.[2] ? Number(floor[2]) : null, propertyType: context.propertyType, operationType: target === 'client_request_need' ? (/сда|lease_out/i.test(operation) ? 'lease_out' : /куп|buy/i.test(operation) ? 'buy' : /прод|sell/i.test(operation) ? 'sell' : op === 'rent' ? 'rent' : null) : op, sourceType: 'agency_listing', description: raw.description?.replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '[контакт скрыт]') || null, sourceUrl: safeLink, commercialPurpose: config.purposeMap[normalizeHeader(raw.propertyTypeText)] ?? null, extraAttributes: raw.propertyTypeText ? { purposeText: raw.propertyTypeText } : undefined, name: raw.name || null, receivedAt: received, comment: [raw.request, raw.comment].filter(Boolean).join('; ') || null, channelCode: 'other', sourceCode: config.sourceMap[normalizeHeader(raw.source)] ?? 'other', needStatus: 'active', contacts: cc, coordinatesRaw: cc[0]?.raw ?? null, coordinatesNormalized: cc[0]?.normalized ?? null, coordinatesKind: cc[0]?.type ?? null, sourceRowId: raw.sourceRowId || null, objectText: raw.addressText || null, contractRef: raw.contractRef || null, commissionAmount: parseWorkbookNumber(raw.commissionAmount), dealDate: received, participantName: raw.name || null, priceUnit: raw.priceUnit || priceUnit || context.priceUnit || (op === 'sale' ? 'rub_total' : null), status: row.hidden ? 'archived' : config.statusMap[normalizeHeader(raw.stateMark)] ?? 'active', responsibleUserId: config.responsibleMap[normalizeHeader(raw.responsible)] ?? null, owner: raw.ownerName && raw.ownerPhone && contactKind(raw.ownerPhone).type === 'phone' ? { name: raw.ownerName, phone: contactKind(raw.ownerPhone).normalized } : null, ...(control ? { agreementPresent: presence, absenceReason: maskContacts(raw.absenceReason), commissionFrom, commissionTo, fixNote: maskContacts(raw.fixNote), adText: maskContacts(raw.adText), adUrl: safeAdUrl, taskText: null, actuality: raw.stateMark || null } : {}) };
            const keyFields = target === 'client_request_need' ? [cc.map(c => c.normalized).sort(), received] : [normalizeAddress(raw.addressText ?? ''), rec.area, op ?? '', target === 'historical_deal_archive' ? raw.sourceRowId : ''];
            const key = sha256(JSON.stringify([si + 1, target, keyFields]));
            const errors: string[] = [];
            if(raw.area&&(rec.area===null||rec.area==='0'||String(rec.area).split('.')[0]!.length>10))errors.push('INVALID_AREA');
            if(raw.commissionAmount&&rec.commissionAmount===null)errors.push('INVALID_COMMISSION');
            if(raw.floor&&!floor)errors.push('INVALID_FLOOR');
            if(rec.price&&String(rec.price).split('.')[0]!.length>14)errors.push('INVALID_PRICE');
            if(rec.priceUnit&&!['rub_total','rub_month','rub_m2','rub_m2_month','rub_year','rub_m2_year'].includes(String(rec.priceUnit)))errors.push('INVALID_PRICE_UNIT');
            if (control) {
                rec.adPlatform = adPlatform;
                rec.adStatus = adStatus;
                if (raw.adPlatform && !adPlatform) errors.push('UNMAPPED_AD_PLATFORM');
                if (raw.adStatus && !adStatus) errors.push('UNMAPPED_AD_STATUS');
                if (rec.commissionAmount !== null && String(rec.commissionAmount).split('.')[0]!.length > 14) errors.push('INVALID_COMMISSION');
                if (!rec.addressText) errors.push('MISSING_ADDRESS');
                if (!op) errors.push('OPERATION_REQUIRED');
                if (presence === null) errors.push('INVALID_AGREEMENT_PRESENCE');
                if (raw.adUrl && !safeAdUrl) errors.push('INVALID_AD_URL');
                if ((raw.commissionFrom && commissionFrom === null) || (raw.commissionTo && commissionTo === null)) errors.push('INVALID_COMMISSION');
                else if (commissionFrom !== null && commissionTo !== null && Number(commissionFrom) > Number(commissionTo)) errors.push('INVALID_COMMISSION_RANGE');
            }
            if ((target === 'property' || control) && raw.price && op === 'rent' && !raw.priceUnit && !priceUnit && !context.priceUnit)
                errors.push('PRICE_UNIT_REQUIRED');
            if (target === 'property' && (!rec.addressText || !rec.area || !op))
                errors.push('MISSING_PROPERTY_KEY');
            if (target === 'client_request_need' && (!rec.name || !cc.length))
                errors.push('MISSING_CLIENT_KEY');
            if (target === 'historical_deal_archive' && !rec.objectText)
                errors.push('MISSING_ADDRESS');
            if (raw.price && rec.price === null)
                errors.push('INVALID_PRICE');
            if (raw.receivedDate && !received)
                errors.push('INVALID_DATE');
            const skipped = row.hidden && config.hiddenRows === 'skip';
            const warningCodes = row.hidden ? ['HIDDEN_ROW'] : [];
            if (control) {
                rec.taskText = maskContacts(raw.taskText);
                if ((raw.adText || raw.adUrl || raw.adPlatform || raw.adStatus) && (!adPlatform || !adStatus)) warningCodes.push('AD_DETAILS_REQUIRED');
                if (presence === true) warningCodes.push('AGREEMENT_DETAILS_REQUIRED');
            }
            if ((raw.responsible && !rec.responsibleUserId) || (raw.source && !config.sourceMap[normalizeHeader(raw.source)]) || (raw.stateMark && !config.statusMap[normalizeHeader(raw.stateMark)]) || ((raw.ownerName || raw.ownerPhone) && !rec.owner))
                warningCodes.push('REQUIRES_MANUAL_REVIEW');
            rows.push({ sheetIndex: si + 1, hidden: row.hidden, sectionRow, columns: [...columns], sheetName: `sheet:${si + 1}`, sectionKey: `${si + 1}:${sectionRow}`, profileCode: p.code, rowNumber: rn, recordKey: key, target, validationStatus: skipped ? 'skipped_policy' : errors.length ? 'invalid' : warningCodes.length ? 'warning' : 'ready', errorCodes: errors, warningCodes, record: rec, dedupe: { phones: cc.filter(c => c.type === 'phone').map(c => c.normalized!), emails: cc.filter(c => c.type === 'email').map(c => c.normalized!), addressKey: rec.addressText ? normalizeAddress(String(rec.addressText)) : null, archiveKey: target === 'historical_deal_archive' ? key : null } });
        });
    }
    return { rows, unresolved, blocks, sectionMarkers };
}
