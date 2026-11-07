import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

export function syntheticConfig(backend: 'pg' | 'sqlite') {
  const root = process.env.REGRESSION_ROOT;
  const result = process.env.REGRESSION_RESULTS_PATH;
  const chrome = process.env.REGRESSION_CHROME_PATH;
  const database = process.env.SYNTHETIC_CONTROL_DATABASE_URL;
  if (!root || !result || !chrome || !existsSync(chrome) || !database) throw Error('SYNTHETIC_RUNNER_REQUIRED');
  return {
    resolve: { alias: { '@': resolve('src') } },
    test: {
      include: ['tests/integration/**/*.test.ts', 'tests/authorization/**/*.test.ts', ...(backend === 'sqlite' ? ['tests/sqlite/**/*.test.ts'] : [])],
      // Exactly two cases in this file write private-data/verify-tmp. Never collect it.
      exclude: ['tests/integration/private-workbook-verifier.test.ts'],
      environment: 'node' as const, fileParallelism: false, maxWorkers: 1,
      testTimeout: backend === 'pg' ? 45000 : 30000, hookTimeout: 60000,
      globalSetup: backend === 'pg' ? ['tests/regression-synthetic/pg-setup.ts'] : ['tests/sqlite/global-setup.ts'],
      setupFiles: [...(backend === 'sqlite' ? ['tests/sqlite/setup.ts'] : []), 'tests/regression-synthetic/browser-path.ts'],
      reporters: ['tests/regression-synthetic/safe-reporter.mjs'],
      env: {
        NODE_ENV: 'test' as const, CRM_DEPLOYMENT_MODE: backend === 'pg' ? 'server' : 'desktop',
        DATABASE_URL: backend === 'pg' ? database : `file:${join(root, 'initial.db')}`,
        TEST_DATABASE_URL: database, SYNTHETIC_CONTROL_DATABASE_URL: database,
        REGRESSION_ROOT: root, REGRESSION_RESULTS_PATH: result,
        REGRESSION_EVIDENCE_PATH: process.env.REGRESSION_EVIDENCE_PATH!,
        SQLITE_TEST_TEMPLATE: join(root, 'sqlite-template.db'),
        APP_TIMEZONE: 'Asia/Novosibirsk', FILE_STORAGE_PATH: join(root, 'files'),
        IMPORT_STAGING_PATH: join(root, 'staging'), BACKUP_PATH: join(root, 'backups'),
        BACKUP_SETTINGS_DIR: join(root, 'settings'), DESKTOP_DATA_DIR: join(root, 'desktop'),
        LOG_LEVEL: 'silent', AI_ENABLED: 'false', SCRAPER_ENABLED: 'false',
        SCRAPER_DEMO_FIXTURES: 'false', MAX_UPLOAD_MB: '2', SCRAPER_CHROME_PATH: chrome,
      },
    },
  };
}
