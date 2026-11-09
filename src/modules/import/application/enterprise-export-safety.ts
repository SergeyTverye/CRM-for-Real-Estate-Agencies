import type ExcelJS from 'exceljs';

export function evaluateExportFormula(expression: string, cells: ReadonlyMap<string, number>): number {
    if (expression.length > 512 || /[^\x20-\x7e]/.test(expression)) throw new Error('UNSUPPORTED');
    const tokens = expression.toUpperCase().match(/\$?[A-Z]{1,3}\$?[1-9]\d{0,6}|SUM|\d+(?:\.\d+)?|[()+\-*/,:]|\S/g) ?? [];
    if (tokens.length > 128) throw new Error('UNSUPPORTED');
    let pos = 0, depth = 0, reads = 0;
    const ref = (t: string) => /^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/.test(t);
    const read = (t: string) => {
        if (++reads > 256) throw new Error('UNSUPPORTED');
        const value = cells.get(t.replaceAll('$', ''));
        if (value === undefined || !Number.isFinite(value)) throw new Error('DEPENDENCY');
        return value;
    };
    const take = (t: string) => { if (tokens[pos++] !== t) throw new Error('UNSUPPORTED'); };
    function primary(): number {
        if (++depth > 32) throw new Error('UNSUPPORTED');
        const t = tokens[pos++];
        let value: number;
        if (t === '+' || t === '-') value = (t === '-' ? -1 : 1) * primary();
        else if (t === '(') { value = expressionValue(); take(')'); }
        else if (t === 'SUM') {
            take('('); value = 0;
            do {
                if (tokens[pos] === ',') pos++;
                if (ref(tokens[pos] ?? '') && tokens[pos + 1] === ':') {
                    const start = tokens[pos++]!.replaceAll('$', ''); pos++;
                    const end = tokens[pos++]?.replaceAll('$', '') ?? '';
                    const a = /^([A-Z]+)(\d+)$/.exec(start), b = /^([A-Z]+)(\d+)$/.exec(end);
                    if (!a || !b || a[1] !== b[1] || +b[2]! < +a[2]! || +b[2]! - +a[2]! > 255) throw new Error('UNSUPPORTED');
                    for (let n = +a[2]!; n <= +b[2]!; n++) value += read(`${a[1]}${n}`);
                } else value += expressionValue();
            } while (tokens[pos] === ',');
            take(')');
        } else if (t && ref(t)) value = read(t);
        else if (t && /^\d+(?:\.\d+)?$/.test(t)) value = Number(t);
        else throw new Error('UNSUPPORTED');
        depth--; return value;
    }
    function product(): number {
        let value = primary();
        while (tokens[pos] === '*' || tokens[pos] === '/') { const op = tokens[pos++]; const rhs = primary(); value = op === '*' ? value * rhs : value / rhs; }
        return value;
    }
    function expressionValue(): number {
        let value = product();
        while (tokens[pos] === '+' || tokens[pos] === '-') { const op = tokens[pos++]; const rhs = product(); value = op === '+' ? value + rhs : value - rhs; }
        return value;
    }
    const value = expressionValue();
    if (pos !== tokens.length || !Number.isFinite(value)) throw new Error('UNSUPPORTED');
    return value;
}

export function safeExportUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value) || !/^https?:\/\//i.test(value)) return null;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? value : null; }
    catch { return null; }
}

export type FormulaCandidate = { cell: ExcelJS.Cell; expression?: string; shared: boolean };
export function restoreExportFormulas(candidates: FormulaCandidate[], allowed: ReadonlyMap<ExcelJS.Cell, number>, report: Record<string, number>) {
    const formulaCells = new Set(candidates.map(c => c.cell));
    const sheets = new Map<ExcelJS.Worksheet, Map<string, number>>();
    for (const [cell, value] of allowed) {
        if (formulaCells.has(cell)) continue;
        if (!sheets.has(cell.worksheet)) sheets.set(cell.worksheet, new Map());
        sheets.get(cell.worksheet)!.set(cell.address, value);
    }
    for (const { cell, expression, shared } of candidates) {
        const count = (code: string) => { report[code] = (report[code] ?? 0) + 1; };
        const expected = allowed.get(cell);
        if (shared) { count('FORMULA_SHARED_UNSUPPORTED'); continue; }
        if (expected === undefined) { count('FORMULA_CELL_NOT_ALLOWED'); continue; }
        const dependencies = sheets.get(cell.worksheet) ?? new Map<string, number>();
        try {
            const result = evaluateExportFormula(expression ?? '', dependencies);
            if (result !== expected) { count('FORMULA_VALUE_MISMATCH'); continue; }
            cell.value = { formula: expression!, result: expected };
            count('FORMULA_PRESERVED'); report.FORMULA_CLEARED!--;
        } catch (error) { count(error instanceof Error && error.message === 'DEPENDENCY' ? 'FORMULA_DEPENDENCY_REJECTED' : 'FORMULA_UNSUPPORTED'); }
    }
}
