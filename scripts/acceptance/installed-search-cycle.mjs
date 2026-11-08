import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESULT_SCHEMA = 'installed-search-cycle/v1';
const RUN_DIR_RE = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[a-z0-9_.:-]{1,80}$/i;
const STEPS = new Set(['page_load', 'source_settings', 'availability', 'collapse', 'tooltips', 'purpose', 'credentials']);
const COV = new Set([
  'source_toggle_persist',
  'availability_agreement',
  'enabled_not_server_disabled',
  'disabling_honored',
  'missing_ai_key_distinct',
  'credential_ui_dpapi_save_replace_remove',
  'collapse_retains_filters',
  'active_count_retained',
  'primary_cta_in_viewport',
  'primary_collapse_contract',
  'whole_filter_retention_independence',
  'tooltip_focus_keyboard',
  'residential_purpose',
  'credential_metadata_only',
]);

// Actual UI labels from public source contracts (codebook/externalSource + ai-settings-form).
const SOURCE_LABELS = ['Циан', 'Мир Квартир', 'OnRealt', 'Домклик', 'Яндекс Недвижимость', 'Юла', 'Авито'];
// Labels append a visible availability suffix; match the fixed human name.
function checkboxByName(host, label) {
  return host.getByRole('checkbox', { name: new RegExp('^' + label + '(?:\\s|\\(|$)') });
}
async function needSourceCheckbox(host, label) {
  const control = checkboxByName(host, label);
  if (await control.count() !== 1) fail('source_switch_ui_missing');
  return control;
}
const AI_CREDENTIAL_ALLOWED_KEYS = new Set(['configured', 'source', 'editable', 'status']);
const MISSING_AI_KEY_MESSAGE = 'Требуется подключение Яндекс AI';

function fail(code) {
  const e = new Error(code);
  e.code = code;
  throw e;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function isTimeoutError(e) {
  return e?.name === 'TimeoutError' || /timeout|timed out|waiting for|exceeded/i.test(e?.message || '');
}
function stepCode(e, step, fallback = 'search_cycle_failed') {
  const c = typeof e?.code === 'string' ? e.code.trim() : '';
  if (c && CODE_RE.test(c)) return c;
  const s = typeof step === 'string' && STEPS.has(step) ? step : null;
  if (!s) return fallback;
  return isTimeoutError(e) ? `${s}_timeout` : `${s}_assertion_failed`;
}

export function validateBase(base) {
  if (typeof base !== 'string' || !base) fail('invalid_base_type');
  let p;
  try { p = new URL(base); } catch { fail('invalid_base_url'); }
  if (p.protocol !== 'http:' || p.hostname !== '127.0.0.1' || !p.port || p.pathname !== '/' || p.search || p.hash || p.username || p.password) {
    fail('invalid_base_loopback_contract');
  }
  const port = Number(p.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('invalid_base_port');
  return `http://127.0.0.1:${port}`;
}

function canonDir(d) {
  const r = path.resolve(d);
  const parsed = path.parse(r);
  const rel = path.relative(parsed.root, r);
  const parts = rel ? rel.split(path.sep).filter(Boolean) : [];
  let cur = parsed.root;
  for (const part of parts) {
    cur = path.join(cur, part);
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) fail('symlink_in_directory_ancestry');
  }
  return fs.realpathSync(r);
}

export function validateDirectory(directory, rootInput) {
  if (typeof directory !== 'string' || !directory.trim()) fail('invalid_directory_type');
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const root = canonDir(rootInput ?? defaultRoot);
  const target = path.resolve(directory);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('directory_outside_workspace');
  const parts = rel.split(path.sep);
  if (parts.length !== 4 || parts[0] !== 'data' || parts[1] !== 'qa-v32-installed-browser' || !RUN_DIR_RE.test(parts[2]) || parts[3] !== 'search-cycle') {
    fail('directory_contract_mismatch');
  }
  return { workspaceRoot: root, target };
}

function prepDir(directory, rootInput) {
  const { workspaceRoot, target } = validateDirectory(directory, rootInput);
  if (fs.existsSync(target)) fail('directory_already_exists');
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const canonParent = canonDir(parent);
  const expectedParent = path.join(workspaceRoot, 'data', 'qa-v32-installed-browser', path.basename(parent));
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  if (norm(canonParent) !== norm(expectedParent)) fail('directory_parent_canonical_mismatch');
  fs.mkdirSync(target, { recursive: false });
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink() || !st.isDirectory()) fail('directory_not_canonical_folder');
  return fs.realpathSync(target);
}

async function fetchJson(page, endpoint) {
  return page.evaluate(async (target) => {
    const r = await fetch(target, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, ok: r.ok, body };
  }, endpoint);
}

async function waitForSave(page, successText, timeout = 12000) {
  try {
    await page.getByText(successText, { exact: true }).last().waitFor({ state: 'visible', timeout });
  } catch {
    fail('save_confirmation_not_observed');
  }
  // Do not treat an error alert as success.
  const alertCount = await page.locator('[role="alert"]').filter({ hasText: /ошиб|недоступ|конфликт|проверь/i }).count().catch(() => 0);
  if (alertCount > 0) fail('save_reported_error_alert');
}

async function openAndSaveSources(page, base, mutate) {
  await page.goto(`${base}/settings/sources`, { waitUntil: 'networkidle' });
  if (!page.url().startsWith(`${base}/settings/sources`)) fail('settings_page_navigation_rejected');
  await mutate(page);
  const save = page.getByRole('button', { name: 'Сохранить настройки источников' });
  if (await save.count() === 0) fail('source_settings_save_missing');
  await save.click();
  await waitForSave(page, 'Настройки источников сохранены');
}

async function mustScreenshot(page, filePath, code) {
  try {
    const passwordCount = await page.locator('input[type="password"]').count();
    if (passwordCount !== 0) fail(code);
    await page.screenshot({ path: filePath, fullPage: false });
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size === 0) fail(code);
  } catch (e) {
    if (e && typeof e.code === 'string' && CODE_RE.test(e.code)) throw e;
    fail(code);
  }
}

export function sanitizeResult(raw) {
  const ci = isObj(raw?.checks) ? raw.checks : {};
  const ni = isObj(raw?.counts) ? raw.counts : {};
  const ai = isObj(raw?.artifacts) ? raw.artifacts : {};
  const checks = {
    actorAuthorizedManager: Boolean(ci.actorAuthorizedManager),
    searchPageLoaded: Boolean(ci.searchPageLoaded),
    sourceTogglePersisted: Boolean(ci.sourceTogglePersisted),
    availabilityAgrees: Boolean(ci.availabilityAgrees),
    enabledNotDisabledByServer: Boolean(ci.enabledNotDisabledByServer),
    disablingHonored: Boolean(ci.disablingHonored),
    missingAiKeyDistinct: Boolean(ci.missingAiKeyDistinct),
    collapseRetainsFilters: Boolean(ci.collapseRetainsFilters),
    activeCountRetained: Boolean(ci.activeCountRetained),
    primaryCtaInViewport: Boolean(ci.primaryCtaInViewport),
    primaryCollapseContract: Boolean(ci.primaryCollapseContract),
    wholeFilterRetentionIndependence: Boolean(ci.wholeFilterRetentionIndependence),
    tooltipFocusKeyboardDismiss: Boolean(ci.tooltipFocusKeyboardDismiss),
    residentialPurposeAvailable: Boolean(ci.residentialPurposeAvailable),
    credentialMetadataOnly: Boolean(ci.credentialMetadataOnly),
    credentialUiDpapiRoundtrip: Boolean(ci.credentialUiDpapiRoundtrip),
  };
  const safeCount = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  };
  const counts = {
    sourceTogglesTested: safeCount(ni.sourceTogglesTested),
    advancedFiltersRetained: safeCount(ni.advancedFiltersRetained),
    activeFilterCount: safeCount(ni.activeFilterCount),
    tooltipChecks: safeCount(ni.tooltipChecks),
  };
  const safeSha = (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null);
  const artifacts = {
    screenshotBytes: safeCount(ai.screenshotBytes),
    screenshotSha256: safeSha(ai.screenshotSha256),
  };
  const coverage = Array.from(new Set((Array.isArray(raw?.coverage) ? raw.coverage : []).filter((x) => typeof x === 'string' && COV.has(x))));
  const all = Object.values(checks).every(Boolean);
  const status = raw?.status === 'PASS' && all ? 'PASS' : 'FAIL';
  const errorCode = status === 'PASS' ? null : (typeof raw?.errorCode === 'string' && CODE_RE.test(raw.errorCode) ? raw.errorCode : 'search_cycle_failed');
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

export async function runInstalledSearchCycle({ page, base, directory } = {}) {
  const state = { status: 'FAIL', errorCode: null, checks: {}, counts: {}, artifacts: {}, coverage: [] };
  let step = 'page_load';
  try {
    if (!page || typeof page.goto !== 'function' || typeof page.evaluate !== 'function') fail('invalid_page_handle');
    const normalizedBase = validateBase(base);
    const cycleDir = prepDir(directory);
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    if (currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith(normalizedBase)) fail('page_origin_mismatch');

    await page.goto(`${normalizedBase}/property-search`, { waitUntil: 'networkidle' });
    if (!page.url().startsWith(`${normalizedBase}/property-search`)) fail('search_page_navigation_rejected');
    state.checks.searchPageLoaded = true;

    // /api/v1/auth/me returns a flat object {id,login,displayName,role,mustChangePassword}.
    const me = await fetchJson(page, '/api/v1/auth/me');
    if (!me.ok || me?.body?.role !== 'manager') fail('actor_not_manager');
    state.checks.actorAuthorizedManager = true;

    step = 'purpose';
    const residential = page.getByLabel('Жилая', { exact: true }).first();
    if (await residential.count() === 0) fail('residential_purpose_ui_missing');
    const residentialRole = await residential.getAttribute('type').catch(() => null);
    if (residentialRole !== 'checkbox') fail('residential_purpose_not_checkbox');
    // Assert actual check state is readable (default unchecked unless persisted otherwise).
    await residential.isChecked();
    state.checks.residentialPurposeAvailable = true;
    state.coverage.push('residential_purpose');

    step = 'source_settings';
    await page.goto(`${normalizedBase}/settings/sources`, { waitUntil: 'networkidle' });
    if (!page.url().startsWith(`${normalizedBase}/settings/sources`)) fail('settings_page_navigation_rejected');
    const scraperSwitch = checkboxByName(page, 'Скрапер');
    if (await scraperSwitch.count() === 0) fail('source_settings_ui_missing');

    // Ensure scraper enabled and all 7 source switches are enabled; save and verify persistence + API agreement.
    await openAndSaveSources(page, normalizedBase, async (p) => {
      const sw = checkboxByName(p, 'Скрапер');
      if (!(await sw.isChecked())) await sw.check();
      const browserMode = checkboxByName(p, 'Браузерный режим');
      if (!(await browserMode.isChecked())) await browserMode.check();
      for (const label of SOURCE_LABELS) {
        const cb = await needSourceCheckbox(p, label);
        if (await cb.count() === 0) fail('source_switch_ui_missing');
        if (!(await cb.isChecked())) await cb.check();
      }
    });
    state.counts.sourceTogglesTested = SOURCE_LABELS.length;

    await page.goto(`${normalizedBase}/settings/sources`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    for (const label of SOURCE_LABELS) {
      const cb = await needSourceCheckbox(page, label);
      if (!(await cb.isChecked())) fail('source_toggle_not_persisted');
    }
    const scraperAfterReload = checkboxByName(page, 'Скрапер');
    if (!(await scraperAfterReload.isChecked())) fail('source_toggle_not_persisted');

    step = 'availability';
    const availability = await fetchJson(page, '/api/v1/property-search/availability');
    if (!availability.ok || !isObj(availability.body)) fail('availability_fetch_failed');
    const scraper = availability.body.scraper;
    if (!isObj(scraper)) fail('availability_fetch_failed');
    if (availability.body.browser?.enabled !== true || availability.body.browser?.configured !== true) fail('packaged_browser_unavailable');
    if (scraper.enabled && scraper.reason === 'disabled_by_server') fail('enabled_reports_server_disabled');
    state.checks.enabledNotDisabledByServer = scraper.reason !== 'disabled_by_server';

    const sources = Array.isArray(availability.body.sources) ? availability.body.sources : [];
    if (sources.length < SOURCE_LABELS.length) fail('availability_sources_missing');
    const allSourceAgreement = sources.length === SOURCE_LABELS.length && sources.every((s) => s && s.enabled === true && s.reason === 'ready');
    if (!allSourceAgreement) fail('availability_source_agreement_failed');
    state.checks.availabilityAgrees = scraper.enabled === true;
    if (!state.checks.availabilityAgrees) fail('availability_switch_mismatch');
    state.checks.sourceTogglePersisted = true;
    state.coverage.push('source_toggle_persist', 'availability_agreement', 'enabled_not_server_disabled');

    // Disabling honored: disable every source switch and verify API reports disabled_by_settings.
    await openAndSaveSources(page, normalizedBase, async (p) => {
      for (const label of SOURCE_LABELS) {
        const cb = await needSourceCheckbox(p, label);
        if (await cb.isChecked()) await cb.uncheck();
      }
    });
    const disabledAvailability = await fetchJson(page, '/api/v1/property-search/availability');
    if (!disabledAvailability.ok || !isObj(disabledAvailability.body)) fail('availability_fetch_failed_after_disable');
    const disabledSources = Array.isArray(disabledAvailability.body.sources) ? disabledAvailability.body.sources : [];
    const disablingHonored = disabledSources.length >= SOURCE_LABELS.length && disabledSources.every((s) => s?.enabled === false && s?.reason === 'disabled_by_settings');
    if (!disablingHonored) fail('disabling_not_honored');
    state.checks.disablingHonored = true;
    state.coverage.push('disabling_honored');

    // Restore sources for a clean state.
    await openAndSaveSources(page, normalizedBase, async (p) => {
      for (const label of SOURCE_LABELS) {
        const cb = await needSourceCheckbox(p, label);
        if (!(await cb.isChecked())) await cb.check();
      }
    });

    // Deterministic sources screenshot after all 7 enabled + persisted, before AI page (no password inputs here).
    await page.goto(`${normalizedBase}/settings/sources`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    for (const label of SOURCE_LABELS) {
      const cb = await needSourceCheckbox(page, label);
      if (!(await cb.isChecked())) fail('source_toggle_not_persisted');
    }
    if (!(await checkboxByName(page, 'Скрапер').isChecked())) fail('source_toggle_not_persisted');
    await mustScreenshot(page, path.join(cycleDir, 'source-settings.png'), 'source_settings_screenshot_failed');

    step = 'credentials';
    // Opt in AI through /settings/ai UI without entering a key (fresh profile), then assert strict no-key state.
    await page.goto(`${normalizedBase}/settings/ai`, { waitUntil: 'networkidle' });
    if (!page.url().startsWith(`${normalizedBase}/settings/ai`)) fail('ai_settings_page_navigation_rejected');
    const aiEnable = checkboxByName(page, 'ИИ');
    if (await aiEnable.count() === 0) fail('ai_settings_ui_missing');
    if (!(await aiEnable.isChecked())) await aiEnable.check();
    const aiSave = page.getByRole('button', { name: 'Сохранить настройки' });
    if (await aiSave.count() === 0) fail('ai_settings_save_missing');
    await aiSave.click();
    await waitForSave(page, 'Настройки ИИ сохранены');

    const credMeta = await fetchJson(page, '/api/v1/settings/ai/credentials');
    if (!credMeta.ok || !isObj(credMeta.body)) fail('credentials_metadata_fetch_failed');
    const metaKeys = Object.keys(credMeta.body);
    const metadataOnly = metaKeys.length > 0 && metaKeys.every((k) => AI_CREDENTIAL_ALLOWED_KEYS.has(k));
    const leaked = metaKeys.some((k) => /api.?key|secret|token|password|encrypted|cipher|blob/i.test(k));
    if (!metadataOnly || leaked) fail('credential_metadata_contract_violated');
    state.checks.credentialMetadataOnly = true;
    state.coverage.push('credential_metadata_only');

    const aiAvailability = await fetchJson(page, '/api/v1/property-search/availability');
    if (!aiAvailability.ok || !isObj(aiAvailability.body?.ai)) fail('availability_fetch_failed');
    const ai = aiAvailability.body.ai;
    // Fresh DPAPI/no-key state after AI opt-in must be strict and distinct.
    state.checks.missingAiKeyDistinct = (
      ai.reason === 'credentials_missing' &&
      ai.configured === false &&
      ai.available === false &&
      ai.message === MISSING_AI_KEY_MESSAGE &&
      credMeta.body.configured === false
    );
    if (!state.checks.missingAiKeyDistinct) fail('missing_ai_key_not_distinct');
    state.coverage.push('missing_ai_key_distinct');

    // Synthetic DPAPI credential UI roundtrip via the actual backend (no provider call).
    // Fake key/folder strings are generated locally with process crypto only.
    // Fresh profile only: starts from the strict missing-key state asserted above.
    const keyInput = page.getByLabel('Ключ API Яндекс AI (запись без чтения)', { exact: true }).first();
    const folderInput = page.getByLabel('Каталог Яндекс Cloud (Folder ID)', { exact: true }).first();
    if (await keyInput.count() === 0 || await folderInput.count() === 0) fail('credential_ui_missing');
    if ((await keyInput.getAttribute('type')) !== 'password') fail('credential_key_not_password');
    if ((await folderInput.getAttribute('type')) !== 'text') fail('credential_folder_not_text');
    const synthFolder = `b1g-synth-${crypto.randomBytes(4).toString('hex')}`;
    const synthKey1 = `AQVN-synth-${crypto.randomBytes(16).toString('hex')}`;
    await keyInput.fill(synthKey1);
    await folderInput.fill(synthFolder);
    const saveCred1 = page.getByRole('button', { name: /Подключить Яндекс AI|Заменить подключение Яндекс AI/ }).first();
    if (await saveCred1.count() === 0) fail('credential_save_missing');
    await saveCred1.click();
    await waitForSave(page, 'Подключение Яндекс AI сохранено в защищённом хранилище.');
    const savedMeta = await fetchJson(page, '/api/v1/settings/ai/credentials');
    if (!savedMeta.ok || !isObj(savedMeta.body)) fail('credentials_metadata_fetch_failed_after_save');
    {
      const keys = Object.keys(savedMeta.body);
      const onlyMeta = keys.length > 0 && keys.every((k) => AI_CREDENTIAL_ALLOWED_KEYS.has(k));
      const leakedKey = keys.some((k) => /api.?key|secret|token|password|encrypted|cipher|blob|folder/i.test(k));
      if (!onlyMeta || leakedKey) fail('credential_metadata_contract_violated_after_save');
      if (savedMeta.body.configured !== true || savedMeta.body.source !== 'local' ||
        savedMeta.body.editable !== true || savedMeta.body.status !== 'configured') fail('credential_metadata_not_configured');
    }
    const readyAvail = await fetchJson(page, '/api/v1/property-search/availability');
    if (!readyAvail.ok || !isObj(readyAvail.body?.ai)) fail('availability_fetch_failed_after_save');
    if (readyAvail.body.ai.configured !== true || readyAvail.body.ai.available !== true) fail('credential_availability_not_ready');
    // Reload: password and folder inputs must be empty; no stored secret may appear in the DOM.
    await page.reload({ waitUntil: 'networkidle' });
    const keyAfterSave = page.getByLabel('Ключ API Яндекс AI (запись без чтения)', { exact: true }).first();
    const folderAfterSave = page.getByLabel('Каталог Яндекс Cloud (Folder ID)', { exact: true }).first();
    if (await keyAfterSave.count() === 0 || await folderAfterSave.count() === 0) fail('credential_ui_missing_after_reload');
    if ((await keyAfterSave.inputValue()) !== '') fail('credential_password_not_cleared');
    if ((await folderAfterSave.inputValue()) !== '') fail('credential_folder_not_cleared');
    {
      const dom = await page.content().catch(() => '');
      if (dom.includes(synthKey1) || dom.includes(synthFolder)) fail('credential_secret_exposed_in_dom');
    }
    // Replace with a different generated key; metadata must stay configured/local.
    const synthKey2 = `AQVN-synth-${crypto.randomBytes(16).toString('hex')}`;
    if (synthKey2 === synthKey1) fail('synthetic_key_collision');
    await keyAfterSave.fill(synthKey2);
    await folderAfterSave.fill(synthFolder);
    const saveCred2 = page.getByRole('button', { name: /Подключить Яндекс AI|Заменить подключение Яндекс AI/ }).first();
    if (await saveCred2.count() === 0) fail('credential_replace_missing');
    await saveCred2.click();
    await waitForSave(page, 'Подключение Яндекс AI сохранено в защищённом хранилище.');
    const replacedMeta = await fetchJson(page, '/api/v1/settings/ai/credentials');
    if (!replacedMeta.ok || !isObj(replacedMeta.body)) fail('credentials_metadata_fetch_failed_after_replace');
    if (replacedMeta.body.configured !== true || replacedMeta.body.source !== 'local' ||
      replacedMeta.body.editable !== true || replacedMeta.body.status !== 'configured') fail('credential_metadata_not_configured_after_replace');
    {
      const dom = await page.content().catch(() => '');
      if (dom.includes(synthKey2)) fail('credential_secret_exposed_in_dom');
    }
    // Remove via the actual UI; end state must return to the strict missing-key check.
    const removeBtn = page.getByRole('button', { name: 'Удалить локальные ключи' }).first();
    if (await removeBtn.count() === 0) fail('credential_remove_ui_missing');
    await removeBtn.click();
    await waitForSave(page, 'Локальные учётные данные Яндекс AI удалены.');
    const removedMeta = await fetchJson(page, '/api/v1/settings/ai/credentials');
    if (!removedMeta.ok || !isObj(removedMeta.body)) fail('credentials_metadata_fetch_failed_after_remove');
    if (removedMeta.body.configured !== false || removedMeta.body.status !== 'missing') fail('credential_metadata_not_removed');
    const removedAvail = await fetchJson(page, '/api/v1/property-search/availability');
    if (!removedAvail.ok || !isObj(removedAvail.body?.ai)) fail('availability_fetch_failed_after_remove');
    {
      const ra = removedAvail.body.ai;
      if (!(ra.reason === 'credentials_missing' && ra.configured === false && ra.available === false &&
        ra.message === MISSING_AI_KEY_MESSAGE && removedMeta.body.configured === false)) fail('credential_roundtrip_cleanup_not_missing');
    }
    state.checks.credentialUiDpapiRoundtrip = true;
    state.coverage.push('credential_ui_dpapi_save_replace_remove');

    step = 'collapse';
    await page.goto(`${normalizedBase}/property-search`, { waitUntil: 'networkidle' });
    if (!page.url().startsWith(`${normalizedBase}/property-search`)) fail('search_page_navigation_rejected');
    // Deterministic primary screenshot: compact filters (advanced collapsed by default),
    // actually check residential purpose and assert state; no query/provider call.
    {
      const primaryCollapse = page.locator('button[aria-expanded]').filter({ hasText: /Расширенные фильтры/i }).first();
      if (await primaryCollapse.count() === 0) fail('advanced_collapse_ui_missing');
      if ((await primaryCollapse.getAttribute('aria-expanded')) !== 'false') await primaryCollapse.click();
      if ((await primaryCollapse.getAttribute('aria-expanded')) !== 'false') fail('advanced_collapse_not_compact');
      const primaryResidential = page.getByLabel('Жилая', { exact: true }).first();
      if (await primaryResidential.count() === 0) fail('residential_purpose_ui_missing');
      if ((await primaryResidential.getAttribute('type')) !== 'checkbox') fail('residential_purpose_not_checkbox');
      if (!(await primaryResidential.isChecked())) await primaryResidential.check();
      if (!(await primaryResidential.isChecked())) fail('residential_purpose_check_failed');
      await mustScreenshot(page, path.join(cycleDir, 'search-primary.png'), 'search_primary_screenshot_failed');
    }
    const collapseBtn = page.locator('button[aria-expanded]').filter({ hasText: /Расширенные фильтры/i }).first();
    if (await collapseBtn.count() === 0) fail('advanced_collapse_ui_missing');
    if ((await collapseBtn.getAttribute('aria-expanded')) !== 'true') await collapseBtn.click();
    await page.locator('#search-advanced-filters-panel:not([hidden])').waitFor({ state: 'visible', timeout: 10000 }).catch(() => fail('advanced_panel_not_openable'));
    const floorSelect = page.locator('#search-floor-mode');
    if (await floorSelect.count() === 0) fail('advanced_floor_filter_missing');
    await floorSelect.selectOption('first_floor_only');
    const openBtn = page.locator('button[aria-expanded="true"]').filter({ hasText: /Расширенные фильтры/i }).first();
    await openBtn.click();
    const collapsedBtn = page.locator('button[aria-expanded="false"]').filter({ hasText: /Расширенные фильтры/i }).first();
    await collapsedBtn.waitFor({ state: 'visible', timeout: 10000 });
    const collapsedText = await collapsedBtn.innerText();
    if (!/\(1\)/.test(collapsedText)) fail('advanced_filter_count_not_retained');
    await collapsedBtn.click();
    await page.locator('#search-advanced-filters-panel:not([hidden])').waitFor({ state: 'visible', timeout: 10000 }).catch(() => fail('advanced_panel_not_reopenable'));
    const floorVal = await page.locator('#search-floor-mode').inputValue();
    if (floorVal !== 'first_floor_only') fail('advanced_filter_not_retained');
    await mustScreenshot(page, path.join(cycleDir, 'search-advanced.png'), 'search_advanced_screenshot_failed');
    state.checks.collapseRetainsFilters = true;
    state.checks.activeCountRetained = true;
    state.counts.advancedFiltersRetained = 1;
    state.counts.activeFilterCount = 1;
    state.coverage.push('collapse_retains_filters', 'active_count_retained');

    // Whole-filter collapse must preserve the already-selected advanced value/state.
    {
      const primaryToggle = page.locator('button[aria-controls="search-primary-filters-panel"]');
      const primaryPanel = page.locator('#search-primary-filters-panel');
      if (await primaryToggle.count() !== 1 || await primaryPanel.count() !== 1) fail('search_primary_ui_missing');
      if ((await primaryToggle.getAttribute('aria-controls')) !== 'search-primary-filters-panel' ||
        (await primaryToggle.getAttribute('aria-expanded')) !== 'true' ||
        (await primaryPanel.getAttribute('hidden')) !== null || !(await primaryPanel.isVisible())) fail('search_primary_initial_contract_failed');
      const cityInput = page.getByRole('textbox', { name: 'Город', exact: true });
      const primaryResidential = page.getByRole('checkbox', { name: 'Жилая', exact: true });
      if (await cityInput.count() !== 1 || await primaryResidential.count() !== 1) fail('search_primary_filters_missing');
      if ((await primaryResidential.getAttribute('type')) !== 'checkbox') fail('residential_purpose_not_checkbox');
      const cityValue = 'Москва';
      await cityInput.fill(cityValue);
      if (!(await primaryResidential.isChecked())) await primaryResidential.check();
      const advancedPanel = page.locator('#search-advanced-filters-panel');
      if ((await collapseBtn.getAttribute('aria-expanded')) !== 'true' ||
        (await advancedPanel.getAttribute('hidden')) !== null || !(await advancedPanel.isVisible())) fail('advanced_state_before_primary_collapse_failed');
      await page.evaluate(() => window.scrollTo(0, 0));
      const searchCta = page.getByRole('button', { name: 'Искать', exact: true });
      if (await searchCta.count() !== 1) fail('search_primary_cta_not_single');
      const ctaBox = await searchCta.boundingBox();
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      if (!ctaBox || ctaBox.height <= 0 || ctaBox.width <= 0 || ctaBox.y < 0 ||
        ctaBox.y + ctaBox.height > viewportHeight) fail('search_primary_cta_not_above_fold');
      state.checks.primaryCtaInViewport = true;
      state.coverage.push('primary_cta_in_viewport');

      await primaryToggle.click();
      await primaryPanel.waitFor({ state: 'hidden', timeout: 10000 });
      if ((await primaryToggle.getAttribute('aria-controls')) !== 'search-primary-filters-panel' ||
        (await primaryToggle.getAttribute('aria-expanded')) !== 'false' ||
        (await primaryPanel.getAttribute('hidden')) === null || await primaryPanel.isVisible()) fail('search_primary_collapse_contract_failed');
      if ((await collapseBtn.getAttribute('aria-expanded')) !== 'true' ||
        (await advancedPanel.getAttribute('hidden')) !== null ||
        (await floorSelect.inputValue()) !== 'first_floor_only') fail('advanced_state_changed_by_primary_collapse');
      await page.evaluate(() => window.scrollTo(0, 0));
      await mustScreenshot(page, path.join(cycleDir, 'search-primary-collapse.png'), 'search_primary_collapse_screenshot_failed');
      await primaryToggle.click();
      await primaryPanel.waitFor({ state: 'visible', timeout: 10000 });
      if ((await primaryToggle.getAttribute('aria-controls')) !== 'search-primary-filters-panel' ||
        (await primaryToggle.getAttribute('aria-expanded')) !== 'true' ||
        (await primaryPanel.getAttribute('hidden')) !== null) fail('search_primary_reopen_contract_failed');
      state.checks.primaryCollapseContract = true;
      state.coverage.push('primary_collapse_contract');
      if ((await cityInput.inputValue()) !== cityValue || !(await primaryResidential.isChecked()) ||
        (await floorSelect.inputValue()) !== 'first_floor_only' ||
        (await collapseBtn.getAttribute('aria-expanded')) !== 'true' ||
        (await advancedPanel.getAttribute('hidden')) !== null || !(await advancedPanel.isVisible())) fail('whole_filter_retention_independence_failed');
      state.checks.wholeFilterRetentionIndependence = true;
      state.coverage.push('whole_filter_retention_independence');
    }

    step = 'tooltips';
    const tooltipBtn = page.getByRole('button', { name: /^Справка:/i }).first();
    if (await tooltipBtn.count() === 0) fail('accessible_tooltip_ui_missing');
    await tooltipBtn.focus();
    await tooltipBtn.press('Enter');
    const expandedAfter = await tooltipBtn.getAttribute('aria-expanded');
    if (expandedAfter !== 'true') fail('tooltip_keyboard_open_failed');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const expandedAfterEsc = await tooltipBtn.getAttribute('aria-expanded');
    if (expandedAfterEsc === 'true') fail('tooltip_keyboard_dismiss_failed');
    // Touch/click toggle contract.
    await tooltipBtn.click();
    if ((await tooltipBtn.getAttribute('aria-expanded')) !== 'true') fail('tooltip_touch_open_failed');
    await page.keyboard.press('Escape');
    state.checks.tooltipFocusKeyboardDismiss = true;
    state.counts.tooltipChecks = 2;
    state.coverage.push('tooltip_focus_keyboard');

    try {
      const screenshotPath = path.join(cycleDir, 'search-cycle.png');
      const passwordCount = await page.locator('input[type="password"]').count();
      if (passwordCount !== 0) fail('search_cycle_screenshot_failed');
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const buf = fs.readFileSync(screenshotPath);
      if (buf.byteLength === 0) fail('search_cycle_screenshot_failed');
      state.artifacts.screenshotBytes = buf.byteLength;
      state.artifacts.screenshotSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    } catch (e) {
      if (e && typeof e.code === 'string' && CODE_RE.test(e.code)) throw e;
      fail('search_cycle_screenshot_failed');
    }

    state.status = 'PASS';
  } catch (err) {
    state.status = 'FAIL';
    state.errorCode = stepCode(err, step, 'search_cycle_failed');
  }
  return sanitizeResult(state);
}

export async function selfTest() {
  const vb = validateBase('http://127.0.0.1:3000/');
  if (vb !== 'http://127.0.0.1:3000') fail('selftest_base_normalization_failed');
  for (const b of ['https://127.0.0.1:3000', 'http://localhost:3000', 'http://127.0.0.1:3000/x', 'http://192.168.1.1:3000']) {
    let rejected = false;
    try { validateBase(b); } catch { rejected = true; }
    if (!rejected) fail('selftest_bad_base_accepted');
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const rid = '11111111-2222-4333-8444-555555555555';
  const vd = path.join(root, 'data', 'qa-v32-installed-browser', `run-${rid}`, 'search-cycle');
  const v = validateDirectory(vd, root);
  if (v.target !== vd) fail('selftest_directory_validation_failed');
  for (const d of [
    path.join(root, 'data', 'other', `run-${rid}`, 'search-cycle'),
    path.join(root, 'data', 'qa-v32-installed-browser', 'run-not-a-uuid', 'search-cycle'),
    path.join(root, '..', 'outside-search-cycle'),
  ]) {
    let rejected = false;
    try { validateDirectory(d, root); } catch { rejected = true; }
    if (!rejected) fail('selftest_bad_directory_accepted');
  }
  const red = sanitizeResult({
    status: 'FAIL',
    errorCode: 'actor_not_manager',
    secretLeak: 'MUST_NOT_APPEAR',
    checks: { actorAuthorizedManager: false },
    counts: { sourceTogglesTested: 2, negativeCount: -5 },
    artifacts: { screenshotBytes: 10, leak: 'C:\\secret.png' },
    coverage: ['residential_purpose', 'unlisted_label'],
  });
  if ('secretLeak' in red || 'leak' in red.artifacts || red.counts.negativeCount !== undefined || red.coverage.includes('unlisted_label')) {
    fail('selftest_redaction_contract_broken');
  }
  if (!('credentialUiDpapiRoundtrip' in red.checks)) fail('selftest_roundtrip_check_missing');
  if (red.checks.credentialUiDpapiRoundtrip !== false) fail('selftest_roundtrip_coercion_broken');
  const redRoundtrip = sanitizeResult({
    status: 'PASS',
    checks: {
      actorAuthorizedManager: true,
      searchPageLoaded: true,
      sourceTogglePersisted: true,
      availabilityAgrees: true,
      enabledNotDisabledByServer: true,
      disablingHonored: true,
      missingAiKeyDistinct: true,
      collapseRetainsFilters: true,
      activeCountRetained: true,
      tooltipFocusKeyboardDismiss: true,
      residentialPurposeAvailable: true,
      credentialMetadataOnly: true,
      credentialUiDpapiRoundtrip: true,
      primaryCtaInViewport: true,
      primaryCollapseContract: true,
      wholeFilterRetentionIndependence: true,
    },
    counts: { sourceTogglesTested: 7, advancedFiltersRetained: 1, activeFilterCount: 1, tooltipChecks: 2 },
    artifacts: { screenshotBytes: 10, screenshotSha256: '0'.repeat(64) },
    coverage: ['credential_ui_dpapi_save_replace_remove', 'primary_cta_in_viewport', 'primary_collapse_contract', 'whole_filter_retention_independence', 'unlisted_label'],
  });
  if (!redRoundtrip.coverage.includes('credential_ui_dpapi_save_replace_remove') || redRoundtrip.coverage.includes('unlisted_label')) {
    fail('selftest_roundtrip_coverage_broken');
  }
  if (redRoundtrip.status !== 'PASS' || redRoundtrip.checks.credentialUiDpapiRoundtrip !== true) fail('selftest_roundtrip_positive_broken');
  for (const [flag, coverage] of [
    ['primaryCtaInViewport', 'primary_cta_in_viewport'],
    ['primaryCollapseContract', 'primary_collapse_contract'],
    ['wholeFilterRetentionIndependence', 'whole_filter_retention_independence'],
  ]) {
    if (red.checks[flag] !== false || !redRoundtrip.coverage.includes(coverage)) fail('selftest_primary_check_contract_broken');
    const checks = { ...redRoundtrip.checks };
    delete checks[flag];
    if (sanitizeResult({ ...redRoundtrip, checks }).status !== 'FAIL') fail('selftest_primary_check_required_broken');
  }
  const redMissing = sanitizeResult({
    status: 'PASS',
    checks: {
      actorAuthorizedManager: true,
      searchPageLoaded: true,
      sourceTogglePersisted: true,
      availabilityAgrees: true,
      enabledNotDisabledByServer: true,
      disablingHonored: true,
      missingAiKeyDistinct: true,
      collapseRetainsFilters: true,
      activeCountRetained: true,
      tooltipFocusKeyboardDismiss: true,
      residentialPurposeAvailable: true,
      credentialMetadataOnly: true,
      credentialUiDpapiRoundtrip: false,
      primaryCtaInViewport: true,
      primaryCollapseContract: true,
      wholeFilterRetentionIndependence: true,
    },
    coverage: ['credential_ui_dpapi_save_replace_remove'],
  });
  if (redMissing.status !== 'FAIL') fail('selftest_roundtrip_required_broken');
  const rp = await runInstalledSearchCycle();
  if (rp.status !== 'FAIL' || rp.errorCode !== 'invalid_page_handle') fail('selftest_error_path_broken');
  return { ok: true, schema: RESULT_SCHEMA };
}

const isDirect = typeof process !== 'undefined' && Array.isArray(process.argv) && typeof process.argv[1] === 'string'
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirect && process.argv.includes('--self-test')) {
  selfTest()
    .then((r) => process.stdout.write(`${JSON.stringify(r)}\n`))
    .catch((e) => {
      process.stderr.write(`${JSON.stringify({ ok: false, errorCode: e?.code || 'selftest_failed' })}\n`);
      process.exitCode = 1;
    });
}
