import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';

const MARKER = '# CRM confidential guard v1';
try {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const root = git('rev-parse', '--show-toplevel');
  let customHooks = '';
  try { customHooks = git('config', '--get', 'core.hooksPath'); } catch { /* Unset is normal. */ }
  if (customHooks) throw new Error('HOOKS_PATH');
  const hooks = path.resolve(root, git('rev-parse', '--git-path', 'hooks'));
  const hook = path.join(hooks, 'pre-commit');
  let previous = '';
  try { previous = await readFile(hook, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && !previous.includes(MARKER)) throw new Error('HOOK_EXISTS');
  await mkdir(hooks, { recursive: true });
  await writeFile(hook, [
    '#!/bin/sh', MARKER,
    'root=$(git rev-parse --show-toplevel) || exit 1',
    'cd "$root" || exit 1',
    'exec node scripts/security/confidential-guard.mjs',
    '',
  ].join('\n'), { mode: 0o755 });
  await chmod(hook, 0o755);
  console.log('CG_HOOK_INSTALLED .git/hooks/pre-commit');
} catch {
  console.log('CG_HOOK_INSTALL_FAILED .git/hooks/pre-commit');
  process.exitCode = 1;
}
