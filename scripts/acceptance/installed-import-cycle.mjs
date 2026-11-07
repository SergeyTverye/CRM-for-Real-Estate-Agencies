/**
 * Bounded installed-app UI acceptance helper for the synthetic Enterprise Workbook
 * import / dry-run / profile-remap / commit / receipt-tied export / roundtrip-reimport cycle.
 *
 * Security & privacy contract:
 * - Zero top-level side effects on module import.
 * - Accepts ONLY `{ page, base, directory }` in `runInstalledImportCycle`.
 * - Enforces loopback `http://127.0.0.1:<port>` base and canonical fresh directory under
 *   `<workspace>\data\qa-v32-installed-browser\run-<UUID>\import-cycle`.
 * - Never accesses original/private workbooks, `.env`, secrets, or arbitrary user file paths.
 * - Returns a closed, redacted result schema containing only booleans, finite counts,
 *   UUIDs, SHA-256 digests, byte lengths, and fixed code labels.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

export const RESULT_SCHEMA = 'installed-import-cycle/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const CODE_RE = /^[a-z0-9_.:-]{1,80}$/i;
const FORBIDDEN_PII_HEADERS = ['Паспорт', 'Кем выдан', 'Регистрация', 'Дата рождения'];

const ALLOWED_FLOW_STEPS = new Set([
  'wizard_locate',
  'profile_upload',
  'initial_dry_run',
  'remap',
  'commit',
  'export',
  'roundtrip',
]);

function isTimeoutLike(error) {
  if (error?.name === 'TimeoutError') return true;
  const message = typeof error?.message === 'string' ? error.message : '';
  return /timeout|timed out|waiting for|exceeded/i.test(message);
}

function stepDiagnosticCode(error, step, fallback = 'import_cycle_failed') {
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  if (code && CODE_RE.test(code)) return code;
  const fixedStep = typeof step === 'string' && ALLOWED_FLOW_STEPS.has(step) ? step : null;
  if (!fixedStep) return fallback;
  return isTimeoutLike(error) ? `${fixedStep}_timeout` : `${fixedStep}_assertion_failed`;
}

const ALLOWED_COVERAGE_LABELS = new Set([
  'property',
  'property_agreement_control',
  'client_request_need',
  'historical_deal_archive',
  'ignore_sheet',
  'ignore_column',
  'policy_exclusion_pii',
  'profile_v2_remap',
  'receipt_tied_export',
  'compatibility_report',
  'roundtrip_reimport_idempotency',
]);

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function diagnosticCode(error, fallback = 'import_cycle_failed') {
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  if (code && CODE_RE.test(code)) return code;
  return fallback;
}

function failWithCode(code) {
  const err = new Error(code);
  err.code = code;
  throw err;
}

export function validateBase(base) {
  if (typeof base !== 'string' || !base) {
    failWithCode('invalid_base_type');
  }
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    failWithCode('invalid_base_url');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !parsed.port ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    failWithCode('invalid_base_loopback_contract');
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    failWithCode('invalid_base_port');
  }
  return `http://127.0.0.1:${port}`;
}

function canonicalExistingDirectory(dirPath) {
  const resolved = path.resolve(dirPath);
  const parsed = path.parse(resolved);
  const relative = path.relative(parsed.root, resolved);
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      failWithCode('symlink_in_directory_ancestry');
    }
  }
  return fs.realpathSync(resolved);
}

export function validateDirectory(directory, workspaceRootInput) {
  if (typeof directory !== 'string' || !directory.trim()) {
    failWithCode('invalid_directory_type');
  }
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const workspaceRoot = canonicalExistingDirectory(workspaceRootInput ?? defaultRoot);
  const target = path.resolve(directory);
  const rel = path.relative(workspaceRoot, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    failWithCode('directory_outside_workspace');
  }
  const parts = rel.split(path.sep);
  if (
    parts.length !== 4 ||
    parts[0] !== 'data' ||
    parts[1] !== 'qa-v32-installed-browser' ||
    !/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[2]) ||
    parts[3] !== 'import-cycle'
  ) {
    failWithCode('directory_contract_mismatch');
  }
  return { workspaceRoot, target };
}

function prepareFreshDirectory(directory, workspaceRootInput) {
  const { workspaceRoot, target } = validateDirectory(directory, workspaceRootInput);
  if (fs.existsSync(target)) {
    failWithCode('directory_already_exists');
  }
  const parentDir = path.dirname(target);
  fs.mkdirSync(parentDir, { recursive: true });
  const canonicalParent = canonicalExistingDirectory(parentDir);
  const expectedParent = path.join(
    workspaceRoot,
    'data',
    'qa-v32-installed-browser',
    path.basename(parentDir),
  );
  const normalizedCanonicalParent =
    process.platform === 'win32'
      ? path.resolve(canonicalParent).toLowerCase()
      : path.resolve(canonicalParent);
  const normalizedExpectedParent =
    process.platform === 'win32'
      ? path.resolve(expectedParent).toLowerCase()
      : path.resolve(expectedParent);
  if (normalizedCanonicalParent !== normalizedExpectedParent) {
    failWithCode('directory_parent_canonical_mismatch');
  }
  fs.mkdirSync(target, { recursive: false });
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    failWithCode('directory_not_canonical_folder');
  }
  return fs.realpathSync(target);
}

function writeOwnedFile(dir, fileName, buffer) {
  if (
    typeof fileName !== 'string' ||
    !/^[a-z0-9._-]{1,64}$/i.test(fileName) ||
    fileName.includes('..')
  ) {
    failWithCode('invalid_owned_filename');
  }
  const fullPath = path.join(dir, fileName);
  if (path.dirname(fullPath) !== dir) {
    failWithCode('owned_file_escape');
  }
  if (fs.existsSync(fullPath)) {
    failWithCode('owned_file_already_exists');
  }
  fs.writeFileSync(fullPath, buffer, { flag: 'wx' });
  const stat = fs.lstatSync(fullPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    failWithCode('owned_file_invalid_stat');
  }
  return fullPath;
}

/**
 * Builds a small, deterministic, 100% synthetic multi-sheet enterprise workbook in memory.
 * - Uses only synthetic addresses, synthetic marker UUIDs, and non-PII placeholders.
 * - Includes an intentionally unmapped column (`Внутренний шифр QA`) on sheet 1 so the UI
 *   dry-run surfaces an `unresolved` entry that must be resolved via the v2 profile editor.
 * - Includes a supported numeric formula (`B2*1000`) on sheet 1 (`Цена, руб/мес`) and valid
 *   HTTPS hyperlinks on sheet 1 (`Описание`) and sheet 2 (`Ссылка на рекламу`) so receipt-tied
 *   export formula and hyperlink preservation are genuinely exercised.
 * - Includes forbidden PII columns (`Паспорт`, `Кем выдан`, `Регистрация`, `Дата рождения`)
 *   with synthetic sentinel strings to prove they are excluded from operational DB and exports.
 * - Includes a `Черновик не для CRM` sheet that is mapped to `ignore` in the v2 profile and
 *   whose cells are cleared on receipt-based export while preserving sheet geometry.
 */
export async function buildSyntheticEnterpriseWorkbook(runMarker) {
  if (typeof runMarker !== 'string' || !UUID_RE.test(runMarker)) {
    failWithCode('invalid_run_marker');
  }
  const shortTag = runMarker.slice(0, 8).toUpperCase();
  const phoneSeed = String(parseInt(runMarker.slice(0, 8), 16) % 10000000).padStart(7, '0');
  const syntheticPhone = `+7 (900) ${phoneSeed.slice(0, 3)}-${phoneSeed.slice(3, 5)}-${phoneSeed.slice(5, 7)}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Synthetic Acceptance Suite';
  wb.created = new Date('2026-03-01T00:00:00.000Z');

  // 1. Sheet: property + historical_deal_archive (stacked sections on one sheet)
  const wsObjects = wb.addWorksheet('База объектов');
  wsObjects.addRow([
    'Адрес',
    'Площадь',
    'Цена, руб/мес',
    'Операция',
    'Описание',
    'Примечание',
    'Внутренний шифр QA',
    'Паспорт',
    'Кем выдан',
    'Регистрация',
    'Дата рождения',
  ]);
  wsObjects.addRow([
    `г. Пермь, ул. Синтетическая, д. 10, оф. ${shortTag}`,
    125.5,
    { formula: 'B2*1000', result: 125500 },
    'Аренда',
    {
      text: `Описание объекта QA-PROP-${runMarker}`,
      hyperlink: `https://agency.example/property/${shortTag.toLowerCase()}`,
    },
    `QA-PROP-${runMarker}`,
    `QA-UNRESOLVED-${shortTag}`,
    '0000 000000',
    'ТЕСТОВЫЙ ОТДЕЛ QA',
    'г. Пермь, ул. Тестовая, 1',
    '01.01.1980',
  ]);
  wsObjects.addRow([]);
  wsObjects.addRow([
    '№',
    'Дата сделки',
    'Адрес объекта',
    'Клиент',
    'Договор',
    'Комиссия',
  ]);
  wsObjects.addRow([
    `HIST-${shortTag}`,
    '2025-11-15',
    `г. Пермь, пр. Архивный, д. 5 (${runMarker})`,
    `ООО АрхивСторона-${shortTag}`,
    `ДГ-АРХ-${runMarker}`,
    95000,
  ]);

  // 2. Sheet: property_agreement_control
  const wsControl = wb.addWorksheet('Контроль договоров');
  wsControl.addRow([
    'Адрес',
    'Площадь',
    'Цена',
    'Операция',
    'Наличие договора',
    'Комиссия',
    'Что нужно исправить',
    'Площадка',
    'Статус рекламы',
    'Ссылка на рекламу',
    'Рекл. текст',
    'Задача',
  ]);
  wsControl.addRow([
    `г. Пермь, ул. Контрольная, д. 22, пом. ${shortTag}`,
    210,
    350000,
    'Продажа',
    'Да',
    50000,
    `QA-CTRL-${runMarker}`,
    'Авито',
    'Опубликовано',
    {
      text: `https://avito.example/qa-${shortTag.toLowerCase()}`,
      hyperlink: `https://avito.example/qa-${shortTag.toLowerCase()}`,
    },
    `Синтетический рекламный текст ${runMarker}`,
    `Проверить актуальность договора ${shortTag}`,
  ]);

  // 3. Sheet: client_request_need
  const wsClients = wb.addWorksheet('Обращения и потребности');
  wsClients.addRow([
    '№',
    'Клиент',
    'Телефон',
    'E-mail',
    'Дата обращения',
    'Запрос',
    'Операция',
    'Комментарий',
    'Паспорт',
  ]);
  wsClients.addRow([
    `REQ-${shortTag}`,
    `ООО КлиентСинтетик-${shortTag}`,
    syntheticPhone,
    `qa-${shortTag.toLowerCase()}@synthetic.example`,
    '2026-03-15',
    `Аренда офиса ${shortTag} (${runMarker})`,
    'Аренда',
    `QA-NEED-${runMarker}`,
    '9999 999999',
  ]);

  // 4. Sheet: ignore worksheet (unrecognized headers on initial auto-detect, then mapped to ignore)
  const wsIgnore = wb.addWorksheet('Черновик не для CRM');
  wsIgnore.addRow(['Служебное поле А', 'Служебное поле Б']);
  wsIgnore.addRow([`SKIP-${shortTag}`, 42]);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Transforms the dry-run profile v2 JSON (`enterpriseProfileSchema`) so that:
 * - Any sheet without a recognized target (`target === null` and no valid `blockTargets`)
 *   is mapped to `target = "ignore"`.
 * - Any unresolved block target (`blockTargets[row] === null`) is mapped to `"ignore"`.
 * - Any unresolved column (`columns[header] === null`) is explicitly mapped to `"ignore"`.
 */
export function resolveProfileV2Draft(profileDraft) {
  if (
    !isPlainObject(profileDraft) ||
    profileDraft.version !== 2 ||
    profileDraft.code !== 'enterprise_workbook_v2' ||
    !Array.isArray(profileDraft.sheets)
  ) {
    failWithCode('invalid_profile_v2_draft');
  }
  const next = JSON.parse(JSON.stringify(profileDraft));
  let resolvedColumns = 0;
  let ignoredSections = 0;

  for (const sheet of next.sheets) {
    if (!isPlainObject(sheet)) continue;

    if (isPlainObject(sheet.blockTargets)) {
      for (const [rowKey, blockTarget] of Object.entries(sheet.blockTargets)) {
        if (blockTarget === null) {
          sheet.blockTargets[rowKey] = 'ignore';
          ignoredSections += 1;
        }
      }
    }

    const hasActiveBlockTargets =
      isPlainObject(sheet.blockTargets) &&
      Object.values(sheet.blockTargets).some((t) => typeof t === 'string' && t !== 'ignore');

    if ((sheet.target === null && !hasActiveBlockTargets) || sheet.target === 'ignore') {
      sheet.target = 'ignore';
      ignoredSections += 1;
    }

    if (!isPlainObject(sheet.columns)) {
      sheet.columns = {};
    }
    for (const [colKey, mapped] of Object.entries(sheet.columns)) {
      if (mapped === null || mapped === 'unresolved') {
        sheet.columns[colKey] = 'ignore';
        resolvedColumns += 1;
      }
    }
  }

  return { profile: next, resolvedColumns, ignoredSections };
}

/**
 * Inspects the exported XLSX buffer with ExcelJS to verify:
 * - Expected synthetic sheets exist (`База объектов`, `Контроль договоров`, `Обращения и потребности`, `Черновик не для CRM`).
 * - The ignored sheet (`Черновик не для CRM`) has all cell values cleared on export while preserving worksheet geometry.
 * - Forbidden PII sentinel values (`0000 000000`, `9999 999999`, `ТЕСТОВЫЙ ОТДЕЛ QA`)
 *   do NOT appear anywhere in the exported workbook.
 * - Exported workbook preserves safe formula cells and CRM-backed hyperlink cells.
 * - Exported rows contain the `runMarker`.
 */
export async function inspectExportedWorkbook(buffer, runMarker) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheetNames = wb.worksheets.map((ws) => ws.name);
  const hasObjectsSheet = sheetNames.includes('База объектов');
  const hasControlSheet = sheetNames.includes('Контроль договоров');
  const hasClientsSheet = sheetNames.includes('Обращения и потребности');
  const hasIgnoredDraftSheet = sheetNames.includes('Черновик не для CRM');

  const ignoredWs = wb.getWorksheet('Черновик не для CRM');
  let ignoredSheetNonEmptyCells = 0;
  if (ignoredWs) {
    ignoredWs.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          ignoredSheetNonEmptyCells += 1;
        }
      });
    });
  }
  const ignoredDraftSheetCleared = Boolean(ignoredWs) && ignoredSheetNonEmptyCells === 0;

  let formulaCells = 0;
  let hyperlinkCells = 0;
  let markerMatches = 0;
  let forbiddenPiiFound = false;

  for (const ws of wb.worksheets) {
    const piiColumns = new Set();
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const val = cell.value;
        if (
          val &&
          typeof val === 'object' &&
          (('formula' in val && typeof val.formula === 'string') ||
            ('sharedFormula' in val && typeof val.sharedFormula === 'string'))
        ) {
          formulaCells += 1;
        }
        if (
          (val && typeof val === 'object' && 'hyperlink' in val && typeof val.hyperlink === 'string') ||
          (typeof cell.hyperlink === 'string' && cell.hyperlink.length > 0)
        ) {
          hyperlinkCells += 1;
        }
        const text =
          typeof val === 'string'
            ? val
            : val && typeof val === 'object' && typeof val.text === 'string'
              ? val.text
              : val && typeof val === 'object' && 'result' in val && val.result !== undefined
                ? String(val.result)
                : String(val ?? '');
        if (text.includes(runMarker)) {
          markerMatches += 1;
        }
        if (rowNumber === 1) {
          for (const piiHeader of FORBIDDEN_PII_HEADERS) {
            if (text.trim().toLowerCase() === piiHeader.toLowerCase()) {
              piiColumns.add(colNumber);
            }
          }
        } else if (piiColumns.has(colNumber) && text.trim().length > 0) {
          forbiddenPiiFound = true;
        }
        if (
          text.includes('0000 000000') ||
          text.includes('9999 999999') ||
          text.includes('ТЕСТОВЫЙ ОТДЕЛ QA') ||
          text.includes('01.01.1980')
        ) {
          forbiddenPiiFound = true;
        }
      });
    });
  }

  return {
    sheetCount: wb.worksheets.length,
    hasObjectsSheet,
    hasControlSheet,
    hasClientsSheet,
    hasIgnoredDraftSheet,
    ignoredDraftSheetCleared,
    formulaCells,
    hyperlinkCells,
    markerMatches,
    piiExcluded: !forbiddenPiiFound,
  };
}

async function fetchJsonInPage(page, urlPath) {
  return page.evaluate(async (targetPath) => {
    const res = await fetch(targetPath, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, ok: res.ok, body };
  }, urlPath);
}

async function fetchMarkerDomainCounts(page, runMarker) {
  const shortTag = runMarker.slice(0, 8).toUpperCase();
  const qMarker = encodeURIComponent(runMarker);
  const qTag = encodeURIComponent(shortTag);

  const [propsRes, clientsRes, needsRes, requestsRes, agreementsRes, adsRes, tasksRes] =
    await Promise.all([
      fetchJsonInPage(page, `/api/v1/properties?q=${qTag}&pageSize=50`),
      fetchJsonInPage(page, `/api/v1/clients?q=${qTag}&pageSize=50`),
      fetchJsonInPage(page, `/api/v1/needs?q=${qTag}&pageSize=50`),
      fetchJsonInPage(page, `/api/v1/requests?q=${qMarker}&pageSize=50`),
      fetchJsonInPage(page, `/api/v1/agreements?q=${qTag}&pageSize=50`),
      fetchJsonInPage(page, `/api/v1/advertisements?q=${qMarker}&pageSize=50`),
      fetchJsonInPage(page, `/api/v1/tasks?view=all&pageSize=100`),
    ]);

  const countItems = (res, predicate) => {
    const items = Array.isArray(res?.body?.items)
      ? res.body.items
      : Array.isArray(res?.body?.data)
        ? res.body.data
        : [];
    return items.filter(predicate).length;
  };

  const properties = countItems(
    propsRes,
    (p) => String(p?.addressText ?? p?.address ?? '').includes(shortTag),
  );
  const clients = countItems(
    clientsRes,
    (c) => String(c?.displayName ?? c?.fullName ?? '').includes(shortTag),
  );
  const needs = countItems(
    needsRes,
    (n) => String(n?.client?.displayName ?? '').includes(shortTag),
  );
  const requests = countItems(
    requestsRes,
    (r) =>
      String(r?.summary ?? '').includes(runMarker) ||
      String(r?.client?.displayName ?? '').includes(shortTag),
  );
  const agreements = countItems(
    agreementsRes,
    (a) =>
      String(a?.actionRequired ?? '').includes(runMarker) ||
      String(a?.property?.addressText ?? '').includes(shortTag) ||
      String(a?.agreementNumber ?? a?.number ?? '').includes(shortTag),
  );
  const advertisements = countItems(
    adsRes,
    (a) =>
      String(a?.adText ?? '').includes(runMarker) ||
      String(a?.url ?? '').includes(shortTag.toLowerCase()) ||
      String(a?.property?.addressText ?? '').includes(shortTag),
  );
  const tasks = countItems(
    tasksRes,
    (t) =>
      String(t?.title ?? '').includes(shortTag) ||
      String(t?.description ?? '').includes(shortTag) ||
      (Array.isArray(t?.links) &&
        t.links.some((link) => String(link?.label ?? '').includes(shortTag))),
  );

  return {
    properties,
    clients,
    needs,
    requests,
    agreements,
    advertisements,
    tasks,
    totalOperational:
      properties + clients + needs + requests + agreements + advertisements + tasks,
  };
}

export function sanitizeResult(raw) {
  const checksInput = isPlainObject(raw?.checks) ? raw.checks : {};
  const countsInput = isPlainObject(raw?.counts) ? raw.counts : {};
  const artifactsInput = isPlainObject(raw?.artifacts) ? raw.artifacts : {};

  const checks = {
    actorAuthorizedManager: Boolean(checksInput.actorAuthorizedManager),
    initialDryRunCompleted: Boolean(checksInput.initialDryRunCompleted),
    unresolvedDetectedBeforeRemap: Boolean(checksInput.unresolvedDetectedBeforeRemap),
    profileRemapApplied: Boolean(checksInput.profileRemapApplied),
    dryRunSeparationVerified: Boolean(checksInput.dryRunSeparationVerified),
    zeroDomainWritesBeforeCommit: Boolean(checksInput.zeroDomainWritesBeforeCommit),
    humanConfirmationsChecked: Boolean(checksInput.humanConfirmationsChecked),
    commitCompleted: Boolean(checksInput.commitCompleted),
    domainRecordsCreatedAfterCommit: Boolean(checksInput.domainRecordsCreatedAfterCommit),
    compatibilityReportVerified: Boolean(checksInput.compatibilityReportVerified),
    exportWorkbookVerified: Boolean(checksInput.exportWorkbookVerified),
    policyExclusionVerified: Boolean(checksInput.policyExclusionVerified),
    roundtripDryRunCompleted: Boolean(checksInput.roundtripDryRunCompleted),
    roundtripCommitZeroDuplicates: Boolean(checksInput.roundtripCommitZeroDuplicates),
  };

  const toSafeCount = (val) => {
    const n = Number(val);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  };

  const counts = {
    initialSectionsDetected: toSafeCount(countsInput.initialSectionsDetected),
    initialUnresolvedCount: toSafeCount(countsInput.initialUnresolvedCount),
    remappedUnresolvedCount: toSafeCount(countsInput.remappedUnresolvedCount),
    dryRunTotalRows: toSafeCount(countsInput.dryRunTotalRows),
    dryRunValidRows: toSafeCount(countsInput.dryRunValidRows),
    preCommitOperationalRecords: toSafeCount(countsInput.preCommitOperationalRecords),
    committedImportedRows: toSafeCount(countsInput.committedImportedRows),
    committedSkippedRows: toSafeCount(countsInput.committedSkippedRows),
    committedFailedRows: toSafeCount(countsInput.committedFailedRows),
    postCommitProperties: toSafeCount(countsInput.postCommitProperties),
    postCommitClients: toSafeCount(countsInput.postCommitClients),
    postCommitAgreements: toSafeCount(countsInput.postCommitAgreements),
    postCommitAdvertisements: toSafeCount(countsInput.postCommitAdvertisements),
    postCommitTasks: toSafeCount(countsInput.postCommitTasks),
    postCommitOperationalRecords: toSafeCount(countsInput.postCommitOperationalRecords),
    exportedSheetCount: toSafeCount(countsInput.exportedSheetCount),
    exportedFormulaCells: toSafeCount(countsInput.exportedFormulaCells),
    exportedHyperlinkCells: toSafeCount(countsInput.exportedHyperlinkCells),
    roundtripDuplicateRows: toSafeCount(countsInput.roundtripDuplicateRows),
    roundtripImportedRows: toSafeCount(countsInput.roundtripImportedRows),
    postRoundtripOperationalRecords: toSafeCount(countsInput.postRoundtripOperationalRecords),
  };

  const safeUuid = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);
  const safeSha = (v) => (typeof v === 'string' && SHA256_RE.test(v) ? v.toLowerCase() : null);

  const artifacts = {
    runMarker: safeUuid(artifactsInput.runMarker),
    primaryJobId: safeUuid(artifactsInput.primaryJobId),
    roundtripJobId: safeUuid(artifactsInput.roundtripJobId),
    syntheticWorkbookBytes: toSafeCount(artifactsInput.syntheticWorkbookBytes),
    syntheticWorkbookSha256: safeSha(artifactsInput.syntheticWorkbookSha256),
    exportedWorkbookBytes: toSafeCount(artifactsInput.exportedWorkbookBytes),
    exportedWorkbookSha256: safeSha(artifactsInput.exportedWorkbookSha256),
  };

  const rawCoverage = Array.isArray(raw?.coverage) ? raw.coverage : [];
  const coverage = Array.from(
    new Set(rawCoverage.filter((item) => typeof item === 'string' && ALLOWED_COVERAGE_LABELS.has(item))),
  );

  const allChecksPassed = Object.values(checks).every(Boolean);
  const status = raw?.status === 'PASS' && allChecksPassed ? 'PASS' : 'FAIL';
  const errorCode =
    status === 'PASS'
      ? null
      : typeof raw?.errorCode === 'string' && CODE_RE.test(raw.errorCode)
        ? raw.errorCode
        : 'import_cycle_failed';

  return Object.freeze({
    schema: RESULT_SCHEMA,
    status,
    errorCode,
    checks: Object.freeze(checks),
    counts: Object.freeze(counts),
    artifacts: Object.freeze(artifacts),
    coverage: Object.freeze(coverage),
  });
}

/**
 * Executes the bounded synthetic enterprise import/export/reimport acceptance cycle
 * against an already-authenticated Manager session on the installed loopback app.
 */
export async function runInstalledImportCycle({ page, base, directory } = {}) {
  const state = {
    status: 'FAIL',
    errorCode: null,
    checks: {},
    counts: {},
    artifacts: {},
    coverage: [],
  };
  let currentStep = 'wizard_locate';

  try {
    if (!page || typeof page.goto !== 'function' || typeof page.evaluate !== 'function') {
      failWithCode('invalid_page_handle');
    }
    const normalizedBase = validateBase(base);
    const canonicalDir = prepareFreshDirectory(directory);

    // Verify current page origin if already navigated
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    if (currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith(normalizedBase)) {
      failWithCode('page_origin_mismatch');
    }

    // 1. Verify authenticated actor is manager
    await page.goto(`${normalizedBase}/import`, { waitUntil: 'networkidle' });
    if (!page.url().startsWith(`${normalizedBase}/import`)) {
      failWithCode('import_page_navigation_rejected');
    }

    const meRes = await fetchJsonInPage(page, '/api/v1/auth/me');
    const role = meRes?.body?.user?.role ?? meRes?.body?.role ?? null;
    if (!meRes.ok || role !== 'manager') {
      failWithCode('actor_not_manager');
    }
    state.checks.actorAuthorizedManager = true;

    // 2. Build owned synthetic workbook inside canonical fresh directory
    const runMarker = crypto.randomUUID();
    state.artifacts.runMarker = runMarker;

    const syntheticBuffer = await buildSyntheticEnterpriseWorkbook(runMarker);
    state.artifacts.syntheticWorkbookBytes = syntheticBuffer.byteLength;
    state.artifacts.syntheticWorkbookSha256 = sha256Buffer(syntheticBuffer);
    const syntheticFilePath = writeOwnedFile(canonicalDir, 'synthetic-enterprise-input.xlsx', syntheticBuffer);

    // 3. Locate EnterpriseImportWizard section on `/import`
    const wizardSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Рабочая книга объектов и обращений' }) })
      .first();
    currentStep = 'wizard_locate';
    await wizardSection.waitFor({ state: 'visible', timeout: 15000 });

    // Select auto profile mode & upload synthetic workbook.
    // NOTE: `<label>` wraps the select so its accessible name includes the
    // selected option; getByLabel('Профиль') resolves to zero nodes.
    // Use the single scoped combobox instead (product UI unchanged).
    const profileSelect = wizardSection.getByRole('combobox');
    if ((await profileSelect.count()) !== 1) {
      failWithCode('profile_select_not_unique');
    }
    currentStep = 'profile_upload';
    await profileSelect.selectOption('auto');

    const fileInput = wizardSection.getByLabel('Синтетическая или разрешённая локальная книга .xlsx');
    await fileInput.setInputFiles(syntheticFilePath);

    // Run initial dry-run via UI button (`POST /api/v1/import/enterprise` followed by `GET /api/v1/import/enterprise/${id}`)
    currentStep = 'initial_dry_run';
    const dryRunPostPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/v1/import/enterprise') &&
        res.request().method() === 'POST',
    );
    const dryRunInspectPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/import/enterprise/') &&
        !res.url().endsWith('/export') &&
        res.request().method() === 'GET',
    );
    await wizardSection.getByRole('button', { name: 'Проверить без загрузки в CRM' }).click();
    const initialDryRunRes = await dryRunPostPromise;
    if (!initialDryRunRes.ok()) {
      failWithCode('initial_dry_run_http_error');
    }
    const initialPostReport = await initialDryRunRes.json();
    if (!initialPostReport?.id || !UUID_RE.test(initialPostReport.id)) {
      failWithCode('initial_dry_run_missing_job_id');
    }
    const initialInspectRes = await dryRunInspectPromise;
    if (!initialInspectRes.ok()) {
      failWithCode('initial_dry_run_inspect_http_error');
    }
    const initialReport = await initialInspectRes.json();
    state.artifacts.primaryJobId = initialReport.id;
    state.checks.initialDryRunCompleted = true;
    state.counts.initialSectionsDetected = Array.isArray(initialReport.rows)
      ? new Set(initialReport.rows.map((r) => r?.sourceSection).filter(Boolean)).size
      : Array.isArray(initialReport?.profile?.sheets)
        ? initialReport.profile.sheets.length
        : 0;
    state.counts.initialUnresolvedCount = Array.isArray(initialReport.unresolved)
      ? initialReport.unresolved.length
      : 0;

    // Verify that the unmapped column / draft sheet surfaced unresolved items requiring profile remap
    if (state.counts.initialUnresolvedCount < 1) {
      failWithCode('expected_unresolved_before_remap');
    }
    const unresolvedAlert = wizardSection.getByRole('alert');
    await unresolvedAlert.waitFor({ state: 'visible', timeout: 10000 });
    state.checks.unresolvedDetectedBeforeRemap = true;

    // 4. Open v2 profile mapping editor in UI, resolve unmapped column & draft sheet, and re-run dry-run
    currentStep = 'remap';
    const mappingSummary = wizardSection.locator('summary', {
      hasText: 'Настройка сопоставления колонок и скрытых строк',
    });
    await mappingSummary.click();

    const profileTextarea = wizardSection.getByRole('textbox', { name: 'Профиль v2' });
    await profileTextarea.waitFor({ state: 'visible', timeout: 10000 });
    const rawDraftText = await profileTextarea.inputValue();
    let parsedDraft;
    try {
      parsedDraft = JSON.parse(rawDraftText);
    } catch {
      failWithCode('profile_v2_textarea_invalid_json');
    }

    const { profile: resolvedProfile } = resolveProfileV2Draft(parsedDraft);
    const resolvedProfileJson = JSON.stringify(resolvedProfile, null, 2);
    await profileTextarea.fill(resolvedProfileJson);

    const remapPatchPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/import/enterprise/${initialReport.id}`) &&
        res.request().method() === 'PATCH',
    );
    const remapInspectPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/import/enterprise/${initialReport.id}`) &&
        res.request().method() === 'GET',
    );
    await wizardSection
      .getByRole('button', { name: 'Применить профиль и повторить dry-run' })
      .click();
    const remapRes = await remapPatchPromise;
    if (!remapRes.ok()) {
      failWithCode('profile_remap_http_error');
    }
    const remapInspectRes = await remapInspectPromise;
    if (!remapInspectRes.ok()) {
      failWithCode('profile_remap_inspect_http_error');
    }
    const remappedReport = await remapInspectRes.json();
    state.counts.remappedUnresolvedCount = Array.isArray(remappedReport?.unresolved)
      ? remappedReport.unresolved.length
      : 0;
    if (state.counts.remappedUnresolvedCount !== 0) {
      failWithCode('unresolved_remaining_after_remap');
    }
    state.checks.profileRemapApplied = true;
    state.counts.dryRunTotalRows = Number(remappedReport?.counts?.total ?? 0);
    state.counts.dryRunValidRows =
      Number(remappedReport?.counts?.ready ?? 0) + Number(remappedReport?.counts?.warning ?? 0);

    // 5. Verify validationStatus vs commitResult separation in dry-run report & UI preview table
    const previewRows = Array.isArray(remappedReport?.rows) ? remappedReport.rows : [];
    if (previewRows.length < 4) {
      failWithCode('dry_run_preview_rows_missing');
    }
    const allHaveValidationAndNullCommit = previewRows.every(
      (r) =>
        typeof r.validationStatus === 'string' &&
        r.validationStatus.length > 0 &&
        (r.commitResult === null || r.commitResult === undefined),
    );
    if (!allHaveValidationAndNullCommit) {
      failWithCode('dry_run_commit_result_not_null');
    }

    const previewSummary = wizardSection.locator('summary', {
      hasText: 'Предпросмотр по листам и разделам (координаты и коды)',
    });
    await previewSummary.click();
    const previewTableCells = await wizardSection
      .locator('table tbody tr td:nth-child(6)')
      .allInnerTexts();
    const uiShowsUncommittedDash =
      previewTableCells.length > 0 && previewTableCells.every((txt) => txt.trim() === '—');
    if (!uiShowsUncommittedDash) {
      failWithCode('ui_preview_commit_column_not_dash');
    }
    state.checks.dryRunSeparationVerified = true;

    // 6. Verify ZERO operational domain writes occurred during dry-run / remap before commit
    const preCommitCounts = await fetchMarkerDomainCounts(page, runMarker);
    state.counts.preCommitOperationalRecords = preCommitCounts.totalOperational;
    if (preCommitCounts.totalOperational !== 0) {
      failWithCode('domain_writes_occurred_before_commit');
    }
    state.checks.zeroDomainWritesBeforeCommit = true;

    // 7. Check human confirmation checkboxes and click "Загрузить в CRM"
    currentStep = 'commit';
    const commitButton = wizardSection.getByRole('button', { name: 'Загрузить в CRM' });
    if (await commitButton.isEnabled()) {
      failWithCode('commit_button_enabled_without_confirmations');
    }

    const warningsCheckbox = wizardSection.getByLabel(
      'Предупреждения проверены; неоднозначные сведения потребуют ручного уточнения',
    );
    const confirmCheckbox = wizardSection.getByLabel(
      'Подтверждаю загрузку допустимых строк, пропуск ошибок и дублей',
    );
    await warningsCheckbox.check();
    await confirmCheckbox.check();
    if (!(await commitButton.isEnabled())) {
      failWithCode('commit_button_disabled_after_confirmations');
    }
    state.checks.humanConfirmationsChecked = true;

    const commitPostPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/import/enterprise/${initialReport.id}`) &&
        res.request().method() === 'POST',
    );
    const commitInspectPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/import/enterprise/${initialReport.id}`) &&
        res.request().method() === 'GET',
    );
    await commitButton.click();
    const commitRes = await commitPostPromise;
    if (!commitRes.ok()) {
      failWithCode('commit_http_error');
    }
    const commitPayload = await commitRes.json();
    const commitInspectRes = await commitInspectPromise;
    if (!commitInspectRes.ok()) {
      failWithCode('commit_inspect_http_error');
    }
    const commitInspectPayload = await commitInspectRes.json();
    state.counts.committedImportedRows = Number(
      commitInspectPayload?.rowsImported ?? commitPayload?.imported ?? 0,
    );
    state.counts.committedSkippedRows = Number(
      commitInspectPayload?.rowsSkipped ?? commitPayload?.skipped ?? 0,
    );
    state.counts.committedFailedRows = Number(
      commitInspectPayload?.rowsError ?? commitPayload?.rowsFailed ?? 0,
    );

    await wizardSection.getByRole('status').waitFor({ state: 'visible', timeout: 15000 });
    if (state.counts.committedImportedRows < 4 || state.counts.committedFailedRows !== 0) {
      failWithCode('commit_unexpected_row_counts');
    }
    state.checks.commitCompleted = true;

    // 8. Verify created operational domain records after commit
    const postCommitCounts = await fetchMarkerDomainCounts(page, runMarker);
    state.counts.postCommitProperties = postCommitCounts.properties;
    state.counts.postCommitClients = postCommitCounts.clients;
    state.counts.postCommitAgreements = postCommitCounts.agreements;
    state.counts.postCommitAdvertisements = postCommitCounts.advertisements;
    state.counts.postCommitTasks = postCommitCounts.tasks;
    state.counts.postCommitOperationalRecords = postCommitCounts.totalOperational;

    if (
      postCommitCounts.properties < 2 ||
      postCommitCounts.clients < 1 ||
      postCommitCounts.needs < 1 ||
      postCommitCounts.requests < 1 ||
      postCommitCounts.agreements < 1 ||
      postCommitCounts.advertisements < 1 ||
      postCommitCounts.tasks < 2
    ) {
      failWithCode('expected_domain_entities_missing_after_commit');
    }
    state.checks.domainRecordsCreatedAfterCommit = true;

    // 9. Click "Отчёт совместимости" button and verify receipt-tied compatibility header & UI output
    currentStep = 'export';
    const compatResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/import/enterprise/${initialReport.id}/export`) &&
        res.request().method() === 'GET',
    );
    await wizardSection.getByRole('button', { name: 'Отчёт совместимости' }).click();
    const compatRes = await compatResponsePromise;
    if (!compatRes.ok()) {
      failWithCode('compatibility_report_http_error');
    }
    const compatHeaderRaw = compatRes.headers()['x-import-compatibility'] ?? '';
    let compatJson = null;
    try {
      compatJson = compatHeaderRaw ? JSON.parse(compatHeaderRaw) : null;
    } catch {
      compatJson = null;
    }
    const compatPre = wizardSection.locator('pre').first();
    await compatPre.waitFor({ state: 'visible', timeout: 10000 });
    if (
      !isPlainObject(compatJson) ||
      typeof compatJson.UNSUPPORTED_COLUMN !== 'number' ||
      compatJson.UNSUPPORTED_COLUMN < 1 ||
      typeof compatJson.HYPERLINK_PRESERVED !== 'number' ||
      compatJson.HYPERLINK_PRESERVED < 1 ||
      typeof compatJson.FORMULA_PRESERVED !== 'number' ||
      compatJson.FORMULA_PRESERVED < 1
    ) {
      failWithCode('compatibility_report_invalid_payload');
    }
    state.checks.compatibilityReportVerified = true;

    // 10. Download receipt-tied XLSX export via UI link (`В формат рабочего Excel`)
    const exportLink = wizardSection.getByRole('link', { name: 'В формат рабочего Excel' });
    await exportLink.waitFor({ state: 'visible', timeout: 10000 });
    const exportHref = await exportLink.getAttribute('href');
    if (exportHref !== `/api/v1/import/enterprise/${initialReport.id}/export`) {
      failWithCode('export_link_href_mismatch');
    }

    const exportedBase64 = await page.evaluate(async (href) => {
      const res = await fetch(href, { method: 'GET', credentials: 'same-origin' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return {
        base64: btoa(binary),
        compatHeader: res.headers.get('X-Import-Compatibility') ?? '',
      };
    }, exportHref);

    if (!exportedBase64 || !exportedBase64.base64 || !exportedBase64.compatHeader) {
      failWithCode('export_xlsx_download_failed');
    }

    const exportedBuffer = Buffer.from(exportedBase64.base64, 'base64');
    state.artifacts.exportedWorkbookBytes = exportedBuffer.byteLength;
    state.artifacts.exportedWorkbookSha256 = sha256Buffer(exportedBuffer);
    const exportedFilePath = writeOwnedFile(
      canonicalDir,
      'exported-enterprise-roundtrip.xlsx',
      exportedBuffer,
    );

    const inspection = await inspectExportedWorkbook(exportedBuffer, runMarker);
    state.counts.exportedSheetCount = inspection.sheetCount;
    state.counts.exportedFormulaCells = inspection.formulaCells;
    state.counts.exportedHyperlinkCells = inspection.hyperlinkCells;

    if (
      !inspection.hasObjectsSheet ||
      !inspection.hasControlSheet ||
      !inspection.hasClientsSheet ||
      !inspection.hasIgnoredDraftSheet ||
      !inspection.ignoredDraftSheetCleared ||
      inspection.formulaCells < 1 ||
      inspection.hyperlinkCells < 1 ||
      inspection.markerMatches < 3
    ) {
      failWithCode('exported_workbook_structure_invalid');
    }
    state.checks.exportWorkbookVerified = true;

    if (!inspection.piiExcluded) {
      failWithCode('exported_workbook_leaked_forbidden_pii');
    }
    state.checks.policyExclusionVerified = true;

    // 11. Reimport the exported workbook with the confirmed v2 profile through UI dry-run + commit
    // Same scoped combobox: custom mode reuses the single wizard select.
    currentStep = 'roundtrip';
    const resolvedProfilePath = writeOwnedFile(
      canonicalDir,
      'resolved-profile-v2.json',
      Buffer.from(resolvedProfileJson, 'utf8'),
    );
    await profileSelect.selectOption('custom');
    const profileFileInput = wizardSection.getByLabel('Профиль JSON');
    await profileFileInput.setInputFiles(resolvedProfilePath);
    await fileInput.setInputFiles(exportedFilePath);

    const roundtripPostPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/v1/import/enterprise') &&
        res.request().method() === 'POST',
    );
    const roundtripInspectPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/import/enterprise/') &&
        !res.url().endsWith('/export') &&
        res.request().method() === 'GET',
    );
    await wizardSection.getByRole('button', { name: 'Проверить без загрузки в CRM' }).click();
    const roundtripDryRunRes = await roundtripPostPromise;
    if (!roundtripDryRunRes.ok()) {
      failWithCode('roundtrip_dry_run_http_error');
    }
    const roundtripPostPayload = await roundtripDryRunRes.json();
    if (!roundtripPostPayload?.id || !UUID_RE.test(roundtripPostPayload.id)) {
      failWithCode('roundtrip_dry_run_missing_job_id');
    }
    const roundtripInspectRes = await roundtripInspectPromise;
    if (!roundtripInspectRes.ok()) {
      failWithCode('roundtrip_dry_run_inspect_http_error');
    }
    const roundtripReport = await roundtripInspectRes.json();
    state.artifacts.roundtripJobId = roundtripReport.id;
    const roundtripRows = Array.isArray(roundtripReport?.rows) ? roundtripReport.rows : [];
    state.counts.roundtripDuplicateRows = roundtripRows.filter(
      (r) =>
        Array.isArray(r?.warningCodes) &&
        r.warningCodes.some((c) => c === 'already_imported' || c === 'probable_duplicate'),
    ).length;
    if (
      Array.isArray(roundtripReport.unresolved) &&
      roundtripReport.unresolved.length > 0
    ) {
      failWithCode('roundtrip_unexpected_unresolved_columns');
    }
    if (state.counts.roundtripDuplicateRows < 3) {
      failWithCode('roundtrip_duplicates_not_detected');
    }
    state.checks.roundtripDryRunCompleted = true;

    await warningsCheckbox.check();
    await confirmCheckbox.check();

    const roundtripCommitPostPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/import/enterprise/${roundtripReport.id}`) &&
        res.request().method() === 'POST',
    );
    const roundtripCommitInspectPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/v1/import/enterprise/${roundtripReport.id}`) &&
        res.request().method() === 'GET',
    );
    await commitButton.click();
    const roundtripCommitRes = await roundtripCommitPostPromise;
    if (!roundtripCommitRes.ok()) {
      failWithCode('roundtrip_commit_http_error');
    }
    const roundtripCommitPayload = await roundtripCommitRes.json();
    const roundtripCommitInspectRes = await roundtripCommitInspectPromise;
    if (!roundtripCommitInspectRes.ok()) {
      failWithCode('roundtrip_commit_inspect_http_error');
    }
    const roundtripCommitInspectPayload = await roundtripCommitInspectRes.json();
    state.counts.roundtripImportedRows = Number(
      roundtripCommitInspectPayload?.rowsImported ?? roundtripCommitPayload?.imported ?? 0,
    );

    const postRoundtripCounts = await fetchMarkerDomainCounts(page, runMarker);
    state.counts.postRoundtripOperationalRecords = postRoundtripCounts.totalOperational;

    if (
      state.counts.roundtripImportedRows !== 0 ||
      postRoundtripCounts.totalOperational !== postCommitCounts.totalOperational
    ) {
      failWithCode('roundtrip_created_duplicate_operational_records');
    }
    state.checks.roundtripCommitZeroDuplicates = true;

    state.coverage = [
      'property',
      'property_agreement_control',
      'client_request_need',
      'historical_deal_archive',
      'ignore_sheet',
      'ignore_column',
      'policy_exclusion_pii',
      'profile_v2_remap',
      'receipt_tied_export',
      'compatibility_report',
      'roundtrip_reimport_idempotency',
    ];
    state.status = 'PASS';
  } catch (err) {
    state.status = 'FAIL';
    state.errorCode = stepDiagnosticCode(err, currentStep, 'import_cycle_failed');
  }

  return sanitizeResult(state);
}

/**
 * Pure in-memory self-test verifying validation guards, synthetic workbook generation,
 * profile v2 remap transformation, export inspection, and closed result redaction.
 */
export async function selfTest() {
  // 1. Base URL validation
  const validBase = validateBase('http://127.0.0.1:3000/');
  if (validBase !== 'http://127.0.0.1:3000') {
    failWithCode('selftest_base_normalization_failed');
  }
  for (const badBase of [
    'https://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3000/import',
    'http://192.168.1.10:3000',
  ]) {
    let rejected = false;
    try {
      validateBase(badBase);
    } catch {
      rejected = true;
    }
    if (!rejected) failWithCode('selftest_bad_base_accepted');
  }

  // 2. Directory contract validation
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sampleRunId = '11111111-2222-4333-8444-555555555555';
  const validDir = path.join(root, 'data', 'qa-v32-installed-browser', `run-${sampleRunId}`, 'import-cycle');
  const validated = validateDirectory(validDir, root);
  if (validated.target !== validDir) {
    failWithCode('selftest_directory_validation_failed');
  }

  for (const badDir of [
    path.join(root, 'data', 'other', `run-${sampleRunId}`, 'import-cycle'),
    path.join(root, 'data', 'qa-v32-installed-browser', 'run-not-a-uuid', 'import-cycle'),
    path.join(root, '..', 'outside-import-cycle'),
  ]) {
    let rejected = false;
    try {
      validateDirectory(badDir, root);
    } catch {
      rejected = true;
    }
    if (!rejected) failWithCode('selftest_bad_directory_accepted');
  }

  // 3. Synthetic workbook + PII detection + formula/hyperlink fixture check
  const marker = '22222222-3333-4444-8555-666666666666';
  const syntheticBuf = await buildSyntheticEnterpriseWorkbook(marker);
  const rawInspection = await inspectExportedWorkbook(syntheticBuf, marker);
  if (
    rawInspection.piiExcluded !== false ||
    rawInspection.ignoredDraftSheetCleared !== false ||
    rawInspection.formulaCells < 1 ||
    rawInspection.hyperlinkCells < 2 ||
    rawInspection.markerMatches < 3
  ) {
    failWithCode('selftest_synthetic_input_fixture_invalid');
  }

  // 4. Profile v2 remap transformation check
  const sampleProfileDraft = {
    version: 2,
    code: 'enterprise_workbook_v2',
    sheets: [
      {
        index: 1,
        target: null,
        blockTargets: { 1: 'property', 4: 'historical_deal_archive' },
        columns: { адрес: 'addressText', площадь: 'area', 'внутренний шифр qa': null },
        headerRow: 'auto',
        hiddenRows: 'skip',
        defaults: { propertyType: 'commercial' },
        sections: [],
      },
      {
        index: 4,
        target: null,
        columns: {},
        headerRow: 'auto',
        hiddenRows: 'skip',
        defaults: { propertyType: 'commercial' },
        sections: [],
      },
    ],
  };
  const remappedDraft = resolveProfileV2Draft(sampleProfileDraft);
  if (
    remappedDraft.profile.sheets[0].target !== null ||
    remappedDraft.profile.sheets[0].blockTargets['1'] !== 'property' ||
    remappedDraft.profile.sheets[0].columns['внутренний шифр qa'] !== 'ignore' ||
    remappedDraft.profile.sheets[1].target !== 'ignore' ||
    remappedDraft.resolvedColumns !== 1 ||
    remappedDraft.ignoredSections !== 1
  ) {
    failWithCode('selftest_profile_v2_remap_failed');
  }

  // 5. Closed redaction check
  const redacted = sanitizeResult({
    status: 'FAIL',
    errorCode: 'actor_not_manager',
    secretLeakAttempt: 'MUST_NOT_APPEAR',
    checks: { actorAuthorizedManager: false },
    counts: { initialSectionsDetected: 4, negativeCount: -5 },
    artifacts: {
      runMarker: marker,
      filePathLeak: 'C:\\secret\\path.xlsx',
    },
    coverage: ['property', 'unlisted_label'],
  });
  if (
    'secretLeakAttempt' in redacted ||
    'filePathLeak' in redacted.artifacts ||
    redacted.counts.negativeCount !== undefined ||
    redacted.coverage.includes('unlisted_label')
  ) {
    failWithCode('selftest_redaction_contract_broken');
  }

  // 6. Closed step diagnostics: explicit codes preserved, unclassified errors
  // map to allowlisted `<step>_timeout` / `<step>_assertion_failed` only.
  const timeoutLike = Object.assign(new Error('Timeout 15000ms exceeded'), { name: 'TimeoutError' });
  if (stepDiagnosticCode(timeoutLike, 'initial_dry_run') !== 'initial_dry_run_timeout') {
    failWithCode('selftest_step_timeout_mapping_failed');
  }
  if (stepDiagnosticCode(new Error('boom'), 'remap') !== 'remap_assertion_failed') {
    failWithCode('selftest_step_assertion_mapping_failed');
  }
  const explicitCoded = Object.assign(new Error('x'), { code: 'commit_http_error' });
  if (stepDiagnosticCode(explicitCoded, 'commit') !== 'commit_http_error') {
    failWithCode('selftest_explicit_code_not_preserved');
  }

  const rejectedPage = await runInstalledImportCycle();
  if (rejectedPage.status !== 'FAIL' || rejectedPage.errorCode !== 'invalid_page_handle') {
    failWithCode('selftest_error_path_broken');
  }
  return { ok: true, schema: RESULT_SCHEMA };
}

const isDirectEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectEntry && process.argv.includes('--self-test')) {
  selfTest()
    .then((res) => {
      process.stdout.write(`${JSON.stringify(res)}\n`);
    })
    .catch((err) => {
      process.stderr.write(`${JSON.stringify({ ok: false, errorCode: diagnosticCode(err) })}\n`);
      process.exitCode = 1;
    });
}
