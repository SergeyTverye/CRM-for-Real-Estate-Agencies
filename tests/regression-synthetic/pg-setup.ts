import pg from 'pg';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function setup(project: { config: { env: Record<string, string> } }) {
  const url = new URL(project.config.env.SYNTHETIC_CONTROL_DATABASE_URL!);
  const name = url.pathname.slice(1);
  if (!/^synthetic_final_regression_test_[0-9a-f]{32}$/.test(name) || url.host !== '127.0.0.1:55432') throw Error('UNSAFE_SYNTHETIC_DATABASE');
  const admin = new pg.Client({ connectionString: 'postgresql://crm:crm_test_password@127.0.0.1:55432/postgres', connectionTimeoutMillis: 3000 });
  let created = false;
  const evidence: Record<string, unknown> = { database: name, node: process.version, abi: process.versions.modules, startedAt: new Date().toISOString(), created: false, dropped: false };
  const save = () => writeFileSync(project.config.env.REGRESSION_EVIDENCE_PATH!, JSON.stringify(evidence, null, 2));
  try {
    await admin.connect();
    evidence.postgres = (await admin.query('SHOW server_version')).rows[0].server_version;
    await admin.query(`CREATE DATABASE "${name}"`); created = true; evidence.created = true;
    const client = new pg.Client({ connectionString: url.toString() });
    try {
      await client.connect();
      const migrations = readdirSync('prisma/migrations').filter(n => /^\d/.test(n)).sort();
      for (const migration of migrations) await client.query(readFileSync(join('prisma/migrations', migration, 'migration.sql'), 'utf8'));
      evidence.migrations = migrations;
    } finally { await client.end(); }
    save();
  } catch (error) {
    evidence.setupErrorCode = (error as { code?: string }).code ?? 'SETUP_FAILED';
    if (created) { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); evidence.dropped = true; }
    await admin.end(); save(); throw Error(String(evidence.setupErrorCode));
  }
  return async () => {
    try { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); evidence.dropped = true; evidence.absentAfterDrop = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 0; }
    finally { await admin.end(); evidence.finishedAt = new Date().toISOString(); save(); }
  };
}
