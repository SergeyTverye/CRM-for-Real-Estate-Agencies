import { db } from "@/shared/db/client";
import { writeAudit } from "@/modules/audit/application/audit";
import type { SearchContinuationPort } from "../domain/session";
import { PlaywrightSessionBrowser } from "../infrastructure/playwright-browser";
import { PrismaSessionRepository } from "../infrastructure/prisma-repository";
import { BrowserSessionService } from "./session-service";

const state = globalThis as typeof globalThis & { crmBrowserSessionService?: BrowserSessionService; crmBrowserSessionSearch?: SearchContinuationPort };
/** Called by search composition root on the server, never by client code. */
export function configureBrowserSessionSearch(port: SearchContinuationPort) { state.crmBrowserSessionSearch = port; }
const search: SearchContinuationPort = {
  prepare: async (...args) => (await requiredSearch()).prepare(...args),
  isReady: async (...args) => (await requiredSearch()).isReady(...args),
  resume: async (...args) => (await requiredSearch()).resume(...args),
  blocked: async (...args) => (await requiredSearch()).blocked(...args),
  isCancelled: async runId => (await requiredSearch()).isCancelled?.(runId) ?? false,
};
async function requiredSearch() {
  if (!state.crmBrowserSessionSearch) {
    const [{ attachInteractiveSearchAdapter }, { ProductionInteractiveSearchAdapter }] = await Promise.all([
      import("@/modules/property-search/application/browser-continuation"), import("@/modules/property-search/infrastructure/interactive-search-adapter"),
    ]);
    if (!state.crmBrowserSessionSearch) attachInteractiveSearchAdapter(new ProductionInteractiveSearchAdapter());
  }
  return state.crmBrowserSessionSearch!;
}
/** Composition/test seam; routes and application cancellation share the same owner process. */
export function configureBrowserSessionService(service: BrowserSessionService) { state.crmBrowserSessionService = service; }
export async function cancelRunBrowserSessions(runId: string) { await state.crmBrowserSessionService?.cancelRun(runId); }
export function browserSessions() {
  return state.crmBrowserSessionService ??= new BrowserSessionService(new PrismaSessionRepository(), new PlaywrightSessionBrowser(), search,
    async (session, event) => {
      await writeAudit(db, { actorUserId: session.ownerUserId, entityType: "InteractiveBrowserSession", entityId: session.id,
        action: `browser_session.${event}`, after: { searchRunId: session.searchRunId, source: session.source, status: session.status, closeReason: session.closeReason } });
    }, { maxConcurrent: Math.min(3, Math.max(1, Number(process.env.BROWSER_SESSION_MAX_CONCURRENT) || 1)) });
}
