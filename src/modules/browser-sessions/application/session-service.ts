import { randomUUID } from "node:crypto";
import type { Actor } from "@/modules/auth/domain/actor";
import { ConflictError, ForbiddenError, InfrastructureError, NotFoundError, RateLimitError, ValidationError } from "@/shared/errors";
import { parseInput } from "@/shared/validation";
import { createSessionInput, inputEvent, isLive, type BrowserFactory, type BrowserHandle, type InteractiveSession, type PreparedSearch, type SearchContinuationPort, type SessionAudit, type SessionRepository } from "../domain/session";

interface Runtime {
  actor: Actor; prepared: PreparedSearch; session: InteractiveSession; controller: AbortController; handle?: BrowserHandle;
  busy: boolean; inputBusy: boolean; probing: boolean; hits: number[]; polls: number[]; timer?: ReturnType<typeof setTimeout>;
}
export class BrowserSessionService {
  private running = new Map<string, Runtime>();
  private closing = new Map<string, Promise<void>>();
  constructor(private readonly repo: SessionRepository, private readonly browsers: BrowserFactory,
    private readonly search: SearchContinuationPort, private readonly audit: SessionAudit,
    private readonly options: { now?: () => number; idleMs?: number; totalMs?: number; tickMs?: number; maxConcurrent?: number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private async owned(actor: Actor, id: string) {
    await this.closing.get(id);
    const row = await this.repo.get(id);
    // Manager has no implicit right to observe another employee's authenticated browser.
    if (!row || row.ownerUserId !== actor.userId) throw new NotFoundError();
    return row;
  }
  private dto(row: InteractiveSession) {
    return { ...row, manualImportUrl: "/import", addByLinkUrl: "/property-search", continuing: this.running.get(row.id)?.busy ?? false };
  }
  async get(actor: Actor, id: string) {
    let row = await this.owned(actor, id);
    if (isLive(row)) {
      if (!this.running.has(id)) await this.finish(row, "failed", "process_lost");
      else await this.expireIfNeeded(row);
      row = await this.owned(actor, id);
    }
    return this.dto(row);
  }
  async create(actor: Actor, raw: unknown) {
    const input = parseInput(createSessionInput, raw);
    let prepared: PreparedSearch;
    try { prepared = await this.search.prepare(actor, input.searchRunId, input.source); }
    catch (e) {
      if (e instanceof NotFoundError || e instanceof ForbiddenError || e instanceof ConflictError || e instanceof ValidationError) throw e;
      throw new InfrastructureError("Интерактивное продолжение недоступно. Используйте ручной импорт или добавление по ссылке.");
    }
    let startUrlHost: string;
    try {
      const url = new URL(prepared.startUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || prepared.startUrl.length > 8192) throw new Error("INVALID_START_URL");
      startUrlHost = url.hostname;
    } catch { throw new InfrastructureError("Адаптер не предоставил безопасный адрес проверки."); }
    const existing = await this.repo.active(actor.userId, input.source);
    if (existing) {
      // Single application worker owns live contexts. After restart no profile/cookie state is resumed.
      await this.get(actor, existing.id);
      const current = await this.repo.get(existing.id);
      if (current && isLive(current)) throw new ConflictError("BROWSER_SESSION_EXISTS", "Для этой площадки уже открыт сеанс.", { sessionUrl: `/browser-sessions/${existing.id}` });
    }
    if (this.running.size >= (this.options.maxConcurrent ?? 2)) throw new ConflictError("BROWSER_CAPACITY", "Все интерактивные сеансы заняты. Завершите открытый сеанс и повторите.");
    const now = this.now();
    const row: InteractiveSession = { id: randomUUID(), ...input, ownerUserId: actor.userId, status: "pending",
      startUrlHost, createdAt: new Date(now), lastActivityAt: new Date(now),
      expiresAt: new Date(now + (this.options.totalMs ?? 20 * 60_000)), completedAt: null, closeReason: null };
    if (!await this.repo.claim(row, this.options.maxConcurrent ?? 2)) throw new ConflictError("BROWSER_SESSION_EXISTS", "Для этой площадки уже открыт сеанс. Завершите или отмените его.");
    const runtime: Runtime = { actor: { ...actor }, prepared, session: row, controller: new AbortController(), busy: false, inputBusy: false, probing: false, hits: [], polls: [] };
    this.running.set(row.id, runtime);
    this.schedule(row.id);
    try {
      await this.audit(row, "created");
      const handle = await this.browsers.open(prepared.startUrl, row.source, runtime.controller.signal,
        () => { void this.closeById(row.id, "failed", "navigation_blocked").catch(() => undefined); });
      if (runtime.controller.signal.aborted) { await handle.close(); return this.get(actor, row.id); }
      runtime.handle = handle; row.status = "active";
      await this.repo.save(row);
      if (runtime.controller.signal.aborted) return this.get(actor, row.id);
      await this.audit(row, "opened");
      return this.dto(row);
    } catch {
      await this.closeById(row.id, "failed", "browser_start_failed");
      // Never forward Playwright errors: they may include URLs, cookies or typed text.
      throw new InfrastructureError("Не удалось открыть защищённый сеанс. Доступен ручной импорт или добавление по ссылке.");
    }
  }
  private schedule(id: string) {
    const rt = this.running.get(id); if (!rt) return;
    rt.timer = setInterval(() => { void this.tick(id).catch(async e => {
      if (e instanceof ConflictError) return;
      await this.closeById(id, "failed", "session_check_failed").catch(() => undefined);
    }); }, this.options.tickMs ?? 2000);
    rt.timer.unref?.();
  }
  private async tick(id: string) {
    const rt = this.running.get(id), row = rt?.session;
    // The security deadline must not depend on availability/latency of PostgreSQL.
    if (!row || !rt || rt.controller.signal.aborted || !isLive(row) || await this.expireIfNeeded(row)) return;
    if (await this.search.isCancelled?.(row.searchRunId)) { await this.finish(row, "cancelled", "search_cancelled"); return; }
    if (rt.handle && !rt.busy && !rt.inputBusy && !rt.probing) {
      rt.probing = true;
      try {
        const ready = await this.untilClosed(rt, () => this.search.isReady(rt.handle!.page, row.source));
        if (ready && !rt.busy && !rt.controller.signal.aborted) await this.complete(rt.actor, id);
      } finally { rt.probing = false; }
    }
  }
  private async untilClosed<T>(rt: Runtime, work: () => Promise<T>): Promise<T> {
    if (rt.controller.signal.aborted) throw new Error("SESSION_CLOSED");
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error("SESSION_CLOSED")); rt.controller.signal.addEventListener("abort", abort, { once: true }); });
    try { return await Promise.race([work(), cancelled]); }
    finally { rt.controller.signal.removeEventListener("abort", abort); }
  }
  private async expireIfNeeded(row: InteractiveSession) {
    if (this.now() >= row.expiresAt.getTime() || this.now() - row.lastActivityAt.getTime() >= (this.options.idleMs ?? 10 * 60_000)) {
      await this.finish(row, "expired", this.now() >= row.expiresAt.getTime() ? "absolute_timeout" : "idle_timeout"); return true;
    }
    return false;
  }
  private limit(values: number[], maximum: number) {
    const now = this.now(); while (values.length && values[0]! <= now - 1000) values.shift();
    if (values.length >= maximum) throw new RateLimitError(); values.push(now);
  }
  async frame(actor: Actor, id: string, after?: number, signal?: AbortSignal) {
    const row = await this.owned(actor, id); const rt = this.running.get(id);
    if (isLive(row) && !rt) await this.finish(row, "failed", "process_lost");
    if (!isLive(row) || !rt || await this.expireIfNeeded(row) || !rt.handle) return { ...this.dto(await this.owned(actor, id)), frame: null };
    this.limit(rt.polls, 5);
    if (after !== undefined) {
      if (!Number.isSafeInteger(after) || after < 0) throw new ValidationError("Некорректный номер кадра");
      // Bounded long-poll: unchanged JPEGs are not retransmitted. Deadline uses a monotonic clock,
      // independent of the injected business clock used by deterministic lifecycle tests.
      const deadline = performance.now() + 5000;
      while ((rt.handle.frame()?.sequence ?? 0) <= after && performance.now() < deadline && !rt.controller.signal.aborted && !signal?.aborted) {
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, 100); signal?.addEventListener("abort", done, { once: true });
        });
      }
      if (rt.controller.signal.aborted || await this.expireIfNeeded(rt.session)) return { ...this.dto(await this.owned(actor, id)), frame: null };
    }
    const frame = signal?.aborted ? null : rt.handle.frame();
    return { status: row.status, continuing: rt.busy, frame: frame && (after === undefined || frame.sequence > after) ? frame : null };
  }
  async input(actor: Actor, id: string, raw: unknown) {
    const row = await this.owned(actor, id); const event = parseInput(inputEvent, raw); const rt = this.running.get(id);
    if (!isLive(row) || await this.expireIfNeeded(row) || !rt?.handle || rt.busy || rt.inputBusy) throw new ConflictError("SESSION_NOT_INTERACTIVE", "Сеанс завершён или занят продолжением поиска.");
    this.limit(rt.hits, 20); rt.inputBusy = true;
    try {
      row.lastActivityAt = new Date(this.now()); rt.session = row; await this.repo.save(row);
      await rt.handle.input(event); return { ok: true };
    } catch {
      await this.closeById(id, "failed", "input_failed"); throw new ConflictError("SESSION_INPUT_FAILED", "Не удалось передать действие. Сеанс закрыт.");
    } finally { rt.inputBusy = false; }
  }
  async complete(actor: Actor, id: string) {
    const row = await this.owned(actor, id), rt = this.running.get(id);
    if (!isLive(row)) return this.dto(row);
    if (await this.expireIfNeeded(row)) return this.get(actor, id);
    if (await this.search.isCancelled?.(row.searchRunId)) { await this.finish(row, "cancelled", "search_cancelled"); return this.get(actor, id); }
    if (!rt?.handle) throw new ConflictError("SESSION_NOT_READY", "Сеанс ещё открывается.");
    if (rt.busy || rt.inputBusy) throw new ConflictError("SESSION_BUSY", "Операция уже выполняется.");
    rt.busy = true;
    try {
      if (!await this.untilClosed(rt, () => this.search.isReady(rt.handle!.page, row.source))) {
        await this.finish(row, "failed", "challenge_remaining");
      } else {
        const result = await this.untilClosed(rt, () => this.search.resume({ actor, runId: row.searchRunId, source: row.source, parameters: rt.prepared.parameters,
          page: rt.handle!.page, context: rt.handle!.context, signal: rt.controller.signal }));
        if (!rt.controller.signal.aborted) await this.finish(row, result === "completed" ? "completed" : "failed", result === "completed" ? "search_resumed" : "blocked_again");
      }
    } catch {
      if (!rt.controller.signal.aborted) await this.finish(row, "failed", "continuation_failed");
    } finally { rt.busy = false; }
    return this.get(actor, id);
  }
  async cancel(actor: Actor, id: string) { const row = await this.owned(actor, id); await this.finish(row, "cancelled", "user_cancelled"); return this.get(actor, id); }
  async cancelRun(runId: string) {
    await Promise.all([...this.running.values()].filter(rt => rt.session.searchRunId === runId).map(rt => this.finish(rt.session, "cancelled", "search_cancelled")));
  }
  private async closeById(id: string, status: "failed" | "expired", reason: string) { const row = this.running.get(id)?.session ?? await this.repo.get(id); if (row) await this.finish(row, status, reason); }
  private finish(row: InteractiveSession, status: "completed" | "cancelled" | "expired" | "failed", reason: string): Promise<void> {
    const pending = this.closing.get(row.id); if (pending) return pending;
    // Fence continuation immediately. Concurrent readers await durable closure, not a transient process_lost state.
    const rt = this.running.get(row.id); rt?.controller.abort(); if (rt?.timer) clearTimeout(rt.timer);
    const operation = (async () => {
      // Close Chromium before database/audit I/O: a DB outage cannot extend the browser lifetime.
      let cleanupFailed = false;
      try { await rt?.handle?.close(); } catch { cleanupFailed = true; }
      const latest = await this.repo.get(row.id); if (!latest || !isLive(latest)) return;
      latest.status = status; latest.closeReason = reason; latest.completedAt = new Date(this.now());
      if (cleanupFailed) { latest.status = "failed"; latest.closeReason = "cleanup_failed"; }
      await this.repo.save(latest);
      await this.audit(latest, latest.status);
      if (latest.status !== "completed") {
        try { await this.search.blocked(latest.searchRunId, latest.source, latest.closeReason!); }
        catch { throw new InfrastructureError("Сеанс закрыт; не удалось обновить состояние источника. Обновите поиск."); }
      }
    })().finally(() => { this.running.delete(row.id); this.closing.delete(row.id); });
    this.closing.set(row.id, operation); return operation;
  }
  /** Deployment shutdown hook; no browser survives a graceful worker exit. */
  async shutdown() { await Promise.allSettled([...this.running.keys()].map(id => this.closeById(id, "failed", "process_stopped"))); }
}
