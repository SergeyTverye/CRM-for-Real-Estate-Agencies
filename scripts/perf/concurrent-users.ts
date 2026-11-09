import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db, disconnectDb } from "@/shared/db/client";
import { hashPassword } from "@/modules/auth/infrastructure/password-hasher";
import { login as authenticate } from "@/modules/auth/application/auth-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";

const base = process.env.PERF_BASE_URL ?? `http://127.0.0.1:${process.env.APP_PORT ?? "8080"}`;
const durationMs = Number(process.env.PERF_DURATION_MS ?? 180_000);
const suffix = randomBytes(5).toString("hex");
const accounts = [["manager", "manager"], ["realtor1", "realtor"], ["realtor2", "realtor"]] as const;
type Metric = { ms: number; status: number; operation: string; actor: string; code?: string; message?: string };
const metrics: Metric[] = [];
const nowIso = () => new Date().toISOString();

async function call(actor: string, cookie: string, operation: string, path: string, init?: RequestInit) {
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(`${base}/api/v1${path}`, { ...init, headers: { cookie, ...(init?.method === "POST" ? { origin: base } : {}), ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
    status = response.status;
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const errorCode = (data as { error?: { code?: unknown } } | null)?.error?.code;
    const errorMessage = (data as { error?: { message?: unknown } } | null)?.error?.message;
    metrics.push({ actor, operation, status, ms: performance.now() - started, ...(typeof errorCode === "string" ? { code: errorCode } : {}), ...(typeof errorMessage === "string" ? { message: errorMessage.slice(0, 120) } : {}) });
    return { response, data };
  } catch {
    metrics.push({ actor, operation, status, ms: performance.now() - started });
    return { response: null, data: null };
  }
}

async function login(loginName: string, password: string) {
  const started = performance.now();
  const result = await authenticate(loginName, password, { ip: "127.0.0.1", userAgent: "perf-v241" });
  metrics.push({ actor: loginName, operation: "login", status: 200, ms: performance.now() - started });
  return `${SESSION_COOKIE}=${result.token}`;
}

async function main() {
  const password = randomBytes(32).toString("base64url");
  const created: string[] = [];
  let identities: Array<{ name: string; cookie: string }> = [];
  try {
    for (const [name, role] of accounts) {
      const loginName = `perf_${name}_${suffix}`;
      const user = await db.user.create({ data: { login: loginName, displayName: `[PERF] ${name}`, roleCode: role, passwordHash: await hashPassword(password), mustChangePassword: false } });
      created.push(user.id);
      await db.client.createMany({ data: [1, 2].map((n) => ({ displayName: `[PERF] ${name} client ${n} ${suffix}`, clientKind: "person", responsibleUserId: user.id, status: "active", notes: "[PERF] synthetic load fixture", createdBy: user.id })) });
    }
    identities = await Promise.all(accounts.map(async ([name]) => ({ name, cookie: await login(`perf_${name}_${suffix}`, password) })));
  const byName = Object.fromEntries(identities.map((x) => [x.name, x.cookie]));
  const own = await call("realtor1", byName.realtor1!, "clients.list", "/clients?limit=20");
  const payload = own.data as { items?: Array<{ id?: string }>; clients?: Array<{ id?: string }> } | null;
  const list = payload?.items ?? payload?.clients ?? [];
  const foreignId = list[0]?.id;
  if (foreignId) await call("realtor2", byName.realtor2!, "privacy.foreign-client", `/clients/${encodeURIComponent(foreignId)}`);
  const until = Date.now() + durationMs;
  while (Date.now() < until) {
    await Promise.all(identities.map(async ({ name, cookie }) => {
      const operations: Array<[string, string]> = [
        ["clients.list", "/clients?limit=20"], ["search", "/search?q=PERF"],
        ["calendar", `/calendar?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 7 * 86_400_000).toISOString())}`], ["notifications", "/notifications?limit=20"],
      ];
      if (name !== "manager") operations.push(["need.card", "/needs?limit=1"]);
      else operations.push(["manager.report", "/reports/manager"]);
      await Promise.all(operations.map(([op, path]) => call(name, cookie, op, path)));
      await call(name, cookie, "request.create", "/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ occurredAt: nowIso(), channelCode: "phone", sourceCode: "other", summary: `[PERF] synthetic measurement ${suffix}`, client: { mode: "none" }, outcome: { resultCode: "one_off_service", nextAction: { title: `[PERF] follow-up ${suffix}`, description: "Synthetic performance check", taskType: "call_or_contact", dueAt: new Date(Date.now() + 86_400_000).toISOString(), priority: "normal" } } }) });
    }));
  }
  const groups = new Map<string, number[]>();
  for (const m of metrics) groups.set(`${m.actor}.${m.operation}`, [...(groups.get(`${m.actor}.${m.operation}`) ?? []), m.ms]);
  const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)] ?? 0;
  const summary = [...groups].map(([operation, values]) => ({ operation, count: values.length, p50: Math.round(percentile(values, .5)), p95: Math.round(percentile(values, .95)), max: Math.round(Math.max(...values)) }));
  console.log(JSON.stringify({ base, durationMs, foreignClientIdChecked: Boolean(foreignId), foreignClientStatus: metrics.find((m) => m.operation === "privacy.foreign-client")?.status ?? "no-owned-client", errors4xx: metrics.filter((m) => m.status >= 400 && m.status < 500).length, errors5xx: metrics.filter((m) => m.status >= 500).length, conflicts409: metrics.filter((m) => m.status === 409).length, summary: summary.map((s) => ({ ...s, statuses: Object.fromEntries([...new Set(metrics.filter((m) => `${m.actor}.${m.operation}` === s.operation).map((m) => m.status))].map((status) => [status, metrics.filter((m) => `${m.actor}.${m.operation}` === s.operation && m.status === status).length])), errorCodes: [...new Set(metrics.filter((m) => `${m.actor}.${m.operation}` === s.operation).map((m) => m.code).filter(Boolean))], errorMessages: [...new Set(metrics.filter((m) => `${m.actor}.${m.operation}` === s.operation).map((m) => m.message).filter(Boolean))] })) }, null, 2));
  } finally {
    await db.userSession.updateMany({ where: { userId: { in: created }, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: created } }, data: { isActive: false } });
    await disconnectDb();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Perf run failed"); process.exitCode = 1; });
