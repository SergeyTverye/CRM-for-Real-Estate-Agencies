import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const runtimeEntries = Object.freeze({
  'workers/notifications.cjs': 'src/worker/notifications-worker.ts',
  'workers/search.cjs': 'src/worker/property-search-worker.ts',
  'workers/backup.cjs': 'scripts/desktop/runtime/backup-worker.ts',
  'init-db.cjs': 'scripts/desktop/init-db.ts',
  'upgrade.cjs': 'scripts/desktop/runtime/upgrade.ts',
  'backup-command.cjs': 'scripts/desktop/runtime/backup-command.ts',
  'backup-now.cjs': 'scripts/desktop/runtime/backup-now.ts',
  'generated/sqlite/client.cjs': 'src/generated/prisma-sqlite/client.ts',
});

export const runtimeBuildOptions = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  packages: 'external', tsconfig: 'tsconfig.json', logLevel: 'warning',
  define: { 'import.meta.url': '__crmModuleUrl' },
  banner: { js: "const __crmModuleUrl = require('node:url').pathToFileURL(__filename).href;" },
};

export function assertRuntimeEntries({ tracked = false } = {}) {
  for (const entry of Object.values(runtimeEntries)) {
    if (!existsSync(entry)) throw Error('RUNTIME_ENTRY_MISSING:' + entry);
    if (tracked && !entry.startsWith('src/generated/')) {
      const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', entry], { stdio: 'ignore', windowsHide: true });
      if (result.error || result.status !== 0) throw Error('RUNTIME_ENTRY_NOT_TRACKED:' + entry);
    }
  }
}
