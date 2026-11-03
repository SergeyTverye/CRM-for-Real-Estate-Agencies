import { db, type DbOrTx } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { generateSessionToken, hashSessionToken } from "../infrastructure/session-token";
import type { Actor, Role } from "../domain/actor";

/**
 * Серверные отзывные сессии (ТЗ 12, 17.4, 29.2): сырой токен — только в HttpOnly cookie,
 * в БД — SHA-256. Деактивация пользователя и смена пароля отзывают активные сессии.
 */

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export async function createSession(tx: DbOrTx, userId: string, meta: SessionMeta): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const ttlMs = getConfig().SESSION_TTL_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await tx.userSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 200) : null,
      ipAddress: meta.ip ? meta.ip.slice(0, 64) : null,
    },
  });
  return { token, expiresAt };
}

/** Проверяет токен из cookie; возвращает Actor или null (истёк/отозван/пользователь деактивирован). */
export async function resolveSession(token: string | null | undefined): Promise<Actor | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const now = new Date();
  const session = await db.userSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { id: true, login: true, displayName: true, roleCode: true, isActive: true, mustChangePassword: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await db.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => undefined);
  }
  return {
    userId: session.user.id,
    login: session.user.login,
    displayName: session.user.displayName,
    role: session.user.roleCode as Role,
    mustChangePassword: session.user.mustChangePassword,
    sessionId: session.id,
  };
}

export async function revokeSession(tx: DbOrTx, sessionId: string): Promise<void> {
  await tx.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllUserSessions(tx: DbOrTx, userId: string, exceptSessionId?: string): Promise<number> {
  const res = await tx.userSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return res.count;
}
