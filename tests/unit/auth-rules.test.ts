import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "@/modules/auth/infrastructure/login-rate-limiter";
import { passwordPolicyErrors, normalizeLogin } from "@/modules/auth/domain/password-policy";
import { hashSessionToken, generateSessionToken } from "@/modules/auth/infrastructure/session-token";
import { hashPassword, verifyPassword } from "@/modules/auth/infrastructure/password-hasher";

describe("пароли и токены", () => {
  it("Argon2id: хэш в формате PHC, проверка", async () => {
    const h = await hashPassword("Secret12345");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "Secret12345")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });
  it("токен сессии случайный, в БД — только SHA-256", () => {
    const t = generateSessionToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(hashSessionToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(t)).not.toContain(t);
  });
  it("политика паролей", () => {
    expect(passwordPolicyErrors("short1", "x")).not.toHaveLength(0);
    expect(passwordPolicyErrors("onlyletterslong", "x")).not.toHaveLength(0);
    expect(passwordPolicyErrors("Ivanov12345", "ivanov")).toContain("Не должен содержать логин");
    expect(passwordPolicyErrors("Good1Password", "user")).toHaveLength(0);
    expect(normalizeLogin("  Manager ")).toBe("manager");
  });
});

describe("защита входа от перебора", () => {
  it("блокирует после N неудач и разблокирует после успешного входа", () => {
    const rl = new LoginRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) rl.recordFailure("u", "1.1.1.1", 1000 + i);
    expect(rl.isLocked("u", "1.1.1.1", 2000)).toBe(true);
    expect(rl.isLocked("u", "2.2.2.2", 2000)).toBe(false);
    expect(rl.isLocked("u", "1.1.1.1", 1000 + 61_000 + 10)).toBe(false);
    rl.recordSuccess("u", "1.1.1.1");
    expect(rl.isLocked("u", "1.1.1.1", 2000)).toBe(false);
  });
  it("задержка растёт с числом неудач", () => {
    const rl = new LoginRateLimiter(10, 60_000);
    rl.recordFailure("a", null);
    const d1 = rl.delayFor("a", null);
    rl.recordFailure("a", null);
    rl.recordFailure("a", null);
    expect(rl.delayFor("a", null)).toBeGreaterThan(d1);
  });
});
