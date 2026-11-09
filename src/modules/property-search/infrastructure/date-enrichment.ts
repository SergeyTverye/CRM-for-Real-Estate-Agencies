import type { Source } from "../domain/types";
import { extractListingDates, type ListingDates } from "./listing-dates";
import { detectAccessChallenge } from "./source-response";

export interface DateDetailProgress { requested: number; cacheHits: number; enriched: number; failed: number; limit: number; }
export interface DateDetailOptions { maxCards?: number; deadline?: number; now?: () => number; cache?: Map<string, { expires: number; dates: ListingDates }>; }

const sharedCache: NonNullable<DateDetailOptions["cache"]> = new Map();
export class DateEnrichment {
  readonly progress: DateDetailProgress;
  private readonly now: () => number;
  private readonly cache: NonNullable<DateDetailOptions["cache"]>;
  private readonly deadline: number;
  private stopped = false;
  constructor(private readonly options: DateDetailOptions = {}) {
    const limit = options.maxCards ?? 3;
    if (!Number.isInteger(limit) || limit < 0 || limit > 10) throw Error("INVALID_DATE_DETAIL_LIMIT");
    this.progress = { requested: 0, cacheHits: 0, enriched: 0, failed: 0, limit };
    this.now = options.now ?? Date.now;
    this.deadline = Math.min(options.deadline ?? Infinity, this.now() + 15000);
    this.cache = options.cache ?? sharedCache;
  }
  async read(source: Source, identity: { id?: string | null; url: string }, fetch: (signal: AbortSignal) => Promise<unknown>, signal?: AbortSignal): Promise<ListingDates | null> {
    if (!["onrealt", "mirkvartir"].includes(source) || this.stopped || signal?.aborted || this.now() + 1000 >= this.deadline) return null;
    const key = `${source}:${identity.id ?? identity.url}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) { this.progress.cacheHits++; return cached.dates; }
    if (this.progress.requested >= this.progress.limit) return null;
    this.progress.requested++;
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = await Promise.race([fetch(controller.signal), new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(Error("DATE_DETAIL_ABORTED")), { once: true });
        
        timer = setTimeout(abort, Math.max(1, Math.min(3000, this.deadline - this.now() - 1000)));
      })]);
      const response = payload && typeof payload === "object" && "data" in payload ? payload as { data: unknown; status?: number } : { data: payload, status: 200 };
      if ((response.status ?? 200) >= 400 || detectAccessChallenge(identity.url, response.data)) throw Error("DATE_DETAIL_UNAVAILABLE");
      const dates = extractListingDates(source, response.data, identity, new Date(this.now()).toISOString());
      if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: this.now() + (dates.publishedAt ? 3600000 : 300000), dates });
      if (dates.publishedAt) this.progress.enriched++;
      return dates;
    } catch { this.progress.failed++; this.stopped = true; return null; }
    finally { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); }
  }
}
