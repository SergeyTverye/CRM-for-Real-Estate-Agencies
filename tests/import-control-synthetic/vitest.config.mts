import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';


const backend = process.env.SYNTHETIC_CONTROL_BACKEND ?? 'sqlite';
if (!['sqlite', 'pg', 'unit'].includes(backend)) throw new Error('EXPLICIT_SYNTHETIC_BACKEND_REQUIRED');
const dir = mkdtempSync(join(tmpdir(), 'crm-control-synthetic-'));
const name = `synthetic_enterprise_control_test_${randomUUID().replaceAll('-', '')}`;
const url = backend === 'pg' ? `postgresql://crm:crm_test_password@127.0.0.1:55432/${name}` : `file:${join(dir, 'unit.db')}`;
export default defineConfig({
    resolve: { alias: { '@': resolve('src') } },
    test: {
        include: backend === 'unit' ? ['tests/unit/enterprise*.test.ts'] : ['tests/integration/enterprise-control-v2.test.ts', 'tests/integration/enterprise-workbook.test.ts', 'tests/integration/enterprise-export-roundtrip.test.ts'],
        environment: 'node', fileParallelism: false, maxWorkers: 1, testTimeout: 30000, hookTimeout: 60000,
        globalSetup: backend === 'pg' ? ['tests/import-control-synthetic/pg-setup.ts'] : backend === 'sqlite' ? ['tests/sqlite/global-setup.ts'] : [],
        setupFiles: backend === 'sqlite' ? ['tests/sqlite/setup.ts'] : [],
        env: {
            NODE_ENV: 'test', CRM_DEPLOYMENT_MODE: backend === 'pg' ? 'server' : 'desktop', DATABASE_URL: url,
            SYNTHETIC_CONTROL_DATABASE_URL: url, SQLITE_TEST_TEMPLATE: join(dir, 'template.db'),
            FILE_STORAGE_PATH: join(dir, 'files'), IMPORT_STAGING_PATH: join(dir, 'staging'), BACKUP_PATH: join(dir, 'backups'),
            LOG_LEVEL: 'silent', AI_ENABLED: 'false', SCRAPER_ENABLED: 'false', MAX_UPLOAD_MB: '2',
        },
    },
});
