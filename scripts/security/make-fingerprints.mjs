// TRUSTED LOCAL TOOL. Never invoke on enterprise data from an agent or CI.
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, lstat, rename, readFile } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cellForms, sha256, textForms } from './fingerprint-core.mjs';

try {
  const args = process.argv.slice(2);
  let input;
  let publicDirectory;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exclude-public' && args[i + 1] && !publicDirectory) publicDirectory = resolve(args[++i]);
    else if (!args[i].startsWith('--') && !input) input = resolve(args[i]);
    else throw new Error('ARGS');
  }
  if (!input || process.env.CI) throw new Error('LOCAL_ONLY');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input);
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
  const total = hashes.size;
  if (publicDirectory) {
    const git = (...arguments_) => execFileSync('git', ['-C', publicDirectory, ...arguments_], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const root = git('rev-parse', '--show-toplevel').trim();
    const names = git('ls-files', '-z', '--', '*.md', '*.ts', '*.tsx', '*.json', '*.mjs', '*.yaml').split('\0').filter(Boolean);
    for (const name of names) {
      // Even accidentally tracked private files must never become a public dictionary.
      const normalized = name.replaceAll('\\', '/').normalize('NFKC').toLowerCase();
      if (/(?:^|\/)(?:private-data|crm-secrets|private-imports|\.git|\.aws)(?:\/|$)/u.test(normalized)) continue;
      if (!/\.(?:md|ts|tsx|json|mjs|yaml)$/u.test(normalized)) continue;
      const absolute = resolve(publicDirectory, name);
      const inside = relative(root, absolute);
      if (inside.startsWith('..') || !inside) throw new Error('PUBLIC_SCOPE');
      let current = root;
      for (const part of inside.split(sep)) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error('PUBLIC_SYMLINK');
      }
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('PUBLIC_FILE');
      // Retain only source hashes; do not store plaintext or a repository-sized dictionary.
      for (const form of textForms(await readFile(absolute, 'utf8'))) hashes.delete(sha256(form));
    }
  }
  await mkdir('private-data', { recursive: true, mode: 0o700 });
  if ((await lstat('private-data')).isSymbolicLink()) throw new Error('OUTPUT_PATH');
  const temporary = 'private-data/.fingerprints-' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify([...hashes].sort()) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, 'private-data/fingerprints.json');
  console.log(total + ' / ' + (total - hashes.size) + ' / ' + hashes.size);
} catch {
  // No library exceptions, paths or cell values in output.
  process.exitCode = 1;
}
