// TRUSTED LOCAL TOOL. Never invoke on enterprise data from an agent or CI.
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, lstat, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cellForms, sha256 } from './fingerprint-core.mjs';

try {
  if (process.argv.length !== 3 || process.env.CI) throw new Error('LOCAL_ONLY');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(process.argv[2]));
  const hashes = new Set();
  const add = (value) => {
    if (value == null) return;
    if (typeof value === 'object') {
      if (value instanceof Date) add(value.toISOString());
      else if ('richText' in value) add(value.richText.map((part) => part.text).join(''));
      else {
        if ('result' in value) add(value.result);
        if ('text' in value) add(value.text);
      }
      return;
    }
    for (const form of cellForms(value)) hashes.add(sha256(form));
  };
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => add(cell.value))));
  await mkdir('private-data', { recursive: true, mode: 0o700 });
  if ((await lstat('private-data')).isSymbolicLink()) throw new Error('OUTPUT_PATH');
  const temporary = 'private-data/.fingerprints-' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify([...hashes].sort()) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, 'private-data/fingerprints.json');
  console.log(hashes.size);
} catch {
  // No library exceptions, paths or cell values in output.
  process.exitCode = 1;
}
