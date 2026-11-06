// TRUSTED LOCAL ONLY. This command is never run by an agent against a private workbook.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { tsImport } from 'tsx/esm/api';
const root = resolve('private-data');
const outIndex = process.argv.indexOf('--out');
const out = resolve(outIndex>=0 ? process.argv[outIndex + 1]??'private-data/enterprise-profile.json' : 'private-data/enterprise-profile.json');
const rel = relative(root, out);
if (!rel || rel.startsWith('..') || isAbsolute(rel) || !out.endsWith('.json')) {
    console.error('INVALID_PRIVATE_OUTPUT');
    process.exit(1);
}
try {
    const { readFile } = await import('node:fs/promises');
    const { loadEnterprise, buildProfile, parseEnterprise } = await tsImport('../../src/modules/import/domain/enterprise-workbook.ts', import.meta.url);
    const wb = await loadEnterprise(await readFile(process.argv[2]));
    const profile = buildProfile(wb);
    await mkdir(dirname(out), { recursive: true, mode: 0o700 });
    await writeFile(out, JSON.stringify(profile, null, 2), { mode: 0o600 });
    const parsed = parseEnterprise(wb, profile);
    console.log(JSON.stringify({ sheets: profile.sheets.length, classes: profile.sheets.map(s => s.target), rows: parsed.rows.length, unresolved: parsed.unresolved }));
}
catch {
    console.error('PROFILE_BUILD_FAILED');
    process.exit(1);
}
