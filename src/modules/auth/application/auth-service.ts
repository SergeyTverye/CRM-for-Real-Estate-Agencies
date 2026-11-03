import { db, transaction } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { logger } from "@/shared/logging/logger";
import { InvalidCredentialsError, RateLimitError, ValidationError } from "@/shared/errors";
import { writeAudit } from "@/modules/audit/application/audit";
import { hashPassword, verifyPassword, getDummyHash } from "../infrastructure/password-hasher";
import { LoginRateLimiter } from "../infrastructure/login-rate-limiter";
import { normalizeLogin, passwordPolicyErrors } from "../domain/password-policy";
import { createSession, revokeAllUserSessions, revokeSession, type SessionMeta } from "./session-service";
import type { Actor } from "../domain/actor";

const INVALID_CREDENTIALS = "Неверный логин или пароль";

let limiter: LoginRateLimiter | null = null;
export function getLoginRateLimiter(): LoginRateLimiter {
  if (!limiter) {
    const cfg = getConfig();
    limiter = new LoginRateLimiter(cfg.LOGIN_MAX_FAILURES, cfg.LOGIN_LOCK_MINUTES * 60_000);
  }
  return limiter;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LoginResult {
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
  userId: string;
}

/**
 * UC: вход по логину/паролю. Ответ одинаков для несуществующего логина,
 * неверного пароля и деактивированного пользователя (не раскрывает существование логина).
 */
export async function login(rawLogin: string, password: string, meta: SessionMeta, opts: { delay?: boolean } = {}): Promise<LoginResult> {
  const loginNorm = normalizeLogin(rawLogin ?? "");
  if (!loginNorm || !password) throw new ValidationError("Введите логин и пароль", { login: loginNorm ? [] : ["Обязательное поле"] });
  const rl = getLoginRateLimiter();
  const ip = meta.ip ?? null;
  if (rl.isLocked(loginNorm, ip)) {
    logger.warn({ event: "auth.login_locked" }, "login temporarily locked");
    throw new RateLimitError();
  }

  const user = await db.user.findUnique({ where: { login: loginNorm } });
  const ok = user ? await verifyPassword(user.passwordHash, password) : (await verifyPassword(await getDummyHash(), password), false);

  if (!user || !ok || !user.isActive) {
    rl.recordFailure(loginNorm, ip);
    logger.warn({ event: "auth.login_failed", reason: !user ? "unknown_login" : !ok ? "bad_password" : "inactive" }, "login failed");
    if (opts.delay !== false) await sleep(rl.delayFor(loginNorm, ip));
    throw new InvalidCredentialsError(INVALID_CREDENTIALS);
  }

  rl.recordSuccess(loginNorm, ip);
  const session = await createSession(db, user.id, meta);
  logger.info({ event: "auth.login", userId: user.id }, "login succeeded");
  return { ...session, mustChangePassword: user.mustChangePassword, userId: user.id };
}

export async function logout(actor: Actor): Promise<void> {
  await revokeSession(db, actor.sessionId);
  logger.info({ event: "auth.logout", userId: actor.userId }, "logout");
}

/** Смена пароля пользователем (в т.ч. обязательная после выдачи временного). Остальные сессии отзываются. */
export async function changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword ?? ""))) {
    throw new ValidationError("Текущий пароль указан неверно", { currentPassword: ["Неверный пароль"] });
  }
  const errors = passwordPolicyErrors(newPassword ?? "", user.login);
  if (currentPassword === newPassword) errors.push("Новый пароль должен отличаться от текущего");
  if (errors.length) throw new ValidationError("Пароль не соответствует требованиям", { newPassword: errors });
  const passwordHash = await hashPassword(newPassword);
  await transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });
    await revokeAllUserSessions(tx, user.id, actor.sessionId);
    await writeAudit(tx, { action: "user.password_changed", entityType: "User", entityId: user.id, actorUserId: actor.userId });
  });
}
