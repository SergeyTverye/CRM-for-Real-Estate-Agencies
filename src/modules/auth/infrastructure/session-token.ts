import { createHash, randomBytes } from "node:crypto";

/** Криптографически случайный токен сессии; в БД хранится только SHA-256 (ТЗ 29.2). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const SESSION_COOKIE = "crm_session";
