import { config } from "dotenv";
import { createHash } from "node:crypto";
import { getDb } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";

config({ path: [".env.local", ".env"], quiet: true });
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/crm_demo") {
  throw new Error("Demo seed requires an explicit DATABASE_URL ending in /crm_demo");
}
Object.assign(process.env, {
  SCRAPER_DEMO_FIXTURES: "true", SCRAPER_ENABLED: "true", AI_ENABLED: "true",
  YANDEX_WEB_SEARCH_ENABLED: "true", YANDEX_WEB_SEARCH_AUTO_FALLBACK: "true",
  LOG_LEVEL: "silent",
});
export const db = getDb();
export const marker = "[DEMO-V241]";
export function demoId(key: string) {
  const hex = createHash("sha256").update(`crm-demo-v241:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export type DemoContext = {
  agents: Actor[]; manager: Actor; origin: Date;
  clients: Awaited<ReturnType<typeof db.client.create>>[];
  needs: Awaited<ReturnType<typeof db.clientNeed.create>>[];
  properties: Awaited<ReturnType<typeof db.property.create>>[];
};
export const day = (origin: Date, days: number, hour = 9 + ((days % 11) + 11) % 11) => {
  const local = new Date(+origin + 7 * 3600000 + days * 86400000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour - 7));
};
export async function printCounts() {
  const delegates = {
    clients: db.client, client_contacts: db.clientContact, client_needs: db.clientNeed,
    lead_requests: db.leadRequest, properties: db.property, tasks: db.task, showings: db.showing,
    calendar_events: db.calendarEvent, documents: db.document, document_properties: db.documentProperty,
    commercial_offers: db.commercialOffer, commercial_offer_items: db.commercialOfferItem,
    deals: db.deal, deal_parties: db.dealParty, deal_commissions: db.dealCommission,
    deal_checklist_items: db.dealChecklistItem, agreements: db.agreement,
    search_runs: db.searchRun, search_run_sources: db.searchRunSource, search_run_results: db.searchRunResult,
    external_listings: db.externalListing, external_listing_snapshots: db.externalListingSnapshot,
    search_bookmarks: db.searchBookmark, search_selections: db.searchSelection, saved_searches: db.savedSearch,
    need_property_matches: db.needPropertyMatch, notifications: db.notification, ai_usage_logs: db.aiUsageLog,
  };
  const counts: Record<string, number> = {};
  for (const [name, delegate] of Object.entries(delegates)) counts[name] = await (delegate.count as () => Promise<number>)();
  console.log(JSON.stringify(counts));
}
