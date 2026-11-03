import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getDb } from "@/shared/db/client";
import { hashPassword } from "@/modules/auth/infrastructure/password-hasher";
import { createSession } from "@/modules/auth/application/session-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";
import { DICTIONARY_SEED } from "@/modules/dictionaries/domain/dictionary-data";
import type { Actor } from "@/modules/auth/domain/actor";
import { getLoginRateLimiter } from "@/modules/auth/application/auth-service";

export const db = getDb();

/** Очищает все таблицы тестовой БД (кроме истории миграций). */
export async function resetDatabase(): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length) {
    await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  getLoginRateLimiter().reset();
}

export const TEST_PASSWORD = "TestPassw0rd!";

export interface TestUsers {
  manager: Actor;
  realtor1: Actor;
  realtor2: Actor;
  llcId: string;
  ipId: string;
}

let passwordHashCache: string | null = null;

async function makeUser(login: string, displayName: string, roleCode: "manager" | "realtor"): Promise<Actor> {
  passwordHashCache ??= await hashPassword(TEST_PASSWORD);
  const u = await db.user.create({ data: { login, displayName, roleCode, passwordHash: passwordHashCache } });
  return { userId: u.id, login, displayName, role: roleCode, mustChangePassword: false, sessionId: randomUUID() };
}

/** Базовый синтетический набор: справочники, ИП/ООО, руководитель и два риелтора. */
export async function seedBase(): Promise<TestUsers> {
  for (const [category, items] of Object.entries(DICTIONARY_SEED)) {
    await db.dictionaryItem.createMany({ data: items.map(([code, displayName], i) => ({ category, code, displayName, sortOrder: i })) });
  }
  const llc = await db.legalEntity.create({ data: { entityType: "LLC", displayName: "ООО «Тест»" } });
  const ip = await db.legalEntity.create({ data: { entityType: "IP", displayName: "ИП Тестовый" } });
  return {
    manager: await makeUser("t_manager", "Руководитель Тест", "manager"),
    realtor1: await makeUser("t_realtor1", "Риелтор Один", "realtor"),
    realtor2: await makeUser("t_realtor2", "Риелтор Два", "realtor"),
    llcId: llc.id,
    ipId: ip.id,
  };
}

/** Реальная сессия для API-тестов: возвращает значение cookie. */
export async function sessionCookieFor(actor: Actor): Promise<string> {
  const { token } = await createSession(db, actor.userId, { ip: "127.0.0.1", userAgent: "vitest" });
  return `${SESSION_COOKIE}=${token}`;
}

export const ORIGIN = "http://crm.test";

/** Запрос к route handler так, как его отправил бы браузер с того же origin. */
export function apiRequest(method: string, pathAndQuery: string, opts: { cookie?: string; body?: unknown; origin?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = { host: "crm.test" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null && method !== "GET") headers.origin = opts.origin ?? ORIGIN;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${ORIGIN}${pathAndQuery}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export function routeParams<P extends Record<string, string>>(params: P) {
  return { params: Promise.resolve(params) };
}

export async function readBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
