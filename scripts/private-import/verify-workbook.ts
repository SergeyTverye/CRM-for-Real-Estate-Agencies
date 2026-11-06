/** Trusted LOCAL runner. Never run with a confidential input from an agent/CI. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { resolve, join, sep, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Actor } from '../../src/modules/auth/domain/actor';

// Deny diagnostic output at the process boundary, including dependency errors.
// Only the final allowlisted numeric report uses the saved writer.
const output = process.stdout.write.bind(process.stdout);
process.stdout.write = (() => true) as typeof process.stdout.write;
process.stderr.write = (() => true) as typeof process.stderr.write;
const report = {
  checks: {} as Record<string, number>, errors: {} as Record<string, number>,
  codes: {} as Record<string, number>, sheets: [] as { sheet: number; recognized: number; imported: number; excluded: number; rejected: number; duplicates: number }[],
  unresolved: [] as { sheet: number; row: number; column: number }[],
  preservation: {} as Record<string, { matched: number; mismatched: number }>,
  compatibility: {} as Record<string, number>,
};
const allowedCodes = new Set(['INVALID_AREA', 'INVALID_COMMISSION', 'INVALID_FLOOR', 'INVALID_PRICE', 'INVALID_PRICE_UNIT', 'PRICE_UNIT_REQUIRED', 'MISSING_PROPERTY_KEY', 'MISSING_CLIENT_KEY', 'MISSING_ADDRESS', 'INVALID_DATE', 'HIDDEN_ROW', 'REQUIRES_MANUAL_REVIEW', 'already_imported', 'probable_duplicate']);
const allowedCompatibility = new Set(['UNSUPPORTED_COLUMN', 'UNSUPPORTED_FIELD', 'FORMULA_CLEARED', 'NUMBER_AS_TEXT', 'IMAGE_PRESERVED', 'HYPERLINK_PRESERVED', 'HYPERLINK_CLEARED']);
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function assert(check: string, condition: boolean): asserts condition {
  report.checks[check] = Number(condition);
  if (!condition) throw new Error('VERIFY_FAILED');
}

async function main() {
  let stage = 'ARGUMENTS_FAILED';
  let directory: string | undefined, input: string | undefined, checksum: string | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let admin: import('pg').Client | undefined;
  let locked = false, databaseCreated = false;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 5 || args[1] !== '--profile' || args[3] !== '--backend' || !['pg', 'sqlite'].includes(args[4]!)) throw new Error();
    input = await realpath(resolve(args[0]!));
    const root = resolve('private-data/verify-tmp');
    if (input.startsWith(root + sep)) throw new Error();
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Refuse a redirected private workspace. Cleanup must never traverse outside it.
    if ((await realpath(root)).toLowerCase() !== root.toLowerCase()) throw new Error();
    directory = await mkdtemp(join(root, `run-${process.pid}-`));
    const bytes = await readFile(input);
    checksum = digest(bytes);
    const rawProfile: unknown = JSON.parse(await readFile(resolve(args[2]!), 'utf8'));
    const backend = args[4];
    const url = backend === 'pg' ? new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_d') : null;
    if (url && (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55432')) throw new Error();
    if (url) url.pathname = '/crm_private_verify';
    Object.assign(process.env, {
      NODE_ENV: 'test', CRM_DEPLOYMENT_MODE: backend === 'sqlite' ? 'desktop' : 'server',
      DATABASE_URL: url?.toString() ?? 'file:' + join(directory, 'verify.db'),
      FILE_STORAGE_PATH: join(directory, 'files'), IMPORT_STAGING_PATH: join(directory, 'staging'), BACKUP_PATH: join(directory, 'backups'),
      LOG_LEVEL: 'silent', AI_ENABLED: 'false', SCRAPER_ENABLED: 'false', MAX_UPLOAD_MB: '30',
    });
    stage = 'MIGRATION_FAILED';
    if (url) {
      const { Client } = await import('pg');
      const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
      admin = new Client({ connectionString: adminUrl.toString() });
      await admin.connect();
      const lock = await admin.query('SELECT pg_try_advisory_lock(3221223) AS acquired');
      if (!lock.rows[0]?.acquired) throw new Error();
      locked = true;
      // Exact isolated test DB only; no production/test-suite schema is modified.
      await admin.query('DROP DATABASE IF EXISTS crm_private_verify WITH (FORCE)');
      await admin.query('CREATE DATABASE crm_private_verify');
      databaseCreated = true;
      execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', timeout: 120000 });
    } else {
      const { applySqliteMigrations } = await import('../desktop/database-lifecycle');
      applySqliteMigrations(join(directory, 'verify.db'));
    }
    const { db, disconnectDb } = await import('../../src/shared/db/client');
    disconnect = disconnectDb;
    const { DICTIONARY_SEED } = await import('../../src/modules/dictionaries/domain/dictionary-data');
    const { hashPassword } = await import('../../src/modules/auth/infrastructure/password-hasher');
    const passwordHash = await hashPassword(randomUUID());
    async function actor(role: 'manager' | 'realtor'): Promise<Actor> {
      const user = await db.user.create({ data: { login: 'verify_' + role, displayName: 'Synthetic ' + role, roleCode: role, passwordHash } });
      return { userId: user.id, role, login: user.login, displayName: user.displayName, mustChangePassword: false, sessionId: randomUUID() };
    }
    const manager = await actor('manager'), realtor = await actor('realtor');
    for (const [category, items] of Object.entries(DICTIONARY_SEED)) await db.dictionaryItem.createMany({ data: items.map(([code, displayName]) => ({ category, code, displayName })) });
    const service = await import('../../src/modules/import/application/enterprise-service');
    const { loadEnterprise, enterpriseProfileSchema } = await import('../../src/modules/import/domain/enterprise-workbook');
    const profile = enterpriseProfileSchema.parse(rawProfile);
    const original = await loadEnterprise(bytes);
    const file = (b: Buffer) => new File([new Uint8Array(b)], 'enterprise-workbook.xlsx');
    const confirm = async (id: string) => {
      const job = await service.inspectEnterprise(manager, id);
      return service.commitEnterprise(manager, id, { confirmed: true, acceptWarnings: true, expectedMappingVersion: job.mappingVersion });
    };
    const counts = async () => [await db.client.count(), await db.property.count(), await db.historicalDealArchive.count(), await db.clientNeed.count(), await db.leadRequest.count(), await db.task.count(), await db.document.count()];
    stage = 'DRY_RUN_FAILED';
    const job = await service.uploadEnterprise(manager, file(bytes), profile);
    report.unresolved = job.unresolved.map(c => ({ sheet: c.sheet, row: c.row, column: c.column }));
    const inspected = await service.inspectEnterprise(manager, job.id);
    for (let sheet = 1; sheet <= original.worksheets.length; sheet++) {
      const rows = inspected.rows.filter(r => r.sheetName === `sheet:${sheet}`);
      report.sheets.push({ sheet, recognized: rows.length, imported: 0, excluded: rows.filter(r => r.validationStatus === 'skipped_policy').length,
        rejected: rows.filter(r => ['invalid', 'unrecognized'].includes(r.validationStatus)).length,
        duplicates: rows.filter(r => r.warningCodes.some(c => ['already_imported', 'probable_duplicate'].includes(c))).length });
      for (const row of rows) for (const code of [...row.errorCodes, ...row.warningCodes]) {
        const safe = allowedCodes.has(code) ? code : 'OTHER_CODE'; report.codes[safe] = (report.codes[safe] ?? 0) + 1;
      }
    }
    assert('dry_run_no_business_writes', (await counts()).every(n => n === 0));
    assert('resolved', job.unresolved.length === 0);
    stage = 'ROLLBACK_FAILED';
    // Fail after at least one successful business write, inside the real commit transaction.
    const eligible = inspected.rows.filter(r => !['invalid', 'unrecognized', 'skipped_policy'].includes(r.validationStatus)
      && !r.warningCodes.some(c => ['already_imported', 'probable_duplicate'].includes(c)));
    assert('fault_sample', eligible.length >= 2);
    const threshold = Math.max(1, Math.floor(eligible.length / 2));
    if (url) {
      await db.$executeRawUnsafe(`CREATE FUNCTION verify_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.commit_result = 'imported' AND (SELECT count(*) FROM import_row_results WHERE import_job_id = NEW.import_job_id AND commit_result = 'imported') >= ${threshold} THEN RAISE EXCEPTION 'VERIFY_INJECTED'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe('CREATE TRIGGER verify_commit_fault BEFORE UPDATE ON import_row_results FOR EACH ROW EXECUTE FUNCTION verify_commit_fault()');
    } else await db.$executeRawUnsafe(`CREATE TRIGGER verify_commit_fault BEFORE UPDATE ON import_row_results WHEN NEW.commit_result = 'imported' AND (SELECT count(*) FROM import_row_results WHERE import_job_id = NEW.import_job_id AND commit_result = 'imported') >= ${threshold} BEGIN SELECT RAISE(ABORT, 'VERIFY_INJECTED'); END`);
    let failed = false;
    try { await confirm(job.id); } catch { failed = true; }
    finally {
      await db.$executeRawUnsafe(url ? 'DROP TRIGGER verify_commit_fault ON import_row_results' : 'DROP TRIGGER verify_commit_fault');
      if (url) await db.$executeRawUnsafe('DROP FUNCTION verify_commit_fault()');
    }
    assert('injected_failure', failed);
    assert('rollback_business', (await counts()).every(n => n === 0));
    assert('rollback_receipts', await db.importRowResult.count({ where: { importJobId: job.id, commitResult: { not: null } } }) === 0);
    assert('rollback_job', (await service.inspectEnterprise(manager, job.id)).status === 'dry_run_ready');
    stage = 'COMMIT_FAILED';
    const committed = await confirm(job.id);
    assert('retry_imported', committed.imported > 0);
    const baseline = await counts();
    const receipts = await db.importRowResult.findMany({ where: { importJobId: job.id, commitResult: 'imported' } });
    const imported = new Set(receipts.map(r => `${Number(r.sheetName?.split(':')[1])}:${r.sourceRowNumber}`));
    for (const sheet of report.sheets) sheet.imported = receipts.filter(r => r.sheetName === `sheet:${sheet.sheet}`).length;
    assert('completed_idempotent', (await confirm(job.id)).imported === committed.imported);
    const repeated = await service.uploadEnterprise(manager, file(bytes), profile);
    assert('repeat_checksum', repeated.checksumRepeated);
    assert('repeat_zero_new', (await confirm(repeated.id)).imported === 0);
    assert('repeat_counts', JSON.stringify(await counts()) === JSON.stringify(baseline));
    stage = 'EXPORT_FAILED';
    const exported = await service.exportEnterprise(manager, job.id);
    await writeFile(join(directory, 'export.xlsx'), exported.buffer, { mode: 0o600, flag: 'wx' });
    for (const [key, value] of Object.entries(exported.report)) if (allowedCompatibility.has(key)) report.compatibility[key] = value;
    const { compareWorkbook } = await import('./compare-workbook');
    report.preservation = compareWorkbook(original, await loadEnterprise(exported.buffer), profile, imported);
    report.checks.export_preservation = Number(Object.values(report.preservation).every(c => c.mismatched === 0));
    if (!report.checks.export_preservation) report.errors.EXPORT_MISMATCH = Object.values(report.preservation).reduce((n, c) => n + c.mismatched, 0);
    const roundtrip = await service.uploadEnterprise(manager, file(exported.buffer), profile);
    assert('export_repeat_zero_new', (await confirm(roundtrip.id)).imported === 0);
    assert('export_repeat_counts', JSON.stringify(await counts()) === JSON.stringify(baseline));
    stage = 'RBAC_FAILED';
    const { ForbiddenError, NotFoundError } = await import('../../src/shared/errors');
    const denied = async (action: () => Promise<unknown>) => { try { await action(); return false; } catch (e) { return e instanceof ForbiddenError || e instanceof NotFoundError; } };
    assert('rbac_upload', await denied(() => service.uploadEnterprise(realtor, file(bytes), profile)));
    assert('rbac_inspect', await denied(() => service.inspectEnterprise(realtor, job.id)));
    assert('rbac_remap', await denied(() => service.remapEnterprise(realtor, job.id, profile)));
    assert('rbac_commit', await denied(() => service.commitEnterprise(realtor, job.id, {})));
    assert('rbac_export', await denied(() => service.exportEnterprise(realtor, job.id)));
    const { getClientCard } = await import('../../src/modules/clients/application/client-queries');
    const { getNeedCard } = await import('../../src/modules/needs/application/need-queries');
    const { getArchiveRecord } = await import('../../src/modules/archive/application/archive-service');
    const foreignNeed = await db.clientNeed.findFirst({ where: { responsibleUserId: manager.userId } });
    if (foreignNeed) assert('rbac_foreign_need', await denied(() => getNeedCard(realtor, foreignNeed.id)));
    const archivedDeal = await db.historicalDealArchive.findFirst();
    if (archivedDeal) assert('rbac_historical_archive', await denied(() => getArchiveRecord(realtor, archivedDeal.id)));
    const closed = await db.client.create({ data: { displayName: 'Synthetic protected', clientKind: 'person', responsibleUserId: manager.userId, createdBy: manager.userId, status: 'archived', archivedAt: new Date() } });
    assert('rbac_foreign_closed_client', await denied(() => getClientCard(realtor, closed.id)));
  } catch {
    report.errors[stage] = (report.errors[stage] ?? 0) + 1;
  } finally {
    if (input && checksum) {
      try { assert('source_unchanged', digest(await readFile(input)) === checksum); } catch { report.errors.SOURCE_CHANGED = 1; }
    }
    let cleaned = true;
    try { await disconnect?.(); } catch { cleaned = false; }
    try {
      if (admin && databaseCreated) await admin.query('DROP DATABASE crm_private_verify WITH (FORCE)');
      if (admin && locked) await admin.query('SELECT pg_advisory_unlock(3221223)');
    } catch { cleaned = false; }
    finally { try { await admin?.end(); } catch { cleaned = false; } }
    try {
      if (directory) {
        const root = await realpath(resolve('private-data/verify-tmp'));
        const target = await realpath(directory);
        const rel = relative(root, target);
        if (!rel || rel.startsWith('..') || rel.includes(sep)) throw new Error();
        await rm(target, { recursive: true, force: true, maxRetries: 3 });
      }
    } catch { cleaned = false; }
    report.checks.cleanup = Number(cleaned);
    if (!cleaned) report.errors.CLEANUP_FAILED = 1;
  }
  process.exitCode = Object.keys(report.errors).length ? 1 : 0;
  output(JSON.stringify(report) + '\n');
}
void main();
