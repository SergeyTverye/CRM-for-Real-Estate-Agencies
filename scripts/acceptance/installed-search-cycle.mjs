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
  'collapse_retains_filters',
  'active_count_retained',
  'tooltip_focus_keyboard',
  'residential_purpose',
  'credential_metadata_only',
]);

// Actual UI labels from public source contracts (codebook/externalSource + ai-settings-form).
const SOURCE_LABELS = ['Циан', 'Мир Квартир', 'OnRealt', 'Домклик', 'Яндекс Недвижимость', 'Юла', 'Авито'];
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
    await page.getByText(successText).waitFor({ state: 'visible', timeout });
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
    tooltipFocusKeyboardDismiss: Boolean(ci.tooltipFocusKeyboardDismiss),
    residentialPurposeAvailable: Boolean(ci.residentialPurposeAvailable),
    credentialMetadataOnly: Boolean(ci.credentialMetadataOnly),
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
    const scraperSwitch = page.getByLabel('Скрапер', { exact: false }).first();
    if (await scraperSwitch.count() === 0) fail('source_settings_ui_missing');

    // Ensure scraper enabled and all 7 source switches are enabled; save and verify persistence + API agreement.
    await openAndSaveSources(page, normalizedBase, async (p) => {
      const sw = p.getByLabel('Скрапер', { exact: false }).first();
      if (!(await sw.isChecked())) await sw.check();
      for (const label of SOURCE_LABELS) {
        const cb = p.getByLabel(label, { exact: true }).first();
        if (await cb.count() === 0) fail('source_switch_ui_missing');
        if (!(await cb.isChecked())) await cb.check();
      }
    });
    state.counts.sourceTogglesTested = SOURCE_LABELS.length;

    await page.goto(`${normalizedBase}/settings/sources`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    for (const label of SOURCE_LABELS) {
      const cb = page.getByLabel(label, { exact: true }).first();
      if (!(await cb.isChecked())) fail('source_toggle_not_persisted');
    }
    const scraperAfterReload = page.getByLabel('Скрапер', { exact: false }).first();
    if (!(await scraperAfterReload.isChecked())) fail('source_toggle_not_persisted');

    step = 'availability';
    const availability = await fetchJson(page, '/api/v1/property-search/availability');
    if (!availability.ok || !isObj(availability.body)) fail('availability_fetch_failed');
    const scraper = availability.body.scraper;
    if (!isObj(scraper)) fail('availability_fetch_failed');
    if (scraper.enabled && scraper.reason === 'disabled_by_server') fail('enabled_reports_server_disabled');
    state.checks.enabledNotDisabledByServer = scraper.reason !== 'disabled_by_server';

    const sources = Array.isArray(availability.body.sources) ? availability.body.sources : [];
    if (sources.length < SOURCE_LABELS.length) fail('availability_sources_missing');
    const allSourceAgreement = sources.every((s) => s && typeof s.source === 'string' && (s.enabled === true ? s.reason !== 'disabled_by_settings' : true));
    if (!allSourceAgreement) fail('availability_source_agreement_failed');
    state.checks.availabilityAgrees = scraper.enabled === true;
    if (!state.checks.availabilityAgrees) fail('availability_switch_mismatch');
    state.checks.sourceTogglePersisted = true;
    state.coverage.push('source_toggle_persist', 'availability_agreement', 'enabled_not_server_disabled');

    // Disabling honored: disable every source switch and verify API reports disabled_by_settings.
    await openAndSaveSources(page, normalizedBase, async (p) => {
      for (const label of SOURCE_LABELS) {
        const cb = p.getByLabel(label, { exact: true }).first();
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
        const cb = p.getByLabel(label, { exact: true }).first();
        if (!(await cb.isChecked())) await cb.check();
      }
    });

    step = 'credentials';
    // Opt in AI through /settings/ai UI without entering a key (fresh profile), then assert strict no-key state.
    await page.goto(`${normalizedBase}/settings/ai`, { waitUntil: 'networkidle' });
    if (!page.url().startsWith(`${normalizedBase}/settings/ai`)) fail('ai_settings_page_navigation_rejected');
    const aiEnable = page.getByLabel('ИИ', { exact: false }).first();
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

    step = 'collapse';
    await page.goto(`${normalizedBase}/property-search`, { waitUntil: 'networkidle' });
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
    state.checks.collapseRetainsFilters = true;
    state.checks.activeCountRetained = true;
    state.counts.advancedFiltersRetained = 1;
    state.counts.activeFilterCount = 1;
    state.coverage.push('collapse_retains_filters', 'active_count_retained');

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
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const buf = fs.readFileSync(screenshotPath);
      state.artifacts.screenshotBytes = buf.byteLength;
      state.artifacts.screenshotSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    } catch {}

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
