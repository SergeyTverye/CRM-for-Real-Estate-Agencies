// TRUSTED LOCAL ONLY. Agents/CI must use synthetic input exclusively.
// --diagnostic is read-only: fixed semantic codes, coordinates and counts only.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { tsImport } from 'tsx/esm/api';
const output = process.stdout.write.bind(process.stdout);
const errorOutput = process.stderr.write.bind(process.stderr);
// Dependencies must not print workbook names, paths or error messages.
process.stdout.write = () => true;
process.stderr.write = () => true;
try {
    const args = process.argv.slice(2);
    const diagnostic = args.length === 2 && args[1] === '--diagnostic';
    if (!diagnostic && !(args.length === 1 || (args.length === 3 && args[1] === '--out'))) throw new Error();
    const root = resolve('private-data');
    const out = resolve(args[2] ?? 'private-data/enterprise-profile.json');
    const rel = relative(root, out);
    if (!diagnostic && (!rel || rel.startsWith('..') || isAbsolute(rel) || !out.endsWith('.json') || resolve(args[0]) === out)) throw new Error();
    // file: URL is required by the ESM loader on Windows (a native D: path fails).
    const modulePath = new URL('../../src/modules/import/domain/enterprise-workbook.ts', import.meta.url).href;
    const { loadEnterprise, buildProfile, parseEnterprise, detectEnterpriseHeaders, fields, excludedHeader } = await tsImport(modulePath, import.meta.url);
    const wb = await loadEnterprise(await readFile(args[0]));
    const profile = buildProfile(wb);
    const parsed = parseEnterprise(wb, profile);
    if (!diagnostic) {
        await mkdir(dirname(out), { recursive: true, mode: 0o700 });
        await writeFile(out, JSON.stringify(profile, null, 2), { mode: 0o600, flag: 'wx' });
    }
    const targets = { property: 'TARGET_PROPERTY', client_request_need: 'TARGET_CLIENT', historical_deal_archive: 'TARGET_HISTORY' };
    const codes = new Map(fields.map(f => [f, `FIELD_${f.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`]));
    const allowedErrors = ['INVALID_AREA', 'INVALID_COMMISSION', 'INVALID_FLOOR', 'INVALID_PRICE', 'INVALID_PRICE_UNIT', 'PRICE_UNIT_REQUIRED', 'MISSING_PROPERTY_KEY', 'MISSING_CLIENT_KEY', 'MISSING_ADDRESS', 'INVALID_DATE', 'HIDDEN_ROW', 'REQUIRES_MANUAL_REVIEW'];
    const report = {
        sheets: wb.worksheets.map((ws, i) => ({
            sheet: i + 1, code: targets[profile.sheets[i].target] ?? 'TARGET_UNRESOLVED',
            headers: detectEnterpriseHeaders(ws).map(h => ({ row: h.row, endRow: h.endRow, code: targets[h.target] ?? 'TARGET_UNRESOLVED',
                columns: h.cells.map(c => ({ column: c.column, code: excludedHeader(c.header) ? 'FIELD_POLICY_EXCLUDED' : codes.get(c.field) ?? 'FIELD_UNRESOLVED' })) })),
            recognized: parsed.rows.filter(r => r.sheetIndex === i + 1).length,
            rejected: parsed.rows.filter(r => r.sheetIndex === i + 1 && r.validationStatus === 'invalid').length,
            skipped: parsed.rows.filter(r => r.sheetIndex === i + 1 && r.validationStatus === 'skipped_policy').length,
            codes: Object.fromEntries(allowedErrors.map(code => [code, parsed.rows.filter(r => r.sheetIndex === i + 1 && (r.errorCodes.includes(code) || r.warningCodes.includes(code))).length])),
        })),
        unresolved: parsed.unresolved,
    };
    output(`${JSON.stringify(report)}\n`);
} catch {
    errorOutput('PROFILE_BUILD_FAILED\n');
    process.exitCode = 1;
}
