import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

/**
 * Argon2id (NFR-09, ТЗ 17.4). Параметры — рекомендация OWASP:
 * m=19 MiB, t=2, p=1. Хэш в формате PHC содержит параметры и соль.
 */
// Algorithm — const enum в типах @node-rs/argon2; 2 = Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Хэш-заглушка: выравнивает время ответа при несуществующем логине. */
export function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

/** Временный пароль, выдаваемый руководителем при сбросе (буквы+цифры, 14 символов). */
export function generateTemporaryPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (let i = 0; i < 14; i++) {
    const pool = i % 4 === 3 ? digits : alphabet;
    out += pool[bytes[i]! % pool.length];
  }
  return out;
}
