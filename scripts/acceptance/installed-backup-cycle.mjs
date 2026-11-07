// Opt-in library only: importing this module performs no I/O or installed execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CONTROL = '/api/v1/settings/backups/control';
const MAX_ARCHIVE = 256 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };
const need = (value, code) => { if (!value) fail(code); };
const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = value => { need(typeof value === 'string' && UUID.test(value), 'BK_UUID_REJECTED'); return value; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateBase(value) {
  need(typeof value === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value), 'BK_BASE_REJECTED');
  need(Number(value.split(':').at(-1)) <= 65535, 'BK_BASE_REJECTED');
  return value;
}
export function validateDirectory(value) {
  need(typeof value === 'string' && /^[a-z]:[\\/]/i.test(value) &&
    !/[\x00-\x1f<>"|?*]/.test(value) && !value.slice(2).includes(':') &&
    !value.split(/[\\/]/).some(p => p === '.' || p === '..' || /[ .]$/.test(p)), 'BK_DIRECTORY_REJECTED');
  const normalized = path.win32.normalize(value);
  const root = path.win32.join(workspace, 'data', 'qa-v32-installed-browser');
  const relative = path.win32.relative(root, normalized);
  need(new RegExp(`^run-${UUID.source.slice(1, -1)}\\\\backup-cycle$`, 'i').test(relative), 'BK_DIRECTORY_REJECTED');
  return normalized;
}
async function canonicalDirectory(directory) {
  // Supplemental only: parent MUST perform Windows-native reparse/ACL preflight.
  let cursor = directory;
  for (let i = 0; i < 64; i++) {
    const info = await fs.lstat(cursor);
    need(info.isDirectory() && !info.isSymbolicLink(), 'BK_PATH_REJECTED');
    need((await fs.realpath(cursor)).toLowerCase() === cursor.toLowerCase(), 'BK_PATH_REJECTED');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
  fail('BK_PATH_DEPTH');
}
async function bounded(action, ms, code) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), { safeCode: code })), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function archiveEvidence(file, directory) {
  await canonicalDirectory(directory);
  const info = await fs.lstat(file);
  need(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size > 32 && info.size <= MAX_ARCHIVE, 'BK_ARCHIVE_REJECTED');
  need((await fs.realpath(file)).toLowerCase() === file.toLowerCase(), 'BK_ARCHIVE_REJECTED');
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    need(before.ino === info.ino && before.dev === info.dev && before.size === info.size, 'BK_ARCHIVE_CHANGED');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while (bytes < before.size) {
      const read = await handle.read(buffer, 0, Math.min(buffer.length, before.size - bytes), bytes);
      need(read.bytesRead > 0, 'BK_ARCHIVE_CHANGED');
      digest.update(buffer.subarray(0, read.bytesRead)); bytes += read.bytesRead;
    }
    const after = await handle.stat();
    need(after.size === before.size && after.mtimeMs === before.mtimeMs, 'BK_ARCHIVE_CHANGED');
    return { filename: 'synthetic.crmbackup', bytes, sha256: digest.digest('hex') };
  } finally { await handle.close(); }
}

/**
 * Parent owns lifecycle, credentials and native CUA. Required additional callback:
 * afterCommand({requestId, action, timeoutMs, signal}) -> {page, base}.
 * It waits for this owned supervisor operation/restart, proves ancestry/identity,
 * re-logins using its private closure, and returns the authenticated Playwright page.
 * No raw result files, credentials, session or configuration may be returned.
 * See data/coordination/installed-backup-cycle.md before opting in.
 */
export async function runInstalledBackupCycle({ page, base, clientId, directory, onNativeDialog, afterCommand }) {
  let stage = 'PREFLIGHT', phrase, recovery;
  const checks = [];
  const pass = code => checks.push({ code, status: 'PASS' });
  try {
    base = validateBase(base); clientId = uuid(clientId); directory = validateDirectory(directory);
    need(process.platform === 'win32', 'BK_WINDOWS_REQUIRED');
    need(typeof onNativeDialog === 'function' && typeof afterCommand === 'function', 'BK_PARENT_CALLBACKS_REQUIRED');
    need(page && new URL(page.url()).origin === base, 'BK_PAGE_ORIGIN_REJECTED');
    await canonicalDirectory(directory);
    need((await fs.readdir(directory)).length === 0, 'BK_FRESH_DIRECTORY_REQUIRED');
    const archiveFile = path.win32.join(directory, 'synthetic.crmbackup');
    // Never use page.evaluate for secrets; authenticated context requests do not
    // populate UI fields. Parent MUST disable tracing/HAR/video/debug logging.
    async function request(route, method = 'GET', options = {}, binary = false) {
      let response;
      try {
        response = await page.context().request.fetch(base + route, {
          method, headers: { Origin: base }, timeout: 15000, maxRedirects: 0,
          failOnStatusCode: false, ...options,
        });
        need(response.ok(), 'BK_HTTP_FAILED');
        const body = await response.body();
        need(body.length <= (binary ? 65536 : 1024 * 1024), 'BK_RESPONSE_BOUND');
        return binary ? body : JSON.parse(body.toString('utf8'));
      } catch { fail('BK_REQUEST_FAILED'); }
      finally { if (response) await response.dispose().catch(() => {}); }
    }
    const control = body => request(CONTROL, 'POST', { data: body });
    const status = () => request(CONTROL);
    function archives(s) {
      need(Array.isArray(s.archives) && s.archives.length <= 1000, 'BK_CATALOG_REJECTED');
      return s.archives.map(a => {
        uuid(a.backupId);
        need(/^[a-f0-9]{64}$/.test(a.sha256) && Number.isSafeInteger(a.size) && a.size > 32 && a.size <= MAX_ARCHIVE, 'BK_CATALOG_REJECTED');
        return { backupId: a.backupId, sha256: a.sha256, bytes: a.size };
      });
    }
    async function command(body, expected) {
      const queued = await control(body);
      need(queued.queued === true, 'BK_NOT_QUEUED');
      const requestId = uuid(queued.requestId);
      const abort = new AbortController();
      let resumed;
      try {
        resumed = await bounded(() => afterCommand(Object.freeze({ requestId, action: body.action,
          timeoutMs: 180000, signal: abort.signal })), 180000, 'BK_LIFECYCLE_TIMEOUT');
      } finally { abort.abort(); }
      base = validateBase(resumed?.base); page = resumed?.page;
      need(page && new URL(page.url()).origin === base, 'BK_RESUMED_ORIGIN_REJECTED');
      const current = await status();
      need(Array.isArray(current.jobs), 'BK_JOBS_REJECTED');
      need(current.jobs.some(j => j.id === requestId && j.action === body.action && j.status === expected), 'BK_COMMAND_NOT_CONFIRMED');
      pass(`${body.action}-supervised-${expected}`);
      return current;
    }
    async function native(kind, backupId) {
      const started = Date.now();
      const pending = await control(kind === 'export' ? { action: 'native-export', backupId } : { action: 'pick-archive' });
      const requestId = uuid(pending.requestId);
      const abort = new AbortController();
      try {
        await bounded(() => onNativeDialog(Object.freeze({ kind, requestId, expectedPath: archiveFile,
          timeoutMs: 90000, deadlineUtc: new Date(started + 100000).toISOString(), signal: abort.signal })),
        90000, 'BK_NATIVE_COORDINATOR_TIMEOUT');
        for (let i = 0; i < 100 && Date.now() - started < 100000; i++) {
          const result = await control({ action: 'native-result', requestId });
          if (result.status === (kind === 'export' ? 'exported' : 'selected')) { pass(`native-${kind}-${result.status}`); return; }
          need(result.status === 'pending', 'BK_NATIVE_FAILED_OR_CANCELLED');
          await delay(500);
        }
        fail('BK_NATIVE_RESULT_TIMEOUT');
      } finally { abort.abort(); }
    }
    stage = 'SYNTHETIC_DOCUMENT';
    const initial = await status();
    need(initial.mode === 'desktop' && initial.nativeDialog === true && initial.restoreSupported === true && initial.standby === false, 'BK_SUPERVISED_ACTIVE_REQUIRED');
    const beforeIds = new Set(archives(initial).map(a => a.backupId));
    const original = await request(`/api/v1/clients/${clientId}`);
    need(original.id === clientId && /^QA SYNTHETIC\b/.test(original.displayName) && typeof original.clientKind === 'string', 'BK_SYNTHETIC_CLIENT_REQUIRED');
    const recordHash = c => sha(JSON.stringify({ id: c.id, displayName: c.displayName, clientKind: c.clientKind }));
    const originalHash = recordHash(original);
    const document = Buffer.from(`SYNTHETIC installed backup document ${clientId}\n`, 'utf8');
    const documentHash = sha(document);
    const uploaded = await request('/api/v1/documents', 'POST', { multipart: {
      file: { name: 'synthetic-backup.txt', mimeType: 'text/plain', buffer: document },
      documentTypeCode: 'other', linkKind: 'client', linkId: clientId,
    } });
    const documentId = uuid(uploaded.id);
    async function checkDocument() {
      const bytes = await request(`/api/v1/documents/${documentId}/download`, 'GET', {}, true);
      need(bytes.length === document.length && sha(bytes) === documentHash, 'BK_DOCUMENT_HASH_MISMATCH');
    }
    await checkDocument(); pass('document-before-sha256');
    phrase = randomBytes(32).toString('hex');
    let raw = randomBytes(32).toString('hex'); recovery = `CRM1-${raw}-${sha(raw).slice(0, 12)}`; raw = undefined;
    stage = 'CREATE_VERIFY';
    const created = await command({ action: 'create', passphrase: phrase, recoveryKey: recovery, recoveryKeySaved: true }, 'verified');
    const newArchives = archives(created).filter(a => !beforeIds.has(a.backupId));
    need(newArchives.length === 1, 'BK_ARCHIVE_AMBIGUOUS');
    const archive = newArchives[0];
    await command({ action: 'verify', backupId: archive.backupId, recoveryKey: recovery }, 'verified');
    stage = 'NATIVE_EXPORT';
    await native('export', archive.backupId);
    const exported = await archiveEvidence(archiveFile, directory);
    need(exported.sha256 === archive.sha256 && exported.bytes === archive.bytes, 'BK_EXPORT_HASH_MISMATCH');
    pass('native-export-catalog-sha256-size');
    stage = 'MUTATE_RESTORE';
    const current = await request(`/api/v1/clients/${clientId}`);
    need(recordHash(current) === originalHash && typeof current.updatedAt === 'string', 'BK_CLIENT_CHANGED');
    const changedName = `QA SYNTHETIC BACKUP MUTATION ${clientId}`;
    await request(`/api/v1/clients/${clientId}`, 'PATCH', { data: { expectedUpdatedAt: current.updatedAt, displayName: changedName } });
    need((await request(`/api/v1/clients/${clientId}`)).displayName === changedName, 'BK_MUTATION_NOT_VISIBLE');
    pass('own-client-optimistic-mutation');
    const preRestoreIds = new Set(archives(await status()).map(a => a.backupId));
    const restored = await command({ action: 'restore', backupId: archive.backupId, passphrase: phrase, confirmed: true }, 'restored');
    need(recordHash(await request(`/api/v1/clients/${clientId}`)) === originalHash, 'BK_RECORD_NOT_RESTORED');
    await checkDocument(); pass('record-projection-and-document-restored');
    const protective = archives(restored).filter(a => !preRestoreIds.has(a.backupId));
    // Public API has no protectiveBackupId; do not equate a new catalog item with proven linkage.
    stage = 'NATIVE_IMPORT_SELECTION';
    await native('import');
    const finalFile = await archiveEvidence(archiveFile, directory);
    need(finalFile.sha256 === exported.sha256 && finalFile.bytes === exported.bytes, 'BK_EXPORTED_FILE_CHANGED');
    return { schema: 1, status: 'PARTIAL', checks, counts: { documents: 1, mutatedClients: 1, nativeDialogs: 2 },
      record: { clientId, projection: ['id', 'displayName', 'clientKind'], sha256: originalHash },
      document: { documentId, bytes: document.length, sha256: documentHash }, archive: { ...exported, backupId: archive.backupId },
      protectiveSnapshot: { status: 'LINK_NOT_EXPOSED_BY_PUBLIC_API', newCatalogCandidates: protective },
      selectedFileRestore: { status: 'BLOCKED', code: 'EXISTING_LOCAL_CATALOG_ARCHIVE_REJECTED' },
      coverage: { businessActions: 'AUTHENTICATED_API', nativeDialogs: 'CALLER_CUA_PLUS_ACTOR_BOUND_API_RESULT', backupPanelUi: 'NOT_TESTED' } };
  } catch (error) {
    // Deliberately discard raw errors, callbacks' errors, response bodies and secrets.
    const detail = typeof error?.safeCode === 'string' && /^[A-Z][A-Z0-9_]{0,90}$/.test(error.safeCode) ? `_${error.safeCode}` : '';
    fail(`BK_FAILED_${stage}${detail}`);
  } finally { phrase = undefined; recovery = undefined; }
}
