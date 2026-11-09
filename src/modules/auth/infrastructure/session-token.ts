import { createHash, randomBytes } from "node:crypto";


export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const SESSION_COOKIE = "crm_session";
