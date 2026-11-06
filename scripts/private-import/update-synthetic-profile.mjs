import { writeFile, readFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { z } from 'zod';
const m = await tsImport('../../src/modules/import/domain/enterprise-workbook.ts', import.meta.url);
const wb = await m.loadEnterprise(await readFile('tests/fixtures/synthetic/enterprise-workbook.xlsx'));
await writeFile('import-profiles/enterprise_workbook_v2.schema.json', JSON.stringify(z.toJSONSchema(m.enterpriseProfileSchema), null, 2));
await writeFile('import-profiles/enterprise_workbook_v2.synthetic.json', JSON.stringify({ ...m.buildProfile(wb), sheets: m.buildProfile(wb).sheets.map(s => ({ ...s, defaults: { ...s.defaults, priceUnit: 'rub_month' } })) }, null, 2));
