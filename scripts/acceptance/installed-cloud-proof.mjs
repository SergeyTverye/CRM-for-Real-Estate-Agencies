// Opt-in library only: importing this module performs no I/O, secret reads, network calls, or installed execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SECRETS_FILE = 'D:\\crm-secrets\\clouds.env';
const SETTINGS_ROUTE = '/api/v1/settings/backups';
const CONTROL_ROUTE = '/api/v1/settings/backups/control';
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const SYNTHETIC_DOC_BYTES = 256 * 1024;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const CATALOG_STEPS = Object.freeze([
  'STATUS', 'LIST_API', 'PARSE', 'IDENTITY', 'OPEN', 'DIALOG',
  'SELECT_VISIBLE', 'SELECT_ARCHIVE', 'RESTORE_OPEN', 'RESTORE_DIALOG',
  'ID_VISIBLE', 'ID_VALUE', 'CANCEL', 'CLOSED',
]);
const DIAGNOSTIC_STAGES = new Set([
  'PREFLIGHT', 'FRESH_PROFILE_CHECK', 'LOAD_SECRETS_IN_MEMORY',
  'GUI_CONFIGURE_AND_PROBE_PROVIDERS', 'INJECT_S3_QUEUE_FAULT',
  'CREATE_VERIFIED_BACKUP', 'VERIFY_INDEPENDENT_QUEUE_FAILURE_AND_RECOVERY',
  'WAIT_BOTH_PROVIDERS_VERIFIED', 'CAT_PAGE_NAV', 'CAT_PAGE_HEADING',
  'MUTATE_AND_RESTORE_YANDEX', 'MUTATE_AND_RESTORE_MAILRU',
  'ANONYMOUS_S3_PROBE', 'CONFIRM_RESTORE_EVIDENCE',
  ...['YANDEX', 'MAILRU'].flatMap(provider => CATALOG_STEPS.map(step => `CAT_${provider}_${step}`)),
]);
const DIAGNOSTIC_KINDS = Object.freeze(['UI_TIMEOUT', 'LOCATOR_STRICT', 'OTHER']);
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_RE = /^crm-synthetic-installed\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/i;
const ALLOWED_RESULT_SCHEMA = Object.freeze({
  root: new Set(['schema', 'status', 'checks', 'counts', 'record', 'document', 'archive', 'coverage', 'remoteCleanup']),
  checks: new Set(['code', 'status']),
  counts: new Set([
    'providersConfigured',
    'providersProbed',
    'providersVerifiedInQueue',
    'providersRestored',
    'anonymousDenied',
  ]),
  record: new Set(['clientId', 'sha256', 'restoredMatches']),
  document: new Set(['documentId', 'bytes', 'sha256', 'restoredMatches']),
  archive: new Set(['backupId', 'bytes', 'sha256', 'sameArchiveAcrossProviders']),
  coverage: new Set([
    'secretStorage',
    'parentCaptureAttestation',
    'guiConfigurationAndProbe',
    'cloudUploadAndVerify',
    'independentQueueFailure',
    'cloudDownloadAndRestore',
  ]),
});
const RETAINED_REMOTE_EVIDENCE = Object.freeze({
  status: 'SYNTHETIC_EVIDENCE_RETAINED',
  historicalS3Versions: 'NOT_AUDITED',
});

const YANDEX_BUCKET_ALIASES = Object.freeze(['YANDEX_S3_BUCKET', 'YC_S3_BUCKET']);
const YANDEX_KEY_ID_ALIASES = Object.freeze(['YANDEX_S3_ACCESS_KEY_ID', 'YC_S3_ACCESS_KEY_ID']);
const YANDEX_SECRET_ALIASES = Object.freeze(['YANDEX_S3_SECRET_ACCESS_KEY', 'YC_S3_SECRET_ACCESS_KEY']);
const MAILRU_EMAIL_ALIASES = Object.freeze(['MAILRU_WEBDAV_EMAIL', 'MAILRU_EMAIL']);
const MAILRU_PASSWORD_ALIASES = Object.freeze(['MAILRU_WEBDAV_APP_PASSWORD', 'MAILRU_APP_PASSWORD']);

const fail = code => {
  const safe = SAFE_CODE_RE.test(String(code)) ? String(code) : 'CL_UNEXPECTED_FAILURE';
  throw Object.assign(new Error(safe), { safeCode: safe });
};
const need = (condition, code) => { if (!condition) fail(code); };
// Inspect only in memory. Never retain the original error, message, stack or cause.
function diagnosticCode(error, stage) {
  if (typeof error?.safeCode === 'string' && SAFE_CODE_RE.test(error.safeCode)) return error.safeCode;
  const closedStage = DIAGNOSTIC_STAGES.has(stage) ? stage : 'PREFLIGHT';
  const kind = typeof error?.message === 'string' && error.message.includes('strict mode violation')
    ? 'LOCATOR_STRICT'
    : error?.name === 'TimeoutError' ? 'UI_TIMEOUT' : 'OTHER';
  const code = `CL_${kind}_${closedStage}`;
  return SAFE_CODE_RE.test(code) ? code : 'CL_UNEXPECTED_FAILURE';
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const uuid = (value, code = 'CL_UUID_REJECTED') => {
  need(typeof value === 'string' && UUID_RE.test(value), code);
  return value.toLowerCase();
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateBase(value) {
  need(typeof value === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value), 'CL_BASE_REJECTED');
  const port = Number(value.split(':').at(-1));
  need(Number.isInteger(port) && port >= 1 && port <= 65535, 'CL_BASE_REJECTED');
  return value;
}

export function validateProfileDirectory(value, expectedRunId) {
  const runId = uuid(expectedRunId, 'CL_RUN_ID_REJECTED');
  need(
    typeof value === 'string' &&
    /^[a-z]:[\\/]/i.test(value) &&
    !/[\x00-\x1f<>"|?*]/.test(value) &&
    !value.slice(2).includes(':') &&
    !value.split(/[\\/]/).some(part => part === '.' || part === '..' || /[ .]$/.test(part)),
    'CL_PROFILE_DIRECTORY_REJECTED',
  );
  const normalized = path.win32.normalize(value);
  const qaRoot = path.win32.join(workspace, 'data', 'qa-v32-installed-browser');
  const runRoot = path.win32.join(qaRoot, `run-${runId}`);
  const relToQa = path.win32.relative(qaRoot, normalized);
  need(
    Boolean(relToQa) && !relToQa.startsWith('..') && !path.win32.isAbsolute(relToQa),
    'CL_PROFILE_DIRECTORY_REJECTED',
  );
  const relToRun = path.win32.relative(runRoot, normalized);
  need(
    relToRun === '' || (!relToRun.startsWith('..') && !path.win32.isAbsolute(relToRun)),
    'CL_EXISTING_PROFILE_REFUSED',
  );
  return normalized;
}

export function validatePrefix(prefix, expectedRunId) {
  const runId = uuid(expectedRunId, 'CL_RUN_ID_REJECTED');
  need(typeof prefix === 'string' && PREFIX_RE.test(prefix), 'CL_PREFIX_REJECTED');
  const parts = prefix.split('/');
  need(parts.length === 3 && parts[0] === 'crm-synthetic-installed', 'CL_PREFIX_REJECTED');
  need(parts[1].toLowerCase() === runId && UUID_RE.test(parts[2]), 'CL_PREFIX_REJECTED');
  return prefix;
}

export function parseSecretsEnv(rawText) {
  need(typeof rawText === 'string' && rawText.length > 0 && rawText.length <= 65536, 'CL_SECRETS_ENV_INVALID');
  const map = Object.create(null);
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf('=');
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    if (!/^[A-Z0-9_]{1,80}$/.test(key)) continue;
    let val = cleaned.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).trim();
    }
    if (val) map[key] = val;
  }
  return map;
}

export function readSecretAlias(secrets, names) {
  need(secrets && typeof secrets === 'object', 'CL_CLOUD_CONFIGURATION_MISSING');
  for (const name of names) {
    const val = secrets[name];
    if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  }
  fail('CL_CLOUD_CONFIGURATION_MISSING');
}

export function extractCloudSecrets(secretsMap) {
  const bucket = readSecretAlias(secretsMap, YANDEX_BUCKET_ALIASES);
  const accessKeyId = readSecretAlias(secretsMap, YANDEX_KEY_ID_ALIASES);
  const secretAccessKey = readSecretAlias(secretsMap, YANDEX_SECRET_ALIASES);
  const email = readSecretAlias(secretsMap, MAILRU_EMAIL_ALIASES);
  const applicationPassword = readSecretAlias(secretsMap, MAILRU_PASSWORD_ALIASES);
  need(BUCKET_RE.test(bucket), 'CL_YANDEX_BUCKET_INVALID');
  need(accessKeyId.length >= 4 && accessKeyId.length <= 256, 'CL_YANDEX_KEY_INVALID');
  need(secretAccessKey.length >= 8 && secretAccessKey.length <= 4096, 'CL_YANDEX_SECRET_INVALID');
  need(email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'CL_MAILRU_EMAIL_INVALID');
  need(applicationPassword.length >= 8 && applicationPassword.length <= 4096, 'CL_MAILRU_SECRET_INVALID');
  return {
    yandex: { bucket, accessKeyId, secretAccessKey },
    mailru: { email, applicationPassword },
  };
}

export function buildSyntheticDocumentPayload(runId, clientId, totalBytes = SYNTHETIC_DOC_BYTES) {
  const normalizedRunId = uuid(runId, 'CL_RUN_ID_REJECTED');
  const normalizedClientId = uuid(clientId, 'CL_CLIENT_ID_REJECTED');
  need(Number.isSafeInteger(totalBytes) && totalBytes >= 256 && totalBytes <= 4 * 1024 * 1024, 'CL_SYNTHETIC_DOC_SIZE_INVALID');
  const header = `SYNTHETIC CLOUD PROOF ${normalizedRunId} ${normalizedClientId}\n`;
  const remaining = totalBytes - Buffer.byteLength(header, 'utf8');
  need(remaining >= 64, 'CL_SYNTHETIC_DOC_SIZE_INVALID');
  const lines = [header];
  let currentBytes = Buffer.byteLength(header, 'utf8');
  while (currentBytes < totalBytes) {
    const chunkLen = Math.min(64, totalBytes - currentBytes);
    if (chunkLen <= 1) {
      lines.push('\n');
      currentBytes += 1;
      break;
    }
    const hexChars = chunkLen - 1;
    const rawHex = randomBytes(Math.ceil(hexChars / 2)).toString('hex').slice(0, hexChars);
    lines.push(`${rawHex}\n`);
    currentBytes += chunkLen;
  }
  const buffer = Buffer.from(lines.join(''), 'utf8');
  need(buffer.length === totalBytes, 'CL_SYNTHETIC_DOC_SIZE_INVALID');
  return {
    fileName: 'synthetic-cloud-proof.txt',
    mimeType: 'text/plain',
    buffer,
    bytes: buffer.length,
    sha256: sha256(buffer),
  };
}

export function sanitizeResult(result) {
  need(result && typeof result === 'object' && !Array.isArray(result), 'CL_UNSAFE_RESULT_REJECTED');
  const rootKeys = Object.keys(result);
  need(rootKeys.length > 0 && rootKeys.length <= 16, 'CL_UNSAFE_RESULT_REJECTED');
  for (const k of rootKeys) {
    need(ALLOWED_RESULT_SCHEMA.root.has(k), 'CL_UNSAFE_RESULT_REJECTED');
  }
  const checkScalar = val => {
    if (typeof val === 'boolean') return;
    if (typeof val === 'number') {
      need(Number.isSafeInteger(val) && val >= 0, 'CL_UNSAFE_RESULT_REJECTED');
      return;
    }
    if (typeof val === 'string') {
      const ok = SAFE_CODE_RE.test(val) || UUID_RE.test(val) || SHA256_RE.test(val);
      need(ok, 'CL_UNSAFE_RESULT_REJECTED');
      return;
    }
    fail('CL_UNSAFE_RESULT_REJECTED');
  };
  if ('schema' in result) need(result.schema === 1, 'CL_UNSAFE_RESULT_REJECTED');
  if ('status' in result) need(typeof result.status === 'string' && SAFE_CODE_RE.test(result.status), 'CL_UNSAFE_RESULT_REJECTED');
  if ('remoteCleanup' in result) {
    const retained = result.remoteCleanup;
    need(
      retained && typeof retained === 'object' && !Array.isArray(retained) &&
      Object.keys(retained).length === 2 &&
      Object.hasOwn(retained, 'status') && Object.hasOwn(retained, 'historicalS3Versions') &&
      retained.status === RETAINED_REMOTE_EVIDENCE.status &&
      retained.historicalS3Versions === RETAINED_REMOTE_EVIDENCE.historicalS3Versions,
      'CL_UNSAFE_RESULT_REJECTED',
    );
  }
  if ('checks' in result) {
    need(Array.isArray(result.checks) && result.checks.length <= 64, 'CL_UNSAFE_RESULT_REJECTED');
    for (const item of result.checks) {
      need(item && typeof item === 'object' && !Array.isArray(item), 'CL_UNSAFE_RESULT_REJECTED');
      for (const k of Object.keys(item)) {
        need(ALLOWED_RESULT_SCHEMA.checks.has(k), 'CL_UNSAFE_RESULT_REJECTED');
        need(typeof item[k] === 'string' && SAFE_CODE_RE.test(item[k]), 'CL_UNSAFE_RESULT_REJECTED');
      }
    }
  }
  for (const section of ['counts', 'record', 'document', 'archive', 'coverage']) {
    if (!(section in result)) continue;
    const obj = result[section];
    need(obj && typeof obj === 'object' && !Array.isArray(obj), 'CL_UNSAFE_RESULT_REJECTED');
    const allowed = ALLOWED_RESULT_SCHEMA[section];
    const keys = Object.keys(obj);
    need(keys.length > 0 && keys.length <= 16, 'CL_UNSAFE_RESULT_REJECTED');
    for (const k of keys) {
      need(allowed.has(k), 'CL_UNSAFE_RESULT_REJECTED');
      checkScalar(obj[k]);
    }
  }
  return result;
}

async function canonicalDirectory(directory) {
  let cursor = directory;
  for (let i = 0; i < 64; i++) {
    const info = await fs.lstat(cursor);
    need(info.isDirectory() && !info.isSymbolicLink(), 'CL_PATH_REJECTED');
    need((await fs.realpath(cursor)).toLowerCase() === cursor.toLowerCase(), 'CL_PATH_REJECTED');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
  fail('CL_PATH_DEPTH');
}

async function bounded(action, ms, code) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(code), { safeCode: code })), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function probeS3Anonymous(
  { bucket, prefix, backupId },
  request = fetch,
) {
  need(BUCKET_RE.test(bucket), 'CL_YANDEX_BUCKET_INVALID');
  need(PREFIX_RE.test(prefix), 'CL_PREFIX_REJECTED');
  uuid(backupId, 'CL_UUID_REJECTED');
  const bucketUrl = new URL(`https://storage.yandexcloud.net/${encodeURIComponent(bucket)}/`);
  const archiveUrl = new URL(`${prefix.split('/').map(encodeURIComponent).join('/')}/${backupId}.crmbackup`, bucketUrl);
  const listUrl = new URL(bucketUrl);
  listUrl.searchParams.set('list-type', '2');
  listUrl.searchParams.set('prefix', `${prefix}/`);
  listUrl.searchParams.set('max-keys', '1');
  const statusOf = async url => {
    const response = await request(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000),
    });
    const status = response.status;
    await response.body?.cancel().catch(() => {});
    return status;
  };
  const [getStatus, listStatus] = await Promise.all([statusOf(archiveUrl), statusOf(listUrl)]);
  return { getStatus, listStatus };
}

/**
 * Bounded installed-runtime cloud GUI configuration, replication, independent provider
 * restore and anonymous S3 denial check. Synthetic remote evidence is retained;
 * no automatic remote deletion or historical S3 version audit is performed.
 *
 * Never reads secrets at module load. Requires explicit `executeInstalledCloudProof: true`,
 * strict loopback origin, and a fresh synthetic profile directory under
 * `<workspace>/data/qa-v32-installed-browser/run-<runId>`.
 *
 * Parent MUST disable Playwright trace/HAR/video/debug capture and request/response
 * body listeners before invoking this helper (`parentCaptureDisabledAttested: true`).
 * `createVerifiedBackup`, `restoreFromDestination`, and `cleanupRemoteArchive` overrides are rejected so
 * fresh archive creation, catalog ownership reconciliation, and destination-specific
 * cloud restores remain under helper verification; only `afterCommand` handles parent
 * supervisor lifecycle restarts.
 */
export async function runInstalledCloudProof({
  executeInstalledCloudProof = false,
  parentCaptureDisabledAttested = true,
  page,
  base,
  runId,
  profileDirectory,
  clientId,
  injectFaultMode = 'S3_INVALID_KEY_ID_ONCE',
  afterCommand,
  createVerifiedBackup,
  mutateSyntheticClient,
  restoreFromDestination,
  loadCloudSecrets,
  anonymousProbe = probeS3Anonymous,
  ...unsupportedOptions
} = {}) {
  let stage = 'PREFLIGHT';
  let secretsMap;
  let cloudSecrets;
  let phrase;
  let recovery;
  let runPrefix;
  let createdBackupId;
  const restoredProviders = new Set();
  const checks = [];
  const pass = code => {
    need(SAFE_CODE_RE.test(code), 'CL_CHECK_CODE_INVALID');
    checks.push({ code, status: 'PASS' });
  };

  try {
    need(executeInstalledCloudProof === true, 'CL_OPT_IN_REQUIRED');
    need(parentCaptureDisabledAttested === true, 'CL_PARENT_CAPTURE_ATTESTATION_REQUIRED');
    need(
      createVerifiedBackup === undefined && restoreFromDestination === undefined &&
      !Object.hasOwn(unsupportedOptions, 'cleanupRemoteArchive'),
      'CL_UNSUPPORTED_CALLBACK_OVERRIDE_REJECTED',
    );
    need(process.platform === 'win32', 'CL_WINDOWS_REQUIRED');
    for (const envKey of ['DEBUG', 'PWDEBUG', 'NODE_OPTIONS', 'NODE_PATH', 'PLAYWRIGHT_DEBUG', 'NODE_DEBUG']) {
      need(!process.env[envKey], 'CL_UNSAFE_CONTROLLER_ENVIRONMENT');
    }
    need(
      injectFaultMode === 'S3_INVALID_KEY_ID_ONCE' || injectFaultMode === 'NONE',
      'CL_FAULT_MODE_REJECTED',
    );
    base = validateBase(base);
    runId = uuid(runId, 'CL_RUN_ID_REJECTED');
    clientId = uuid(clientId, 'CL_CLIENT_ID_REJECTED');
    profileDirectory = validateProfileDirectory(profileDirectory, runId);
    await canonicalDirectory(profileDirectory);
    need(typeof afterCommand === 'function', 'CL_AFTER_COMMAND_CALLBACK_REQUIRED');
    need(page && new URL(page.url()).origin === base, 'CL_PAGE_ORIGIN_REJECTED');

    async function request(route, method = 'GET', options = {}, binary = false) {
      let response;
      try {
        response = await page.context().request.fetch(base + route, {
          method,
          headers: { Origin: base },
          timeout: 20000,
          maxRedirects: 0,
          failOnStatusCode: false,
          ...options,
        });
        need(response.ok(), 'CL_HTTP_FAILED');
        const body = await response.body();
        need(body.length <= (binary ? 2 * 1024 * 1024 : 1024 * 1024), 'CL_RESPONSE_BOUND');
        return binary ? body : JSON.parse(body.toString('utf8'));
      } catch (e) {
        if (e?.safeCode) throw e;
        fail('CL_REQUEST_FAILED');
      } finally {
        if (response) await response.dispose().catch(() => {});
      }
    }

    const getSettings = () => request(SETTINGS_ROUTE);
    const getStatus = () => request(CONTROL_ROUTE);
    const postControl = body => request(CONTROL_ROUTE, 'POST', { data: body });

    function parseCatalog(archives) {
      need(Array.isArray(archives) && archives.length <= 1000, 'CL_CATALOG_REJECTED');
      return archives.map(a => {
        const id = uuid(a.backupId, 'CL_CATALOG_REJECTED');
        need(
          typeof a.sha256 === 'string' &&
          SHA256_RE.test(a.sha256) &&
          Number.isSafeInteger(a.size) &&
          a.size > 32 &&
          a.size <= MAX_ARCHIVE_BYTES,
          'CL_CATALOG_REJECTED',
        );
        return { backupId: id, sha256: a.sha256, bytes: a.size };
      });
    }

    function assertNoSecretsInSettingsDto(dto) {
      need(dto && typeof dto === 'object', 'CL_SETTINGS_DTO_INVALID');
      need(
        dto.secretStorage?.protection === 'windows-dpapi-current-user' &&
        dto.secretStorage?.available === true,
        'CL_DPAPI_STORAGE_REQUIRED',
      );
      need(Array.isArray(dto.destinations), 'CL_SETTINGS_DTO_INVALID');
      for (const dest of dto.destinations) {
        for (const forbiddenKey of ['credentials', 'secretAccessKey', 'accessKeyId', 'applicationPassword', 'secretRef']) {
          need(!Object.hasOwn(dest, forbiddenKey), 'CL_SECRET_LEAK_IN_SETTINGS_DTO');
        }
      }
    }

    async function runSupervisedCommand(body, expectedTerminalStatus, meta = {}) {
      // Navigate away from /settings/backups before supervisor stops server.js so
      // backup-panel's 10s status polling timer never triggers page requestfailed.
      await page.goto('about:blank');
      const queued = await postControl(body);
      need(queued?.queued === true, 'CL_COMMAND_NOT_QUEUED');
      const requestId = uuid(queued.requestId, 'CL_COMMAND_ID_REJECTED');
      const abort = new AbortController();
      let resumed;
      try {
        resumed = await bounded(
          () => afterCommand(Object.freeze({
            requestId,
            action: body.action,
            ...(meta.destinationId ? { destinationId: meta.destinationId } : {}),
            ...(meta.provider ? { provider: meta.provider } : {}),
            timeoutMs: 180000,
            signal: abort.signal,
          })),
          180000,
          'CL_LIFECYCLE_TIMEOUT',
        );
      } finally {
        abort.abort();
      }
      base = validateBase(resumed?.base);
      page = resumed?.page;
      need(page && new URL(page.url()).origin === base, 'CL_RESUMED_ORIGIN_REJECTED');
      const current = await getStatus();
      need(Array.isArray(current.jobs), 'CL_JOBS_REJECTED');
      need(
        current.jobs.some(j => j.id === requestId && j.action === body.action && j.status === expectedTerminalStatus),
        'CL_COMMAND_NOT_CONFIRMED',
      );
      return { requestId, status: current };
    }

    stage = 'FRESH_PROFILE_CHECK';
    const [initialSettings, initialStatus, initialClient] = await Promise.all([
      getSettings(),
      getStatus(),
      request(`/api/v1/clients/${clientId}`),
    ]);
    assertNoSecretsInSettingsDto(initialSettings);
    need(
      initialStatus.mode === 'desktop' &&
      initialStatus.restoreSupported === true &&
      initialStatus.standby === false,
      'CL_SUPERVISED_ACTIVE_DESKTOP_REQUIRED',
    );
    need(
      initialSettings.updatedAt === null &&
      initialSettings.destinations.length === 0 &&
      Array.isArray(initialStatus.rows) &&
      initialStatus.rows.length === 0,
      'CL_EXISTING_PROFILE_REFUSED',
    );
    need(
      initialClient?.id === clientId &&
      typeof initialClient.displayName === 'string' &&
      /^QA SYNTHETIC\b/.test(initialClient.displayName) &&
      typeof initialClient.clientKind === 'string',
      'CL_SYNTHETIC_CLIENT_REQUIRED',
    );
    const recordHash = c => sha256(JSON.stringify({
      id: c.id,
      displayName: c.displayName,
      clientKind: c.clientKind,
    }));
    const originalRecordHash = recordHash(initialClient);
    pass('FRESH_SYNTHETIC_PROFILE_AND_DPAPI_READY');

    stage = 'LOAD_SECRETS_IN_MEMORY';
    if (typeof loadCloudSecrets === 'function') {
      const provided = await loadCloudSecrets();
      cloudSecrets = extractCloudSecrets(provided);
    } else {
      const rawEnv = await fs.readFile(DEFAULT_SECRETS_FILE, 'utf8');
      secretsMap = parseSecretsEnv(rawEnv);
      cloudSecrets = extractCloudSecrets(secretsMap);
    }
    runPrefix = validatePrefix(`crm-synthetic-installed/${runId}/${randomUUID()}`, runId);
    pass('SECRETS_LOADED_AND_PREFIX_ALLOCATED');

    stage = 'GUI_CONFIGURE_AND_PROBE_PROVIDERS';
    const openBackupsPage = async (diagnoseCatalog = false) => {
      if (diagnoseCatalog) stage = 'CAT_PAGE_NAV';
      const response = await page.goto(base + '/settings/backups', { waitUntil: 'networkidle', timeout: 45000 });
      need(response?.ok(), 'CL_BACKUPS_PAGE_NAVIGATION_FAILED');
      if (diagnoseCatalog) stage = 'CAT_PAGE_HEADING';
      await page.getByRole('heading', { name: 'Локальная установка и резервные копии', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    };
    await openBackupsPage();

    const configureProviderInGui = async ({ regionLabel, bucket, email, keyId, secretValue }) => {
      const region = page.getByRole('region', { name: regionLabel, exact: true });
      await region.waitFor({ state: 'visible', timeout: 30000 });
      await region.getByRole('button', { name: `Настроить ${regionLabel}`, exact: true }).click();
      const checkbox = page.getByRole('checkbox', { name: 'Включено' });
      if (!(await checkbox.isChecked())) await checkbox.check();
      if (bucket !== undefined) await page.getByLabel('Bucket', { exact: true }).fill(bucket);
      if (email !== undefined) await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Префикс установки', { exact: true }).fill(runPrefix);
      if (keyId !== undefined) await page.getByLabel('Access key ID (новый)', { exact: true }).fill(keyId);
      const secretLabel = keyId !== undefined ? 'Secret access key' : 'Пароль внешнего приложения';
      await page.getByLabel(secretLabel, { exact: true }).fill(secretValue);
      await page.getByRole('button', { name: 'Сохранить направление', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Настройки сохранены. Пароли удалены из полей формы.' }).waitFor({ state: 'visible', timeout: 30000 });
      // Never take screenshots of backup settings or modal inputs.
      need((await page.locator('input[type="password"]').count()) === 0, 'CL_PASSWORD_INPUT_STILL_OPEN');
    };

    const probeProviderInGui = async regionLabel => {
      const region = page.getByRole('region', { name: regionLabel, exact: true });
      await region.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Чтение доступно' }).waitFor({ state: 'visible', timeout: 60000 });
      await region.getByText(/Подключено/).waitFor({ state: 'visible', timeout: 15000 });
    };

    await configureProviderInGui({
      regionLabel: 'Яндекс Облако',
      bucket: cloudSecrets.yandex.bucket,
      keyId: cloudSecrets.yandex.accessKeyId,
      secretValue: cloudSecrets.yandex.secretAccessKey,
    });
    await probeProviderInGui('Яндекс Облако');
    pass('GUI_CONFIGURED_AND_PROBED_YANDEX');

    await configureProviderInGui({
      regionLabel: 'Облако Mail.ru',
      email: cloudSecrets.mailru.email,
      secretValue: cloudSecrets.mailru.applicationPassword,
    });
    await probeProviderInGui('Облако Mail.ru');
    pass('GUI_CONFIGURED_AND_PROBED_MAILRU');

    const configuredSettings = await getSettings();
    assertNoSecretsInSettingsDto(configuredSettings);
    const yandexDest = configuredSettings.destinations.find(d => d.kind === 'yandex_s3');
    const mailruDest = configuredSettings.destinations.find(d => d.kind === 'mailru_webdav');
    need(
      yandexDest &&
      uuid(yandexDest.id) &&
      yandexDest.enabled === true &&
      yandexDest.credentialsConfigured === true &&
      yandexDest.prefix === runPrefix,
      'CL_YANDEX_SETTINGS_NOT_PERSISTENT',
    );
    need(
      mailruDest &&
      uuid(mailruDest.id) &&
      mailruDest.enabled === true &&
      mailruDest.credentialsConfigured === true &&
      mailruDest.prefix === runPrefix,
      'CL_MAILRU_SETTINGS_NOT_PERSISTENT',
    );
    const yandexId = yandexDest.id;
    const mailruId = mailruDest.id;

    // Verify empty remote catalog under the newly allocated unique prefix for both providers.
    for (const [providerCode, destId, label] of [
      ['YANDEX', yandexId, 'Яндекс Облако'],
      ['MAILRU', mailruId, 'Облако Mail.ru'],
    ]) {
      const listed = await postControl({ action: 'list', destinationId: destId });
      need(Array.isArray(listed?.archives) && listed.archives.length === 0, `CL_${providerCode}_PREFIX_NOT_EMPTY`);
      const region = page.getByRole('region', { name: label, exact: true });
      await region.getByRole('button', { name: 'Список копий / получить', exact: true }).click();
      const listDialog = page.getByRole('dialog', { name: 'Список копий', exact: true });
      await listDialog.waitFor({ state: 'visible', timeout: 30000 });
      await listDialog.getByText('Проверенных копий в этом источнике пока нет.', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
      await listDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await listDialog.waitFor({ state: 'hidden', timeout: 15000 });
    }
    pass('EMPTY_REMOTE_PREFIX_LIST_VERIFIED');

    if (injectFaultMode === 'S3_INVALID_KEY_ID_ONCE') {
      stage = 'INJECT_S3_QUEUE_FAULT';
      await configureProviderInGui({
        regionLabel: 'Яндекс Облако',
        bucket: cloudSecrets.yandex.bucket,
        keyId: `SYNTHETICFAULT${runId.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        secretValue: 'synthetic-injected-fault-secret-value',
      });
      pass('INJECTED_S3_SYNTHETIC_KEY_FAULT_ARMED');
    }

    stage = 'CREATE_VERIFIED_BACKUP';
    const beforeArchives = new Set(parseCatalog((await getStatus()).archives).map(a => a.backupId));
    const syntheticDoc = buildSyntheticDocumentPayload(runId, clientId, SYNTHETIC_DOC_BYTES);
    const uploaded = await request('/api/v1/documents', 'POST', {
      multipart: {
        file: { name: syntheticDoc.fileName, mimeType: syntheticDoc.mimeType, buffer: syntheticDoc.buffer },
        documentTypeCode: 'other',
        linkKind: 'client',
        linkId: clientId,
      },
    });
    const documentId = uuid(uploaded?.id, 'CL_DOCUMENT_ID_REJECTED');
    const downloadedBefore = await request(`/api/v1/documents/${documentId}/download`, 'GET', {}, true);
    need(
      downloadedBefore.length === syntheticDoc.bytes && sha256(downloadedBefore) === syntheticDoc.sha256,
      'CL_DOCUMENT_HASH_MISMATCH',
    );
    const documentEvidence = { documentId, bytes: syntheticDoc.bytes, sha256: syntheticDoc.sha256 };

    phrase = randomBytes(32).toString('hex');
    let rawKey = randomBytes(32).toString('hex');
    recovery = `CRM1-${rawKey}-${sha256(rawKey).slice(0, 12)}`;
    rawKey = undefined;

    const created = await runSupervisedCommand(
      { action: 'create', passphrase: phrase, recoveryKey: recovery, recoveryKeySaved: true },
      'verified',
    );
    const candidates = parseCatalog(created.status.archives).filter(a => !beforeArchives.has(a.backupId));
    need(candidates.length === 1, 'CL_CREATED_ARCHIVE_AMBIGUOUS');
    const archive = candidates[0];
    await runSupervisedCommand(
      { action: 'verify', backupId: archive.backupId, recoveryKey: recovery },
      'verified',
    );
    createdBackupId = archive.backupId;
    pass('LOCAL_ENCRYPTED_ARCHIVE_CREATED_AND_VERIFIED');

    const checkDocumentRestored = async () => {
      const bytes = await request(`/api/v1/documents/${documentEvidence.documentId}/download`, 'GET', {}, true);
      need(bytes.length === documentEvidence.bytes && sha256(bytes) === documentEvidence.sha256, 'CL_DOCUMENT_RESTORE_HASH_MISMATCH');
    };

    const waitForQueueState = async (predicate, timeoutMs, code) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const current = await getStatus();
        need(Array.isArray(current.rows), 'CL_QUEUE_ROWS_REJECTED');
        const yRow = current.rows.find(r => r.archive?.backupId === archive.backupId && r.destinationId === yandexId);
        const mRow = current.rows.find(r => r.archive?.backupId === archive.backupId && r.destinationId === mailruId);
        if (predicate({ yRow, mRow, current })) return { yRow, mRow, current };
        await delay(1500);
      }
      fail(code);
    };

    if (injectFaultMode === 'S3_INVALID_KEY_ID_ONCE') {
      stage = 'VERIFY_INDEPENDENT_QUEUE_FAILURE_AND_RECOVERY';
      await waitForQueueState(
        ({ yRow, mRow }) => yRow?.status === 'failed' && mRow?.status === 'verified',
        180000,
        'CL_INDEPENDENT_QUEUE_STATUS_TIMEOUT',
      );
      await openBackupsPage();
      await page.getByRole('region', { name: 'Облако Mail.ru', exact: true }).getByText(/Копия проверена/).waitFor({ state: 'visible', timeout: 30000 });
      await page.getByRole('region', { name: 'Яндекс Облако', exact: true }).getByText(/Есть ошибка передачи/).waitFor({ state: 'visible', timeout: 30000 });
      pass('INDEPENDENT_PROVIDER_FAILURE_AND_SUCCESS_OBSERVED');

      await configureProviderInGui({
        regionLabel: 'Яндекс Облако',
        bucket: cloudSecrets.yandex.bucket,
        keyId: cloudSecrets.yandex.accessKeyId,
        secretValue: cloudSecrets.yandex.secretAccessKey,
      });
      await probeProviderInGui('Яндекс Облако');

      const retryButton = page.getByRole('button', { name: 'Повторить это направление', exact: true });
      if (await retryButton.isVisible()) {
        await retryButton.click();
      } else {
        const latest = await getStatus();
        const yRow = latest.rows?.find(r => r.archive?.backupId === archive.backupId && r.destinationId === yandexId);
        if (yRow?.status === 'failed') {
          await postControl({ action: 'retry', backupId: archive.backupId, destinationId: yandexId });
        }
      }
      pass('FAILED_DESTINATION_RETRY_QUEUED');
    }

    stage = 'WAIT_BOTH_PROVIDERS_VERIFIED';
    await waitForQueueState(
      ({ yRow, mRow }) =>
        yRow?.status === 'verified' &&
        mRow?.status === 'verified' &&
        yRow.archive?.sha256 === archive.sha256 &&
        mRow.archive?.sha256 === archive.sha256 &&
        yRow.archive?.size === archive.bytes &&
        mRow.archive?.size === archive.bytes,
      240000,
      'CL_CLOUD_REPLICATION_TIMEOUT',
    );
    await openBackupsPage(true);
    for (const [providerCode, destId, label] of [
      ['YANDEX', yandexId, 'Яндекс Облако'],
      ['MAILRU', mailruId, 'Облако Mail.ru'],
    ]) {
      const region = page.getByRole('region', { name: label, exact: true });
      stage = `CAT_${providerCode}_STATUS`;
      await region.getByText(/Копия проверена/).waitFor({ state: 'visible', timeout: 30000 });
      stage = `CAT_${providerCode}_LIST_API`;
      const listed = await postControl({ action: 'list', destinationId: destId });
      stage = `CAT_${providerCode}_PARSE`;
      const remoteCatalog = parseCatalog(listed?.archives);
      const match = remoteCatalog.find(a => a.backupId === archive.backupId);
      stage = `CAT_${providerCode}_IDENTITY`;
      need(match && match.sha256 === archive.sha256 && match.bytes === archive.bytes, `CL_${providerCode}_REMOTE_CATALOG_MISMATCH`);

      // Verify remote catalog selection and restore modal in the real GUI before queuing supervised restore.
      stage = `CAT_${providerCode}_OPEN`;
      await region.getByRole('button', { name: 'Список копий / получить', exact: true }).click();
      const listDialog = page.getByRole('dialog', { name: 'Список копий', exact: true });
      stage = `CAT_${providerCode}_DIALOG`;
      await listDialog.waitFor({ state: 'visible', timeout: 30000 });
      // backup-panel.tsx wraps this sole select AND its options in the label.
      // Exact label text can include option text; keep strict single-control lookup.
      const select = listDialog.getByRole('combobox');
      stage = `CAT_${providerCode}_SELECT_VISIBLE`;
      await select.waitFor({ state: 'visible', timeout: 30000 });
      stage = `CAT_${providerCode}_SELECT_ARCHIVE`;
      await select.selectOption(archive.backupId);
      stage = `CAT_${providerCode}_RESTORE_OPEN`;
      await listDialog.getByRole('button', { name: 'Восстановить', exact: true }).click();
      const restoreDialog = page.getByRole('dialog', { name: 'Проверка и восстановление', exact: true });
      stage = `CAT_${providerCode}_RESTORE_DIALOG`;
      await restoreDialog.waitFor({ state: 'visible', timeout: 15000 });
      stage = `CAT_${providerCode}_ID_VISIBLE`;
      await restoreDialog.getByLabel('Идентификатор архива', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
      stage = `CAT_${providerCode}_ID_VALUE`;
      need(
        (await restoreDialog.getByLabel('Идентификатор архива', { exact: true }).inputValue()) === archive.backupId,
        `CL_${providerCode}_GUI_RESTORE_MODAL_MISMATCH`,
      );
      stage = `CAT_${providerCode}_CANCEL`;
      await restoreDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
      stage = `CAT_${providerCode}_CLOSED`;
      await restoreDialog.waitFor({ state: 'hidden', timeout: 15000 });
      pass(`REMOTE_CATALOG_AND_GUI_MODAL_VERIFIED_${providerCode}`);
    }

    for (const [iteration, providerCode, destId] of [
      [1, 'YANDEX', yandexId],
      [2, 'MAILRU', mailruId],
    ]) {
      stage = `MUTATE_AND_RESTORE_${providerCode}`;
      const beforeMutate = await request(`/api/v1/clients/${clientId}`);
      need(
        recordHash(beforeMutate) === originalRecordHash && typeof beforeMutate.updatedAt === 'string',
        `CL_PRE_MUTATION_STATE_INVALID_${providerCode}`,
      );
      if (typeof mutateSyntheticClient === 'function') {
        const abort = new AbortController();
        try {
          await bounded(
            () => mutateSyntheticClient(Object.freeze({
              page,
              base,
              clientId,
              providerCode,
              iteration,
              timeoutMs: 60000,
              signal: abort.signal,
            })),
            60000,
            `CL_MUTATE_CALLBACK_TIMEOUT_${providerCode}`,
          );
        } finally {
          abort.abort();
        }
      } else {
        const mutatedName = `QA SYNTHETIC CLOUD MUTATION ${providerCode} ${clientId}`;
        await request(`/api/v1/clients/${clientId}`, 'PATCH', {
          data: { expectedUpdatedAt: beforeMutate.updatedAt, displayName: mutatedName },
        });
      }
      const afterMutate = await request(`/api/v1/clients/${clientId}`);
      need(recordHash(afterMutate) !== originalRecordHash, `CL_MUTATION_NOT_APPLIED_${providerCode}`);
      pass(`CLIENT_MUTATED_BEFORE_${providerCode}_RESTORE`);

      need(typeof phrase === 'string' && phrase.length >= 12, 'CL_PASSPHRASE_REQUIRED_FOR_BUILTIN_RESTORE');
      await runSupervisedCommand(
        {
          action: 'restore',
          backupId: archive.backupId,
          destinationId: destId,
          passphrase: phrase,
          confirmed: true,
        },
        'restored',
        { destinationId: destId, provider: providerCode },
      );

      const restoredClient = await request(`/api/v1/clients/${clientId}`);
      need(recordHash(restoredClient) === originalRecordHash, `CL_CLIENT_NOT_RESTORED_${providerCode}`);
      await checkDocumentRestored();
      restoredProviders.add(providerCode);
      pass(`RESTORED_AND_VERIFIED_FROM_${providerCode}`);
    }

    stage = 'ANONYMOUS_S3_PROBE';
    const anon = await anonymousProbe({
      bucket: cloudSecrets.yandex.bucket,
      prefix: runPrefix,
      backupId: archive.backupId,
    });
    need(anon?.getStatus === 403 && anon?.listStatus === 403, 'CL_S3_ANONYMOUS_ACCESS_NOT_DENIED');
    pass('S3_ANONYMOUS_GET_AND_LIST_DENIED_403');

    stage = 'CONFIRM_RESTORE_EVIDENCE';
    need(
      restoredProviders.size === 2 &&
      restoredProviders.has('YANDEX') &&
      restoredProviders.has('MAILRU') &&
      createdBackupId === archive.backupId,
      'CL_RESTORE_EVIDENCE_PRECONDITION_NOT_MET',
    );

    return sanitizeResult({
      schema: 1,
      status: 'PASS',
      checks,
      counts: {
        providersConfigured: 2,
        providersProbed: 2,
        providersVerifiedInQueue: 2,
        providersRestored: restoredProviders.size,
        anonymousDenied: 2,
      },
      record: {
        clientId,
        sha256: originalRecordHash,
        restoredMatches: true,
      },
      document: {
        documentId: documentEvidence.documentId,
        bytes: documentEvidence.bytes,
        sha256: documentEvidence.sha256,
        restoredMatches: true,
      },
      archive: {
        backupId: archive.backupId,
        bytes: archive.bytes,
        sha256: archive.sha256,
        sameArchiveAcrossProviders: true,
      },
      coverage: {
        secretStorage: 'WINDOWS_DPAPI_CURRENT_USER',
        parentCaptureAttestation: 'PARENT_NON_RECORDING_CONTEXT_REQUIRED',
        guiConfigurationAndProbe: 'INSTALLED_MANAGER_BACKUP_PANEL_UI',
        cloudUploadAndVerify: 'SUPERVISED_WORKER_REPLICATION_QUEUE',
        independentQueueFailure: injectFaultMode === 'S3_INVALID_KEY_ID_ONCE'
          ? 'INJECTED_SYNTHETIC_S3_KEY_ID_NOT_PHYSICAL_NETWORK_CUT'
          : 'NOT_INJECTED',
        cloudDownloadAndRestore: 'SUPERVISED_DESTINATION_RESTORE_YANDEX_AND_MAILRU',
      },
      remoteCleanup: RETAINED_REMOTE_EVIDENCE,
    });
  } catch (e) {
    fail(diagnosticCode(e, stage));
  } finally {
    phrase = undefined;
    recovery = undefined;
    runPrefix = undefined;
    if (secretsMap && typeof secretsMap === 'object') {
      for (const k of Object.keys(secretsMap)) delete secretsMap[k];
    }
    if (cloudSecrets && typeof cloudSecrets === 'object') {
      if (cloudSecrets.yandex) {
        cloudSecrets.yandex.bucket = '';
        cloudSecrets.yandex.accessKeyId = '';
        cloudSecrets.yandex.secretAccessKey = '';
      }
      if (cloudSecrets.mailru) {
        cloudSecrets.mailru.email = '';
        cloudSecrets.mailru.applicationPassword = '';
      }
    }
    secretsMap = undefined;
    cloudSecrets = undefined;
  }
}

async function selfTest() {
  // Pure deterministic diagnostics checks: no browser, filesystem or cloud calls.
  for (const stage of DIAGNOSTIC_STAGES) {
    for (const kind of DIAGNOSTIC_KINDS) {
      const code = `CL_${kind}_${stage}`;
      assert.ok(code.length <= 64 && SAFE_CODE_RE.test(code));
    }
  }
  const diagnosticStage = 'CAT_MAILRU_SELECT_ARCHIVE';
  assert.equal(diagnosticCode({ safeCode: 'CL_HTTP_FAILED', name: 'TimeoutError' }, diagnosticStage), 'CL_HTTP_FAILED');
  assert.equal(diagnosticCode({ safeCode: 'A'.repeat(64) }, diagnosticStage), 'A'.repeat(64));
  assert.equal(diagnosticCode({ name: 'TimeoutError', message: 'SYNTHETIC_PRIVATE_VALUE' }, diagnosticStage), 'CL_UI_TIMEOUT_CAT_MAILRU_SELECT_ARCHIVE');
  assert.equal(diagnosticCode({ message: 'strict mode violation: SYNTHETIC_PRIVATE_VALUE' }, diagnosticStage), 'CL_LOCATOR_STRICT_CAT_MAILRU_SELECT_ARCHIVE');
  for (const error of [null, {}, new Error('SYNTHETIC_PRIVATE_VALUE'), { safeCode: 'A'.repeat(65) }, { safeCode: 'https://example.test/private' }]) {
    assert.equal(diagnosticCode(error, diagnosticStage), 'CL_OTHER_CAT_MAILRU_SELECT_ARCHIVE');
  }
  assert.equal(diagnosticCode({}, 'SYNTHETIC_PRIVATE_VALUE'), 'CL_OTHER_PREFLIGHT');
  assert.equal(DEFAULT_SECRETS_FILE, String.raw`D:\crm-secrets\clouds.env`);
  const sampleRunId = '11111111-2222-4333-8444-555555555555';
  const sampleArchiveId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  assert.equal(validateBase('http://127.0.0.1:43210'), 'http://127.0.0.1:43210');
  for (const badBase of [
    'http://localhost:43210',
    'https://127.0.0.1:43210',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:43210/path',
    'http://192.168.1.1:43210',
  ]) {
    assert.throws(() => validateBase(badBase), /CL_BASE_REJECTED/);
  }

  const validRunRoot = path.win32.join(workspace, 'data', 'qa-v32-installed-browser', `run-${sampleRunId}`);
  const validSubdir = path.win32.join(validRunRoot, 'localappdata');
  assert.equal(validateProfileDirectory(validRunRoot, sampleRunId), validRunRoot);
  assert.equal(validateProfileDirectory(validSubdir, sampleRunId), validSubdir);

  for (const badDir of [
    'C:\\Users\\RealUser\\AppData\\Local\\RealEstateCRM',
    path.win32.join(workspace, 'data', 'qa-v32-installed-browser', 'run-22222222-2222-4333-8444-555555555555'),
    path.win32.join(validRunRoot, '..', 'other'),
    `${validRunRoot}:stream`,
    `${validRunRoot}.`,
    '\\\\server\\share\\profile',
  ]) {
    assert.throws(() => validateProfileDirectory(badDir, sampleRunId), /CL_PROFILE_DIRECTORY_REJECTED|CL_EXISTING_PROFILE_REFUSED/);
  }

  const validPrefix = `crm-synthetic-installed/${sampleRunId}/${sampleArchiveId}`;
  assert.equal(validatePrefix(validPrefix, sampleRunId), validPrefix);
  for (const badPrefix of [
    'crm',
    `crm-synthetic-smoke/${sampleRunId}`,
    `crm-synthetic-installed/22222222-2222-4333-8444-555555555555/${sampleArchiveId}`,
    `crm-synthetic-installed/${sampleRunId}/../other`,
  ]) {
    assert.throws(() => validatePrefix(badPrefix, sampleRunId), /CL_PREFIX_REJECTED/);
  }

  const parsedEnv = parseSecretsEnv([
    '# comment line',
    'export YC_S3_BUCKET="synthetic-test-bucket-01"',
    'YC_S3_ACCESS_KEY_ID=SYNTHETIC_ACCESS_KEY',
    "YC_S3_SECRET_ACCESS_KEY='SYNTHETIC_SECRET_ACCESS_KEY'",
    'MAILRU_EMAIL=synthetic@example.test',
    'MAILRU_APP_PASSWORD=SYNTHETIC_APP_PASSWORD_VALUE',
  ].join('\n'));
  const extracted = extractCloudSecrets(parsedEnv);
  assert.equal(extracted.yandex.bucket, 'synthetic-test-bucket-01');
  assert.equal(extracted.mailru.email, 'synthetic@example.test');
  assert.throws(() => extractCloudSecrets({}), /CL_CLOUD_CONFIGURATION_MISSING/);

  const syntheticDoc = buildSyntheticDocumentPayload(sampleRunId, sampleArchiveId, 4096);
  assert.equal(syntheticDoc.fileName, 'synthetic-cloud-proof.txt');
  assert.equal(syntheticDoc.mimeType, 'text/plain');
  assert.equal(syntheticDoc.bytes, 4096);
  assert.equal(syntheticDoc.buffer.length, 4096);
  assert.equal(sha256(syntheticDoc.buffer), syntheticDoc.sha256);
  assert.notEqual(syntheticDoc.buffer.subarray(0, 2).toString('latin1'), 'MZ');

  assert.doesNotThrow(() => sanitizeResult({
    schema: 1,
    status: 'PASS',
    checks: [{ code: 'SAMPLE_CHECK', status: 'PASS' }],
    counts: { providersConfigured: 2 },
    remoteCleanup: RETAINED_REMOTE_EVIDENCE,
    record: { clientId: sampleArchiveId, sha256: 'a'.repeat(64), restoredMatches: true },
    document: { documentId: sampleArchiveId, bytes: 4096, sha256: 'b'.repeat(64), restoredMatches: true },
    archive: { backupId: sampleArchiveId, bytes: 8192, sha256: 'c'.repeat(64), sameArchiveAcrossProviders: true },
    coverage: {
      secretStorage: 'WINDOWS_DPAPI_CURRENT_USER',
      parentCaptureAttestation: 'PARENT_NON_RECORDING_CONTEXT_REQUIRED',
    },
  }));
  for (const unsafeVal of [
    { bucket: 'synthetic-test-bucket-01' },
    { email: 'synthetic@example.test' },
    { url: 'https://storage.yandexcloud.net/bucket' },
    { prefix: validPrefix },
    { secret: 'my-secret-Password-123' },
    { schema: 1, status: 'PASS', arbitraryKey: 'UPPERCASE_SECRET_TOKEN' },
    { schema: 1, status: 'PASS', counts: { unknownCount: 1 } },
    { counts: { remainingCreatedObjects: 0 } },
    { counts: { cleanedProviders: 2 } },
    { counts: { deletedMailruParts: 2 } },
    { remoteCleanup: { status: 'CLEANED', historicalS3Versions: 'NOT_AUDITED' } },
    { remoteCleanup: { status: 'SYNTHETIC_EVIDENCE_RETAINED' } },
    { remoteCleanup: { ...RETAINED_REMOTE_EVIDENCE, remainingCreatedObjects: 0 } },
    { remoteCleanup: { ...RETAINED_REMOTE_EVIDENCE, historicalS3Versions: 'AUDITED' } },
  ]) {
    assert.throws(() => sanitizeResult(unsafeVal), /CL_UNSAFE_RESULT_REJECTED/);
  }

  await assert.rejects(
    () => runInstalledCloudProof({ executeInstalledCloudProof: false }),
    err => err?.safeCode === 'CL_OPT_IN_REQUIRED',
  );
  await assert.rejects(
    () => runInstalledCloudProof({ executeInstalledCloudProof: true, parentCaptureDisabledAttested: false }),
    err => err?.safeCode === 'CL_PARENT_CAPTURE_ATTESTATION_REQUIRED',
  );
  await assert.rejects(
    () => runInstalledCloudProof({ executeInstalledCloudProof: true, createVerifiedBackup: () => {} }),
    err => err?.safeCode === 'CL_UNSUPPORTED_CALLBACK_OVERRIDE_REJECTED',
  );
  await assert.rejects(
    () => runInstalledCloudProof({ executeInstalledCloudProof: true, restoreFromDestination: () => {} }),
    err => err?.safeCode === 'CL_UNSUPPORTED_CALLBACK_OVERRIDE_REJECTED',
  );

  // Early rejection only: neither the removed callback nor secret loading may run.
  let cleanupCalled = false;
  let secretsLoaded = false;
  for (const unsupportedCleanup of [() => { cleanupCalled = true; }, null, undefined]) {
    await assert.rejects(
      () => runInstalledCloudProof({
        executeInstalledCloudProof: true,
        cleanupRemoteArchive: unsupportedCleanup,
        loadCloudSecrets: () => { secretsLoaded = true; },
      }),
      err => err?.safeCode === 'CL_UNSUPPORTED_CALLBACK_OVERRIDE_REJECTED',
    );
  }
  assert.equal(cleanupCalled, false);
  assert.equal(secretsLoaded, false);
  assert.deepEqual(sanitizeResult({ remoteCleanup: RETAINED_REMOTE_EVIDENCE }), {
    remoteCleanup: { status: 'SYNTHETIC_EVIDENCE_RETAINED', historicalS3Versions: 'NOT_AUDITED' },
  });
  console.log('INSTALLED_CLOUD_PROOF_PURE_HELPERS_PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') {
    selfTest().catch(e => {
      console.error(JSON.stringify({ status: 'SELF_TEST_FAILED', code: diagnosticCode(e, 'PREFLIGHT') }));
      process.exitCode = 1;
    });
  } else {
    console.error(JSON.stringify({ status: 'REFUSED', code: 'CL_LIBRARY_ONLY_USE_COORDINATOR' }));
    process.exitCode = 1;
  }
}
