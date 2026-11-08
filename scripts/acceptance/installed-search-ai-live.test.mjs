import test from "node:test";
import assert from "node:assert/strict";
import { runInstalledSearchAiLive } from "./installed-search-ai-live.mjs";

const BASE = "http://127.0.0.1:43117";
const CRED = { apiKey: "SYNTH_KEY_9f3a", folder: "SYNTH_FOLDER_b7c1" };
const PARSE_OK = { filters: { operation: "sale", purposes: ["residential"], city: "Новосибирск", priceTo: 7000000, areaFrom: 40 } };

function mkPage(router, dom = "<html>safe</html>") {
  return {
    url: () => `${BASE}/search`,
    goto: async () => {},
    content: async () => dom,
    evaluate: async (_fn, args) => {
      if (args && Object.hasOwn(args, "m")) return router(args.m, args.p, args.b);
      if (args && Object.hasOwn(args, "t")) return router("POST_TIMEOUT", args.p, args.b);
      throw new Error("unexpected_fakepage_args");
    },
  };
}
function setting(updatedAt = "2026-01-01T00:00:00.000Z") {
  const s = { updatedAt, aiEnabled: true, scraperEnabled: true, browserEnabled: false, enabledSources: ["cian"], webSearchManualAllowed: true, webSearchAutoFallback: true, model: "m", webModel: null, searchContextSize: "low", perUserDailyLimit: 9, perJobLimit: 9, dailyLimit: 9, monthlyBudgetRub: "99" };
  return s;
}
function tightened() {
  const s = { ...setting(), perUserDailyLimit: 1, perJobLimit: 1, dailyLimit: 1, monthlyBudgetRub: "1", webSearchManualAllowed: false, webSearchAutoFallback: false };
  return { ok: true, body: { setting: s, effective: { values: { monthlyBudgetRub: "1" } } } };
}
function happyRouter(state = {}) {
  const calls = state.calls = state.calls || { deleteCred: 0, putCred: 0, parse: 0 };
  let deleted = false, configured = false;
  return (m, p) => {
    if (m === "GET" && p === "/api/v1/auth/me") return { ok: true, body: { role: "manager" } };
    if (m === "GET" && p === "/api/v1/settings/ai/credentials") return { ok: true, body: configured && !deleted ? { configured: true, status: "configured", editable: true } : { configured: false, status: "missing", editable: true } };
    if (m === "GET" && p === "/api/v1/settings/ai") return { ok: true, body: { setting: setting(), effective: { values: { monthlyBudgetRub: "99" } } } };
    if (m === "PUT" && p === "/api/v1/settings/ai") return tightened();
    if (m === "GET" && p === "/api/v1/ai/limits") return { ok: true, body: { budgetAvailable: true, remaining: { hour: 5, day: 10 } } };
    if (m === "GET" && p === "/api/v1/ai/usage?page=1") return { ok: true, body: { items: state.after ? [{ id: "u1", status: "settled", chargedCostRub: "0.4" }] : [], reservedRub: "0" } };
    if (m === "PUT" && p === "/api/v1/settings/ai/credentials") { calls.putCred++; configured = true; return { ok: true, body: { configured: true, source: "local", status: "configured" } }; }
    if (m === "DELETE" && p === "/api/v1/settings/ai/credentials") { calls.deleteCred++; deleted = true; return { ok: state.deleteOk !== false, body: { configured: false, status: "missing" } }; }
    if (m === "GET" && p === "/api/v1/property-search/availability") return { ok: true, body: { ai: { available: true } } };
    if (m === "POST_TIMEOUT" && p === "/api/v1/property-search/parse") { calls.parse++; state.after = true; if (state.parseThrow) throw new Error("net"); return { ok: true, body: PARSE_OK }; }
    return { ok: false, status: 404, body: { code: "not_found", path: p, method: m } };
  };
}

test("preflight existing configured credential must NOT DELETE/PUT/parse", async () => {
  const calls = { d: 0, p: 0, pr: 0 };
  const page = mkPage((m, p) => {
    if (m === "GET" && p === "/api/v1/auth/me") return { ok: true, body: { role: "manager" } };
    if (m === "GET" && p === "/api/v1/settings/ai/credentials") return { ok: true, body: { configured: true, status: "configured", editable: true } };
    if (m === "DELETE") calls.d++; if (m === "PUT") calls.p++; if (m === "POST_TIMEOUT") calls.pr++;
    return { ok: false, body: {} };
  });
  const r = await runInstalledSearchAiLive({ page, base: BASE, loadCredentials: async () => CRED });
  assert.equal(r.status, "NOTPASS");
  assert.equal(r.errorCode, "credential_not_fresh");
  assert.deepEqual(calls, { d: 0, p: 0, pr: 0 });
});

test("anonymous/wrong role no DELETE", async () => {
  let del = 0;
  const page = mkPage((m, p) => {
    if (m === "GET" && p === "/api/v1/auth/me") return { ok: true, body: { role: "agent" } };
    if (m === "DELETE") del++;
    return { ok: false, body: {} };
  });
  const r = await runInstalledSearchAiLive({ page, base: BASE, loadCredentials: async () => CRED });
  assert.equal(r.status, "NOTPASS");
  assert.equal(r.errorCode, "actor_not_manager");
  assert.equal(del, 0);
});

test("successful sequence PASS only after verified DELETE+GET missing, exactly one parse POST, budget 1", async () => {
  const state = {};
  const r = await runInstalledSearchAiLive({ page: mkPage(happyRouter(state)), base: BASE, loadCredentials: async () => CRED });
  assert.equal(r.status, "PASS");
  assert.equal(r.errorCode, null);
  assert.equal(state.calls.parse, 1);
  assert.equal(state.calls.deleteCred, 1);
  assert.equal(r.counts.parseCalls, 1);
  assert.equal(r.rub.budgetCapRub, 1);
  assert.equal(r.checks.credentialRemoved, true);
  assert.equal(r.checks.parseCalledOnce, true);
  assert.equal(r.checks.usageChargedOnce, true);
});

test("cleanup DELETE fail returns FAIL not PASS", async () => {
  const state = {};
  const router = happyRouter(state);
  const page = mkPage((m, p, b) => {
    if (m === "DELETE" && p === "/api/v1/settings/ai/credentials") { state.calls.deleteCred++; return { ok: false, status: 500, body: {} }; }
    return router(m, p, b);
  });
  const r = await runInstalledSearchAiLive({ page, base: BASE, loadCredentials: async () => CRED });
  assert.equal(r.status, "FAIL");
  assert.equal(r.errorCode, "credential_cleanup_failed");
});

test("parse POST throw counts 1 and still deletes own secret, no retry", async () => {
  const state = { parseThrow: true };
  const r = await runInstalledSearchAiLive({ page: mkPage(happyRouter(state)), base: BASE, loadCredentials: async () => CRED });
  assert.equal(r.counts.parseCalls, 1);
  assert.equal(state.calls.parse, 1);
  assert.equal(state.calls.deleteCred, 1);
  assert.equal(r.checks.noSecretLeak, true);
  assert.notEqual(r.status, "PASS");
});

test("actual effective budget > 1 refuses before credentials", async () => {
  let loaded = 0;
  const page = mkPage((m, p) => {
    if (m === "GET" && p === "/api/v1/auth/me") return { ok: true, body: { role: "manager" } };
    if (m === "GET" && p === "/api/v1/settings/ai/credentials") return { ok: true, body: { configured: false, status: "missing", editable: true } };
    if (m === "GET" && p === "/api/v1/settings/ai") return { ok: true, body: { setting: setting() } };
    if (m === "PUT" && p === "/api/v1/settings/ai") return { ok: true, body: { setting: { ...setting(), perUserDailyLimit: 1, perJobLimit: 1, dailyLimit: 1, monthlyBudgetRub: "2", webSearchManualAllowed: false, webSearchAutoFallback: false }, effective: { values: { monthlyBudgetRub: "2" } } } };
    return { ok: false, body: {} };
  });
  const r = await runInstalledSearchAiLive({ page, base: BASE, loadCredentials: async () => { loaded++; return CRED; } });
  assert.notEqual(r.status, "PASS");
  assert.equal(loaded, 0);
});
