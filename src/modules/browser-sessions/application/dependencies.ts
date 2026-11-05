import { InfrastructureError } from "@/shared/errors";
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
  prepare: (...args) => requiredSearch().prepare(...args),
  isReady: (...args) => requiredSearch().isReady(...args),
  resume: (...args) => requiredSearch().resume(...args),
  blocked: (...args) => requiredSearch().blocked(...args),
};
function requiredSearch() {
  if (!state.crmBrowserSessionSearch) throw new InfrastructureError("Интерактивное продолжение для площадки ещё не подключено. Используйте ручной импорт или добавление по ссылке.");
  return state.crmBrowserSessionSearch;
}
export function browserSessions() {
  return state.crmBrowserSessionService ??= new BrowserSessionService(new PrismaSessionRepository(), new PlaywrightSessionBrowser(), search,
    async (session, event) => {
      await writeAudit(db, { actorUserId: session.ownerUserId, entityType: "InteractiveBrowserSession", entityId: session.id,
        action: `browser_session.${event}`, after: { searchRunId: session.searchRunId, source: session.source, status: session.status, closeReason: session.closeReason } });
    });
}
