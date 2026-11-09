const RESULT_SCHEMA = "installed-search-ai-live/v1";
const CODE_RE = /^[a-z0-9_.:]{1,80}$/i;
const SYNTHETIC_TEXT = "Купить квартиру в Новосибирске до 7000000 рублей, от 40 м2";
const CURRENT_FILTERS = {
  city: "Новосибирск", operation: "sale", priceUnit: "rub_total", purposes: ["residential"],
  floorMode: "any", districts: [], requiredFeatures: [], preferredFeatures: [],
  sources: ["cian", "mirkvartir", "onrealt", "domclick", "yandex", "youla", "avito"], seller: "all",
};
const TERMINAL = new Set(["settled", "released", "success", "completed", "error", "failed"]);
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function notPassBreak(code) { const e = new Error(code); e.code = code; e.notpass = true; throw e; }
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export function validateBase(base) {
  if (typeof base !== "string" || !base) fail("invalid_base_loopback_contract");
  let u; try { u = new URL(base); } catch { fail("invalid_base_loopback_contract"); }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port || u.pathname !== "/" || u.search || u.hash || u.username || u.password) fail("invalid_base_loopback_contract");
  const p = Number(u.port); if (!Number.isInteger(p) || p < 1 || p > 65535) fail("invalid_base_loopback_contract");
  return `http://127.0.0.1:${p}`;
}
async function sameFetch(page, method, path, body) {
  return page.evaluate(async ({ m, p, b }) => {
    const init = { method: m, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (b !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(b); }
    const r = await fetch(p, init); let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, ok: r.ok, body: j };
  }, { m: method, p: path, b: body });
}
async function samePostTimeout(page, path, body, ms) {
  return page.evaluate(async ({ p, b, t }) => {
    const c = new AbortController(); const h = setTimeout(() => c.abort(), t);
    try {
      const r = await fetch(p, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(b), signal: c.signal });
      let j = null; try { j = await r.json(); } catch {}
      return { status: r.status, ok: r.ok, body: j };
    } finally { clearTimeout(h); }
  }, { p: path, b: body, t: ms });
}
function numRub(v) { const n = Number(String(v ?? "").trim()); return Number.isFinite(n) ? n : NaN; }
function parseValid(r) {
  if (!isObj(r) || !isObj(r.filters) || r.clarificationQuestion != null) return false;
  const f = r.filters;
  if (f.operation !== "sale") return false;
  if (!Array.isArray(f.purposes) || !f.purposes.includes("residential")) return false;
  if (typeof f.city !== "string" || !/новосибирск/iu.test(f.city)) return false;
  const to = f.priceTo !== undefined ? numRub(f.priceTo) : NaN;
  if (!Number.isFinite(to) || to <= 0 || to > 7000000) return false;
  const af = typeof f.areaFrom === "number" ? f.areaFrom : NaN;
  if (!Number.isFinite(af) || af < 40) return false;
  if (r.testingMode === true || r.mode === "test") return false;
  return true;
}
function closedResult(s) {
  const c = isObj(s.checks) ? s.checks : {}, n = isObj(s.counts) ? s.counts : {}, b = isObj(s.rub) ? s.rub : {};
  const checks = { actorManager: !!c.actorManager, initiallyMissing: !!c.initiallyMissing, settingsTightened: !!c.settingsTightened, credentialReady: !!c.credentialReady, limitsChecked: !!c.limitsChecked, parseCalledOnce: !!c.parseCalledOnce, parseValid: !!c.parseValid, usageChargedOnce: !!c.usageChargedOnce, credentialRemoved: !!c.credentialRemoved, noSecretLeak: !!c.noSecretLeak };
  const int = (v) => Number.isInteger(v) && v >= 0 ? v : 0;
  const counts = { parseCalls: int(n.parseCalls), usageDelta: int(n.usageDelta) };
  const rub = (v) => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  const pass = s.status === "PASS" && Object.values(checks).every(Boolean);
  const status = pass ? "PASS" : s.status === "NOTPASS" ? "NOTPASS" : "FAIL";
  const errorCode = status === "PASS" ? null : (typeof s.errorCode === "string" && CODE_RE.test(s.errorCode) ? s.errorCode : "live_ai_failed");
  const out = { schema: RESULT_SCHEMA, status, errorCode, checks: Object.freeze(checks), counts: Object.freeze(counts), rub: Object.freeze({ chargedRub: rub(b.chargedRub), reservedRub: rub(b.reservedRub), budgetCapRub: 1 }) };
  return Object.freeze(out);
}
export async function runInstalledSearchAiLive({ page, base, loadCredentials } = {}) {
  const st = { status: "FAIL", errorCode: "live_ai_failed", checks: {}, counts: { parseCalls: 0, usageDelta: 0 }, rub: { chargedRub: null, reservedRub: null, budgetCapRub: 1 } };
  let cred = null, dom = "";
  let freshPreflight = false, helperOwnsCredential = false;
  const markNotPass = (code) => { st.status = "NOTPASS"; st.errorCode = code; throw notPassBreak(code); };
  try {
    if (!page || typeof page.evaluate !== "function" || typeof page.goto !== "function" || typeof page.url !== "function" || typeof page.content !== "function") fail("invalid_page_handle");
    if (typeof loadCredentials !== "function") markNotPass("notpass_no_credentials");
    const root = validateBase(base);
    const cur = page.url(); if (cur && cur !== "about:blank" && !cur.startsWith(root)) fail("page_origin_mismatch");
    const me = await sameFetch(page, "GET", "/api/v1/auth/me");
    if (!me.ok || !isObj(me.body) || me.body.role !== "manager") markNotPass("actor_not_manager");
    st.checks.actorManager = true;
    const meta0 = await sameFetch(page, "GET", "/api/v1/settings/ai/credentials");
    if (!meta0.ok || !isObj(meta0.body)) fail("credential_metadata_fetch_failed");
    if (meta0.body.configured !== false || meta0.body.status !== "missing" || meta0.body.editable !== true) markNotPass("credential_not_fresh");
    st.checks.initiallyMissing = true;
    const cur0 = page.url(); if (cur0 && cur0 !== "about:blank" && !cur0.startsWith(root)) fail("page_origin_mismatch");
    const gs = await sameFetch(page, "GET", "/api/v1/settings/ai");
    if (!gs.ok || !isObj(gs.body) || !isObj(gs.body.setting) || typeof gs.body.setting.updatedAt !== "string") fail("settings_fetch_failed");
    const s0 = gs.body.setting;
    const put = { expectedUpdatedAt: s0.updatedAt, aiEnabled: s0.aiEnabled, scraperEnabled: s0.scraperEnabled, browserEnabled: s0.browserEnabled, enabledSources: s0.enabledSources, webSearchManualAllowed: false, webSearchAutoFallback: false, model: s0.model, webModel: s0.webModel ?? null, searchContextSize: s0.searchContextSize, perUserDailyLimit: 1, perJobLimit: 1, dailyLimit: 1, monthlyBudgetRub: "1" };
    const ps = await sameFetch(page, "PUT", "/api/v1/settings/ai", put);
    if (!ps.ok || !isObj(ps.body) || !isObj(ps.body.setting)) fail("settings_tighten_failed");
    if (numRub(ps.body.setting.monthlyBudgetRub) > 1 || ps.body.setting.perUserDailyLimit !== 1 || ps.body.setting.perJobLimit !== 1 || ps.body.setting.dailyLimit !== 1 || ps.body.setting.webSearchManualAllowed !== false || ps.body.setting.webSearchAutoFallback !== false) fail("settings_ceiling_risk");
    st.checks.settingsTightened = true;
    const lb = await sameFetch(page, "GET", "/api/v1/ai/limits");
    const ub = await sameFetch(page, "GET", "/api/v1/ai/usage?page=1");
    if (!lb.ok || !isObj(lb.body) || !isObj(lb.body.remaining) || !ub.ok || !isObj(ub.body) || !Array.isArray(ub.body.items)) fail("limits_fetch_failed");
    if (lb.body.budgetAvailable === false) markNotPass("budget_exhausted");
    const monthlyBudget = numRub(ps.body.effective?.values?.monthlyBudgetRub);
    if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0 || monthlyBudget > 1) markNotPass("budget_exhausted");
    const preReserved = numRub(ub.body.reservedRub ?? "0");
    if (Number.isFinite(preReserved) && preReserved !== 0) markNotPass("budget_exhausted");
    st.checks.limitsChecked = true;
    freshPreflight = true;
    const beforeIds = new Set(ub.body.items.map((i) => i && i.id).filter((x) => typeof x === "string"));
    cred = await loadCredentials();
    if (!isObj(cred) || typeof cred.apiKey !== "string" || typeof cred.folder !== "string" || !cred.apiKey || !cred.folder) { cred = null; markNotPass("notpass_no_credentials"); }
    helperOwnsCredential = true;
    let pr;
    try {
      pr = await sameFetch(page, "PUT", "/api/v1/settings/ai/credentials", { apiKey: cred.apiKey, folder: cred.folder });
    } catch {
      helperOwnsCredential = true;
      fail("credential_put_failed");
    }
    if (!pr.ok || !isObj(pr.body) || pr.body.configured !== true || pr.body.source !== "local" || pr.body.status !== "configured") fail("credential_put_failed");
    helperOwnsCredential = true;
    st.checks.credentialReady = true;
    const av = await sameFetch(page, "GET", "/api/v1/property-search/availability");
    if (!av.ok || !isObj(av.body) || !isObj(av.body.ai) || av.body.ai.available !== true) markNotPass("provider_disabled");
    st.counts.parseCalls = 1;
    const pr2 = await samePostTimeout(page, "/api/v1/property-search/parse", { text: SYNTHETIC_TEXT, currentFilters: CURRENT_FILTERS }, 45000);
    st.checks.parseCalledOnce = true;
    if (!pr2.ok || !isObj(pr2.body)) markNotPass("parse_failed");
    if (!parseValid(pr2.body)) markNotPass("parse_invalid_result");
    st.checks.parseValid = true;
    const ua = await sameFetch(page, "GET", "/api/v1/ai/usage?page=1");
    if (!ua.ok || !isObj(ua.body) || !Array.isArray(ua.body.items)) fail("usage_fetch_failed");
    const fresh = ua.body.items.filter((i) => isObj(i) && typeof i.id === "string" && !beforeIds.has(i.id));
    st.counts.usageDelta = fresh.length;
    if (fresh.length !== 1 || !TERMINAL.has(String(fresh[0].status))) markNotPass("parse_not_charged");
    const ch = numRub(fresh[0].chargedCostRub), rs = numRub(ua.body.reservedRub ?? "0");
    st.rub.chargedRub = Number.isFinite(ch) ? ch : null; st.rub.reservedRub = Number.isFinite(rs) ? rs : null;
    if (!Number.isFinite(ch) || ch > 1 || (Number.isFinite(rs) && rs !== 0)) markNotPass("parse_not_charged");
    st.checks.usageChargedOnce = true;
    try { dom = await page.content(); } catch { dom = ""; }
    if (cred && (dom.includes(cred.apiKey) || dom.includes(cred.folder))) fail("credential_secret_leaked");
    st.checks.noSecretLeak = true;
    st.status = "PASS"; st.errorCode = null;
  } catch (e) {
    if (e && e.notpass === true) {
      if (st.status !== "NOTPASS") { st.status = "NOTPASS"; st.errorCode = typeof e.code === "string" && CODE_RE.test(e.code) ? e.code : "live_ai_failed"; }
    } else {
      const c = typeof e?.code === "string" && CODE_RE.test(e.code) ? e.code : "live_ai_failed";
      if (st.status !== "NOTPASS") { st.status = "FAIL"; st.errorCode = c; }
    }
  } finally {
    try {
      if (freshPreflight && helperOwnsCredential) {
        const removed = await sameFetch(page, "DELETE", "/api/v1/settings/ai/credentials");
        if (!removed.ok) fail("credential_cleanup_failed");
        const v = await sameFetch(page, "GET", "/api/v1/settings/ai/credentials");
        if (v.ok && isObj(v.body) && v.body.configured === false && v.body.status === "missing") st.checks.credentialRemoved = true;
      }
      try { dom = await page.content(); } catch { dom = ""; }
      if (cred && (dom.includes(cred.apiKey) || dom.includes(cred.folder))) { st.checks.noSecretLeak = false; st.status = "FAIL"; st.errorCode = "credential_secret_leaked"; }
      else if (cred) st.checks.noSecretLeak = true;
      else if (!st.checks.credentialRemoved && freshPreflight && helperOwnsCredential && st.status === "PASS") { st.status = "FAIL"; st.errorCode = "credential_cleanup_failed"; }
      else if (!st.checks.credentialRemoved && freshPreflight && helperOwnsCredential && st.status !== "NOTPASS" && st.status !== "FAIL") { st.status = "FAIL"; st.errorCode = "credential_cleanup_failed"; }
    } catch {
      st.status = "FAIL"; st.errorCode = "credential_cleanup_failed";
    }
    cred = null; dom = "";
    try { loadCredentials = null; } catch {}
  }
  return closedResult(st);
}
