import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function setup(project: { config: { env: Record<string, string> } }) {
    const url = project.config.env.SYNTHETIC_CONTROL_DATABASE_URL!;
    const name = new URL(url).pathname.slice(1);
    if (!/^synthetic_enterprise_control_test_[0-9a-f]{32}$/.test(name) || new URL(url).host !== '127.0.0.1:55432') throw new Error('UNSAFE_SYNTHETIC_DATABASE');
    const admin = new pg.Client({ connectionString: 'postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test', connectionTimeoutMillis: 3000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const client = new pg.Client({ connectionString: url });
    try {
        await client.connect();
        for (const migration of readdirSync('prisma/migrations').filter(n => /^\d/.test(n)).sort()) {
            await client.query(readFileSync(join('prisma/migrations', migration, 'migration.sql'), 'utf8'));
        }
    } catch (error) {
        await client.end();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
        throw error;
    }
    await client.end();
    return async () => {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
    };
}
