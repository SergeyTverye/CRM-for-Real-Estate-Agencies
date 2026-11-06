import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildProfile, loadEnterprise, text } from '@/modules/import/domain/enterprise-workbook';

const run = promisify(execFile);
const fixture = resolve('tests/fixtures/synthetic/enterprise-workbook.xlsx');
const backend = process.env.CRM_DEPLOYMENT_MODE === 'desktop' ? 'sqlite' : 'pg';
it('trusted CLI: full synthetic cycle, numeric-only output, no source strings, cleanup', async () => {
  const root = resolve('private-data/verify-tmp');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'test-'));
  try {
    const workbook = await loadEnterprise(await readFile(fixture));
    const profile = buildProfile(workbook);
    for (const sheet of profile.sheets) {
      if (sheet.target === null) sheet.target = 'ignore';
      sheet.defaults.priceUnit = 'rub_month';
      for (const header of Object.keys(sheet.columns)) if (sheet.columns[header] === null) sheet.columns[header] = 'ignore';
    }
    const profilePath = join(dir, 'profile.json');
    await writeFile(profilePath, JSON.stringify(profile));
    const invocation = run(process.execPath, ['--import', 'tsx', 'scripts/private-import/verify-workbook.ts', fixture, '--profile', profilePath, '--backend', backend], { timeout: 120000, maxBuffer: 1024 * 1024 });
    const pid = invocation.child.pid;
    // A failing child still produces its privacy-safe numeric report. Do not expose
    // execFile's command line, raw stderr, paths or an exception object to the reporter.
    const result = await invocation.then(
      value => ({ stdout: value.stdout, stderr: value.stderr, exitCode: 0 }),
      (error: { stdout?: string; stderr?: string; code?: number }) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: typeof error.code === 'number' ? error.code : 1 }),
    );
    expect(result.stderr === '').toBe(true);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    const report = JSON.parse(result.stdout);
    expect(Object.fromEntries(Object.entries(report.preservation).filter(([, count]) => (count as { mismatched: number }).mismatched > 0))).toEqual({});
    expect(report.errors).toEqual({});
    expect(result.exitCode).toBe(0);
    expect(report.sheets).toHaveLength(6);
    expect(report.sheets.reduce((n: number, s: { imported: number }) => n + s.imported, 0)).toBe(62);
    for (const check of ['dry_run_no_business_writes', 'injected_failure', 'rollback_business', 'rollback_receipts', 'rollback_job', 'retry_imported', 'repeat_zero_new', 'export_repeat_zero_new', 'export_preservation', 'rbac_foreign_closed_client', 'source_unchanged', 'cleanup']) expect(report.checks[check], check).toBe(1);
    const numericLeaves = (value: unknown): boolean => typeof value === 'number' || (typeof value === 'object' && value !== null && Object.values(value).every(numericLeaves));
    expect(numericLeaves(report)).toBe(true);
    for (const sheet of workbook.worksheets) {
      expect(result.stdout.includes(sheet.name)).toBe(false);
      sheet.eachRow(row => row.eachCell(cell => {
        const value = text(cell.value).trim();
        // Pure numeric/empty cells necessarily overlap aggregate counts.
        if (value && !/^[\d\s.,+-]+$/.test(value)) expect(result.stdout.includes(value)).toBe(false);
      }));
    }
    expect((await readdir(root)).filter(n => n.startsWith(`run-${pid}-`))).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 120000);

it('trusted CLI: invalid input produces only a safe aggregate, never the argument', async () => {
  const sentinel = 'SYNTHETIC_PRIVATE_ARGUMENT';
  try {
    await run(process.execPath, ['--import', 'tsx', 'scripts/private-import/verify-workbook.ts', sentinel, '--profile', sentinel, '--backend', backend], { timeout: 30000 });
    throw new Error('expected failure');
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number };
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(sentinel);
    expect(JSON.parse(result.stdout).errors).toEqual({ ARGUMENTS_FAILED: 1 });
  }
});
