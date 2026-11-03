import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Контекст запроса: correlation id и текущий пользователь (для логов и AuditLog). */
export interface RequestContext {
  correlationId: string;
  actorUserId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function setContextActor(userId: string): void {
  const store = storage.getStore();
  if (store) store.actorUserId = userId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Берёт X-Request-Id, если он корректный UUID, иначе генерирует новый. */
export function correlationIdFrom(headerValue: string | null | undefined): string {
  return headerValue && UUID_RE.test(headerValue) ? headerValue.toLowerCase() : randomUUID();
}
