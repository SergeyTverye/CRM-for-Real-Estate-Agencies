import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db, disconnectDb } from "../../../src/shared/db/client";
import { createSession, revokeSession, resolveSession } from "../../../src/modules/auth/application/session-service";
import { enqueueSearch, processSearchQueue } from "../../../src/modules/property-search/application/search-queue";
import { RealEstateScraperAdapter, defaultScraperFactory } from "../../../src/modules/property-search/infrastructure/scraper-adapter";
import { scraperHttpRequest } from "../../../src/modules/property-search/infrastructure/scraper-http";
import { hashPassword } from "../../../src/modules/auth/infrastructure/password-hasher";
import { SearchFilters, type NormalizedListing } from "../../../src/modules/property-search/domain/types";
import { evaluateListing } from "../../../src/modules/property-search/domain/evaluation";
config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
process.env.AI_ENABLED = "false";
process.env.SCRAPER_DEMO_FIXTURES = "false";
process.env.LOG_LEVEL = "silent";
async function main() {
    if (process.argv[2] === "cleanup-check") {
        const where = { login: { startsWith: "v31_smoke_" } };
        const result = {
            database: "crm_demo", checkedAt: new Date().toISOString(),
            temporaryUsers: await db.user.count({ where }),
            activeTemporaryUsers: await db.user.count({ where: { ...where, isActive: true } }),
            activeTemporarySessions: await db.userSession.count({ where: { user: where, revokedAt: null } }),
            realAiCallsInThisTrial: 0, settingsModifiedByThisTrial: false,
        };
        writeFileSync("docs/vkr/v31-remaining-cleanup.json", JSON.stringify(result, null, 2) + "\n");
        console.log(JSON.stringify(result)); return;
    }
    if (process.argv[2] === "replay-onrealt") {
        const path = "docs/vkr/v31-remaining-onrealt.json";
        const { readFileSync } = await import("node:fs");
        const evidence = JSON.parse(readFileSync(path, "utf8"));
        const run = await db.searchRun.findUniqueOrThrow({ where: { id: evidence.runId } });
        const filters = SearchFilters.parse(run.filters);
        const snapshots = await db.externalListingSnapshot.findMany({ where: { searchRunId: run.id } });
        const verdicts = snapshots.map(s => evaluateListing(s.normalized as unknown as NormalizedListing, filters, run.startedAt).verdict);
        evidence.afterFixReplay = { mode: "REPLAY", networkRequests: 0, snapshots: snapshots.length, verdicts: Object.fromEntries(["confirmed", "needs_review", "rejected"].map(v => [v, verdicts.filter(x => x === v).length])) };
        writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n");
        console.log(JSON.stringify(evidence.afterFixReplay)); return;
    }
    const user = await db.user.create({ data: { login: `v31_smoke_${randomUUID()}`, displayName: "Проверка AT-01/16 DEMO", roleCode: "manager", passwordHash: await hashPassword(randomUUID()) } });
    const session = await createSession(db, user.id, { userAgent: "AT-01/16 bounded smoke" });
    const actor = (await resolveSession(session.token))!;
    try {
        if (process.argv[2] === "browser") {
            const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/ai-chat.playwright.config.ts"], {
                env: { ...process.env, E2E_CHAT_DEMO: "true", E2E_CHAT_SESSION: session.token }, stdio: "inherit",
            });
            if (result.status !== 0) throw Error("Browser smoke failed");
            return;
        }
        if (process.argv[2] !== "onrealt") throw Error("Choose browser or onrealt");
        const path = "docs/vkr/v31-remaining-onrealt.json";
        if (existsSync(path)) throw Error("LIVE already dispatched; no automatic repeat");
        if (await db.searchRun.count({ where: { status: { in: ["queued", "running"] } } })) throw Error("Queue busy; no unrelated job may be claimed");
        const requests: { url: string; at: string; status?: number }[] = [];
        const evidence: Record<string, unknown> = { mode: "LIVE", database: "crm_demo", aiCalls: 0, discoveryRequests: 4, requests };
        const save = () => writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n");
        const adapter = new RealEstateScraperAdapter({ enabled: true, enabledSources: ["onrealt"], browserEnabled: false,
            depth: { maxPages: 1, limit: 20 }, jobTimeoutMs: 60_000,
            factory: cfg => defaultScraperFactory({ ...cfg, transport: async request => {
                const response = await scraperHttpRequest(request.url, { method: "GET", signal: request.signal, timeoutMs: 15_000, maxBytes: 5_000_000,
                    beforeRequest: url => { if (requests.length >= 4) throw Error("SMOKE_REQUEST_BUDGET"); requests.push({ url, at: new Date().toISOString() }); save(); },
                    onResponse: response => { requests.at(-1)!.status = response.status; save(); } });
                return { data: response.data.toString("utf8"), status: response.status, url: response.url, headers: {} };
            } }),
        });
        const run = await enqueueSearch(actor, { filters: { city: "Новосибирск", operation: "rent", purposes: ["retail"], priceUnit: "rub_month" }, sources: ["onrealt"], depth: { maxPages: 1, limit: 20 }, deadlineMs: 90_000, idempotencyKey: "v31-remaining-onrealt-retail-rent" });
        evidence.runId = run.id; save();
        await processSearchQueue({ scraper: adapter, workerId: "at01-onrealt-smoke" });
        const source = await db.searchRunSource.findUniqueOrThrow({ where: { runId_source: { runId: run.id, source: "onrealt" } } });
        const results = await db.searchRunResult.findMany({ where: { runId: run.id }, select: { verdict: true, listing: { select: { url: true } } } });
        Object.assign(evidence, { source, count: results.length, verdicts: Object.fromEntries(["confirmed", "needs_review", "rejected"].map(v => [v, results.filter(r => r.verdict === v).length])), sampleUrls: results.slice(0, 4).map(r => r.listing.url), status: (await db.searchRun.findUniqueOrThrow({ where: { id: run.id } })).status }); save();
        console.log(JSON.stringify({ status: evidence.status, count: results.length, requests: requests.length, verdicts: evidence.verdicts }));
        if (!results.length) throw Error("OnRealt returned no saved listings; see evidence");
    } finally { await revokeSession(db, actor.sessionId); await db.user.update({ where: { id: user.id }, data: { isActive: false } }); }
}
main().catch(() => { console.error("Smoke failed; inspect sanitized evidence/test output"); process.exitCode = 1; }).finally(disconnectDb);
