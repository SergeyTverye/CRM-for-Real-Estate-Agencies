// Explicit Docker/API smoke: no fixtures, external requests or paid providers.
// Reads local seed credentials in memory; never prints credentials/cookies/log bodies.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { config } from 'dotenv';

config({ path: ['.env.local', '.env'], quiet: true });
const compose = (...args) => execFileSync('docker', ['compose', '-p', 'crm', ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
});
const configuration = JSON.parse(compose('config', '--format', 'json'));
const flags = ['SCRAPER_ENABLED', 'SCRAPER_DEMO_FIXTURES', 'AI_ENABLED'];
for (const name of ['app', 'search-worker']) {
  const env = configuration.services[name].environment;
  const runtime = JSON.parse(compose('exec', '-T', name, 'node', '-e',
    `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(flags)}.map(k=>[k,process.env[k]]))))`));
  for (const flag of flags) {
    assert.equal(String(env[flag]), 'false', `${name}: ${flag} must be false for this smoke`);
    assert.equal(runtime[flag], 'false', `${name}: runtime ${flag} must be false`);
  }
}
const base = `http://127.0.0.1:${process.env.APP_PORT || 8080}`;
let cookie = '';
async function request(path, body) {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  if (path === 'auth/login') cookie = (response.headers.get('set-cookie') || '').split(';')[0];
  assert.equal(response.ok, true, `${path.replace(/[0-9a-f-]{36}/g, ':id')}: HTTP ${response.status}`);
  return response.json();
}
const filters = { operation: 'sale', purposes: ['office'] };
const enqueue = () => request('property-search/runs', { filters, sources: ['cian'], idempotencyKey: `docker-smoke-${randomUUID()}` });
const progress = id => request(`property-search/runs/${id}/progress`);
const fixtureSession = process.argv.includes('--fixture-session');
let fixtureHash;
function fixture(action) {
  const code = `import fs from 'node:fs'; import { db, disconnectDb } from './src/shared/db/client';
    const d = JSON.parse(fs.readFileSync(0, 'utf8'));
    (async () => {
      if (d.action === 'create') {
        const user = await db.user.findFirstOrThrow({ where: { roleCode: 'manager', isActive: true, mustChangePassword: false }, orderBy: { id: 'asc' } });
        await db.userSession.create({ data: { userId: user.id, tokenHash: d.hash, expiresAt: new Date(Date.now() + 120000), userAgent: 'docker-search-smoke' } });
      } else await db.userSession.updateMany({ where: { tokenHash: d.hash }, data: { revokedAt: new Date() } });
    })().finally(disconnectDb);`;
  execFileSync('docker', ['compose', '-p', 'crm', 'exec', '-T', 'app', 'node_modules/.bin/tsx', '-e', code], {
    input: JSON.stringify({ action, hash: fixtureHash }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000,
  });
}
async function main() {
  if (fixtureSession) {
    // Local operator-only fixture; does not modify accounts/passwords or add an HTTP endpoint.
    const token = randomBytes(32).toString('base64url');
    fixtureHash = createHash('sha256').update(token).digest('hex');
    fixture('create');
    cookie = `crm_session=${token}`;
  } else {
    const login = await request('auth/login', {
      login: process.env.SEED_MANAGER_LOGIN || 'manager', password: process.env.SEED_MANAGER_PASSWORD,
    });
    assert.equal(login.mustChangePassword, false, 'Smoke account requires password change');
  }
  assert.ok(cookie, 'Login cookie missing');
  try {
    const run = await enqueue();
    let result;
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await progress(run.id);
      if (!['queued', 'running'].includes(result.status)) break;
      await setTimeout(500);
    }
    assert.equal(result.status, 'completed', 'Disabled run did not complete');
    assert.ok(result.sources.length && result.sources.every(s => s.status === 'disabled'));
    console.log('Docker API: completed / disabled PASS');
    // A stopped worker makes queued cancellation deterministic, without adapter fixtures.
    compose('stop', 'search-worker');
    try {
      const cancelled = await enqueue();
      assert.equal((await progress(cancelled.id)).status, 'queued');
      await request(`property-search/runs/${cancelled.id}/cancel`, {});
      const stopped = await progress(cancelled.id);
      assert.equal(stopped.status, 'partial');
      assert.equal(stopped.cancelRequested, true);
      assert.ok(stopped.sources.every(s => s.status === 'cancelled'));
      compose('start', 'search-worker');
      await setTimeout(1500);
      assert.equal((await progress(cancelled.id)).status, 'partial');
      console.log('Docker API: queued cancellation survives worker restart PASS');
    } finally { compose('start', 'search-worker'); }
    let services;
    for (let attempt = 0; attempt < 40; attempt++) {
      services = compose('ps', '--format', 'json', 'app', 'search-worker').trim().split('\n').map(s => JSON.parse(s));
      if (services.length === 2 && services.every(s => s.Health === 'healthy')) break;
      await setTimeout(500);
    }
    assert.equal(services.length, 2);
    assert.ok(services.every(s => s.Health === 'healthy'), 'App/worker healthcheck failed');
    const images = services.map(s => execFileSync('docker', ['inspect', '--format', '{{.Image}}', s.ID], { encoding: 'utf8' }).trim());
    assert.equal(images[0], images[1], 'App and search-worker must use the same image');
    console.log('Docker worker: healthy / same image PASS');
    const logs = compose('logs', '--no-color', '--tail=200', 'search-worker');
    const env = configuration.services.app.environment;
    const secrets = [env.POSTGRES_PASSWORD, env.YANDEX_CLOUD_API_KEY, process.env.SEED_MANAGER_PASSWORD, cookie.split('=')[1]];
    assert.ok(secrets.filter(s => s && s.length >= 8).every(s => !logs.includes(s)), 'Secret found in worker log');
    assert.ok(!logs.includes('queue_tick_failed'), 'Worker tick failed');
    console.log('Docker worker: sanitized logs PASS');
  } finally {
    try { await request('auth/logout', {}); }
    finally { if (fixtureHash) fixture('revoke'); }
  }
}
main().catch(error => {
  console.error('Docker search smoke FAIL', error.code === 'ERR_ASSERTION' ? error.message : '(response bodies and secrets suppressed)');
  process.exitCode = 1;
});
