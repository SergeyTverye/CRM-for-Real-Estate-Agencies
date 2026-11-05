import { z } from "zod";
import type { Actor } from "@/modules/auth/domain/actor";
import type { BrowserContext, Page } from "playwright-core";

export const sessionSources = ["cian", "avito", "domclick", "yandex", "mirkvartir", "onrealt", "youla"] as const;
export const createSessionInput = z.object({ searchRunId: z.uuid(), source: z.enum(sessionSources) }).strict();
export type SessionSource = typeof sessionSources[number];
export type SessionStatus = "pending" | "active" | "completed" | "cancelled" | "expired" | "failed";
export interface InteractiveSession {
  id: string; searchRunId: string; source: SessionSource; ownerUserId: string; status: SessionStatus;
  startUrlHost: string; createdAt: Date; expiresAt: Date; completedAt: Date | null; lastActivityAt: Date; closeReason: string | null;
}
export const isLive = (s: InteractiveSession) => s.status === "pending" || s.status === "active";
export interface SessionRepository {
  /** Atomically claims (owner, source), including across processes. */
  claim(session: InteractiveSession): Promise<boolean>;
  get(id: string): Promise<InteractiveSession | null>;
  active(ownerUserId: string, source: SessionSource): Promise<InteractiveSession | null>;
  save(session: InteractiveSession): Promise<void>;
}
export const inputEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number().int().min(0).max(1279), y: z.number().int().min(0).max(799) }).strict(),
  z.object({ type: z.literal("scroll"), x: z.number().int().min(0).max(1279), y: z.number().int().min(0).max(799), deltaY: z.number().int().min(-1600).max(1600) }).strict(),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(128).refine(v => !/[\x00-\x1f\x7f]/u.test(v)) }).strict(),
  z.object({ type: z.literal("key"), key: z.enum(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Space"]) }).strict(),
]);
export type SessionInput = z.infer<typeof inputEvent>;
export interface SessionFrame { sequence: number; jpeg: string; width: number; height: number }
export interface BrowserHandle {
  page: Page; context: BrowserContext;
  frame(): SessionFrame | null;
  input(event: SessionInput): Promise<void>;
  close(): Promise<void>;
}
export interface BrowserFactory {
  open(startUrl: string, source: SessionSource, signal: AbortSignal, onViolation: () => void): Promise<BrowserHandle>;
}
export interface PreparedSearch {
  /** Server-side adapter resolves this URL; it is never accepted from an HTTP request or returned to the UI. */
  startUrl: string;
  parameters: unknown;
}
export interface SearchContinuationPort {
  /** Must authorize run + linked need, require needs_user_action, and verify the source access agreement. */
  prepare(actor: Actor, runId: string, source: SessionSource): Promise<PreparedSearch>;
  /** Positive detection of results by the source adapter, never a generic absence-of-CAPTCHA heuristic. */
  isReady(page: Page, source: SessionSource): Promise<boolean>;
  /** Same context, no new browser. Must validate all candidates and check signal before committing results. */
  resume(input: { actor: Actor; runId: string; source: SessionSource; parameters: unknown; page: Page; context: BrowserContext; signal: AbortSignal }): Promise<"completed" | "blocked">;
  /** Preserve prior snapshots. Store only a fixed reason code, no URL/cookies/exception text. */
  blocked(runId: string, source: SessionSource, reason: string): Promise<void>;
}
export type SessionAudit = (session: InteractiveSession, event: "created" | "opened" | "completed" | "cancelled" | "expired" | "failed") => Promise<void>;
