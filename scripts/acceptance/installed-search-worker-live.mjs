import crypto from "node:crypto";
const R = "installed-search-worker-live/v1";
const CODE = /^[a-z0-9_.:-]{1,80}$/i;
const TERM = new Set(["completed", "success", "partial", "needs_user_action", "cancelled", "error", "failed"]);

function fail(code) { const e = new Error(code); e.code = code; throw e; }
const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export function validateBase(b) {
  if (typeof b !== "string" || !b) fail("invalid_base");
  let u;
  try { u = new URL(b); } catch { fail("invalid_base"); }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port || u.pathname !== "/" || u.search || u.hash || u.username || u.password) fail("invalid_base");
  const p = Number(u.port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) fail("invalid_base");
  return `http://127.0.0.1:${p}`;
}

async function req(page, m, p, b) {
  return page.evaluate(async ({ m, p, b }) => {
    const i = { method: m, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (b !== undefined) { i.headers["content-type"] = "application/json"; i.body = JSON.stringify(b); }
    const r = await fetch(p, i);
    let j = null;
    try { j = await r.json(); } catch {}
    return { status: r.status, ok: r.ok, body: j };
  }, { m, p, b });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(page, id) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < 60000) {
    const r = await req(page, "GET", `/api/v1/property-search/runs/${id}/progress`);
    if (!r.ok || !obj(r.body)) fail("progress_fetch_failed");
    last = r.body;
    if (TERM.has(String(r.body.status))) return r.body;
    await sleep(1000);
  }
  await req(page, "POST", `/api/v1/property-search/runs/${id}/cancel`);
  const r = await req(page, "GET", `/api/v1/property-search/runs/${id}/progress`);
  return r.ok && obj(r.body) ? r.body : last;
}

async function job(page, purpose, st) {
  const body = {
    filters: { city: "Новосибирск", operation: "sale", priceUnit: "rub_total", purposes: [purpose], sources: ["onrealt"] },
    sources: ["onrealt"],
    idempotencyKey: crypto.randomUUID(),
    depth: { maxPages: 1, limit: 12 },
    deadlineMs: 30000,
    confirmedPaid: false,
  };
  const r = await req(page, "POST", "/api/v1/property-search/runs", body);
  if (!r.ok || !obj(r.body) || typeof r.body.id !== "string") fail("run_enqueue_failed");
  st.counts.postRuns++;
  const p = await poll(page, r.body.id);
  const rr = await req(page, "GET", `/api/v1/property-search/runs/${r.body.id}/results?page=1&pageSize=1`);
  if (!rr.ok || !obj(rr.body) || !Array.isArray(rr.body.rows)) fail("results_fetch_failed");
  const src = Array.isArray(p.sources) ? p.sources.find((x) => x && x.source === "onrealt") : null;
  const total = Number(rr.body.total);
  if (Number.isFinite(total) && total > 0) st.counts.persistedListings += total;
  const ok = TERM.has(String(p.status)) && !!src && src.status !== "disabled" &&
    !["blocked", "needs_user_action", "timeout", "error", "cancelled"].includes(src.status) &&
    (Number(src.resultCount) || 0) > 0 && total > 0;
  return { status: String(p.status), sourceStatus: src ? String(src.status) : null, resultCount: Number(src?.resultCount) || 0, total: total > 0 ? total : 0, ok };
}

function closed(s) {
  const c = s.checks || {}, n = s.counts || {}, st = s.statuses || {};
  const ch = {
    actorManager: !!c.actorManager,
    availabilityReady: !!c.availabilityReady,
    usageBeforeZero: !!c.usageBeforeZero,
    officeTerminal: !!c.officeTerminal,
    officeSourceNotDisabled: !!c.officeSourceNotDisabled,
    officeSourceCountPositive: !!c.officeSourceCountPositive,
    officePersistedPositive: !!c.officePersistedPositive,
    residentialTerminal: !!c.residentialTerminal,
    residentialSourceNotDisabled: !!c.residentialSourceNotDisabled,
    residentialSourceCountPositive: !!c.residentialSourceCountPositive,
    residentialPersistedPositive: !!c.residentialPersistedPositive,
    aiUsageNoChange: !!c.aiUsageNoChange,
  };
  const int = (v) => Number.isInteger(v) && v >= 0 ? v : 0;
  const counts = {
    postRuns: int(n.postRuns),
    terminalJobs: int(n.terminalJobs),
    sourceRuns: int(n.sourceRuns),
    persistedListings: int(n.persistedListings),
  };
  const pass = s.status === "PASS" && Object.values(ch).every(Boolean);
  const status = pass ? "PASS" : s.status === "PARTIAL" ? "PARTIAL" : "FAIL";
  const code = status === "PASS" ? null : (typeof s.errorCode === "string" && CODE.test(s.errorCode) ? s.errorCode : "worker_live_failed");
  return Object.freeze({ schema: R, status, errorCode: code, checks: Object.freeze(ch), counts: Object.freeze(counts), statuses: Object.freeze(st) });
}

export async function runInstalledSearchWorkerLive({ page, base } = {}) {
  const st = { status: "FAIL", errorCode: "worker_live_failed", checks: {}, counts: { postRuns: 0, terminalJobs: 0, sourceRuns: 0, persistedListings: 0 }, statuses: {} };
  try {
    if (!page || typeof page.evaluate !== "function") fail("invalid_page_handle");
    const expectedOrigin = validateBase(base);
    if (typeof page.url !== "function" || new URL(page.url()).origin !== expectedOrigin) fail("page_origin_mismatch");
    const me = await req(page, "GET", "/api/v1/auth/me");
    if (!me.ok || !obj(me.body) || me.body.role !== "manager") fail("actor_not_manager");
    st.checks.actorManager = true;
    const av = await req(page, "GET", "/api/v1/property-search/availability");
    const on = Array.isArray(av.body?.sources) ? av.body.sources.find((x) => x && x.source === "onrealt") : null;
    if (!av.ok || !obj(av.body) || av.body.scraper?.enabled !== true || !on || on.enabled !== true || av.body.ai?.available !== false) fail("availability_not_ready");
    st.checks.availabilityReady = true;
    const ub = await req(page, "GET", "/api/v1/ai/usage?page=1");
    if (!ub.ok || !obj(ub.body) || !Array.isArray(ub.body.items)) fail("usage_fetch_failed");
    st.checks.usageBeforeZero = ub.body.total === 0 && ub.body.items.length === 0;
    const beforeIds = ub.body.items.map((x) => x && x.id).filter((x) => typeof x === "string");
    const j1 = await job(page, "office", st);
    st.checks.officeTerminal = j1.ok ? true : j1.status !== "queued" && j1.status !== "running";
    st.checks.officeSourceNotDisabled = j1.sourceStatus !== null && j1.sourceStatus !== "disabled";
    st.checks.officeSourceCountPositive = j1.resultCount > 0;
    st.checks.officePersistedPositive = j1.total > 0;
    const j2 = await job(page, "residential", st);
    st.checks.residentialTerminal = j2.ok ? true : j2.status !== "queued" && j2.status !== "running";
    st.checks.residentialSourceNotDisabled = j2.sourceStatus !== null && j2.sourceStatus !== "disabled";
    st.checks.residentialSourceCountPositive = j2.resultCount > 0;
    st.checks.residentialPersistedPositive = j2.total > 0;
    st.counts.terminalJobs = (j1.ok ? 1 : 0) + (j2.ok ? 1 : 0);
    st.counts.sourceRuns = 2;
    const ua = await req(page, "GET", "/api/v1/ai/usage?page=1");
    const afterIds = Array.isArray(ua.body?.items) ? ua.body.items.map((x) => x && x.id).filter((x) => typeof x === "string") : [];
    st.checks.aiUsageNoChange = ua.ok && obj(ua.body) && ua.body.total === ub.body.total && ua.body.reservedRub === ub.body.reservedRub && afterIds.length === beforeIds.length && afterIds.every((x, i) => x === beforeIds[i]);
    st.statuses = { officeRunStatus: j1.status, officeSourceStatus: j1.sourceStatus, residentialRunStatus: j2.status, residentialSourceStatus: j2.sourceStatus };
    const blocked = !j1.ok || !j2.ok;
    st.status = blocked ? "PARTIAL" : "PASS";
    st.errorCode = blocked ? "site_blocked_or_no_listings" : null;
  } catch (e) {
    const c = typeof e?.code === "string" && CODE.test(e.code) ? e.code : "worker_live_failed";
    if (st.status !== "PARTIAL") { st.status = "FAIL"; st.errorCode = c; }
  }
  return closed(st);
}
