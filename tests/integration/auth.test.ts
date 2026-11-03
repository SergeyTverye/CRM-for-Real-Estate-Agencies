import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedBase, TEST_PASSWORD, type TestUsers } from "../helpers/fixtures";
import { login, logout, changeOwnPassword } from "@/modules/auth/application/auth-service";
import { resolveSession } from "@/modules/auth/application/session-service";
import { hashSessionToken } from "@/modules/auth/infrastructure/session-token";
import { updateUser } from "@/modules/users/application/users-service";
import { AuthenticationError, RateLimitError } from "@/shared/errors";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

const meta = { ip: "10.0.0.1", userAgent: "vitest" };

describe("I1: аутентификация и сессии (T01)", () => {
  it("руководитель и два риелтора входят под индивидуальными учётными записями, роли различаются", async () => {
    for (const a of [u.manager, u.realtor1, u.realtor2]) {
      const r = await login(a.login, TEST_PASSWORD, meta, { delay: false });
      const actor = await resolveSession(r.token);
      expect(actor?.userId).toBe(a.userId);
      expect(actor?.role).toBe(a.role);
    }
  });

  it("в БД хранится только hash токена, не сам токен", async () => {
    const r = await login(u.realtor1.login, TEST_PASSWORD, meta, { delay: false });
    const rows = await db.userSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashSessionToken(r.token));
    expect(JSON.stringify(rows)).not.toContain(r.token);
  });

  it("одинаковый ответ для неверного пароля и несуществующего логина", async () => {
    const e1 = await login(u.realtor1.login, "wrong-password1", meta, { delay: false }).catch((e) => e);
    const e2 = await login("no_such_user", "wrong-password1", meta, { delay: false }).catch((e) => e);
    expect(e1).toBeInstanceOf(AuthenticationError);
    expect(e2).toBeInstanceOf(AuthenticationError);
    expect(e1.message).toBe(e2.message);
  });

  it("деактивированная учётная запись не может создать новую сессию, активные сессии отзываются", async () => {
    const r = await login(u.realtor2.login, TEST_PASSWORD, meta, { delay: false });
    await updateUser(u.manager, u.realtor2.userId, { isActive: false });
    expect(await resolveSession(r.token)).toBeNull();
    await expect(login(u.realtor2.login, TEST_PASSWORD, meta, { delay: false })).rejects.toBeInstanceOf(AuthenticationError);
    // История не разрушена: пользователь существует, запись аудита есть.
    expect(await db.user.findUnique({ where: { id: u.realtor2.userId } })).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "user.deactivated", entityId: u.realtor2.userId } })).toBe(1);
  });

  it("logout инвалидирует сессию", async () => {
    const r = await login(u.manager.login, TEST_PASSWORD, meta, { delay: false });
    const actor = (await resolveSession(r.token))!;
    await logout(actor);
    expect(await resolveSession(r.token)).toBeNull();
  });

  it("смена пароля отзывает остальные сессии и снимает флаг обязательной смены", async () => {
    await db.user.update({ where: { id: u.realtor1.userId }, data: { mustChangePassword: true } });
    const s1 = await login(u.realtor1.login, TEST_PASSWORD, meta, { delay: false });
    const s2 = await login(u.realtor1.login, TEST_PASSWORD, meta, { delay: false });
    expect(s1.mustChangePassword).toBe(true);
    const actor = (await resolveSession(s1.token))!;
    await changeOwnPassword(actor, TEST_PASSWORD, "NewSecret2026x");
    expect(await resolveSession(s1.token)).not.toBeNull();
    expect(await resolveSession(s2.token)).toBeNull();
    const user = await db.user.findUniqueOrThrow({ where: { id: u.realtor1.userId } });
    expect(user.mustChangePassword).toBe(false);
    await expect(login(u.realtor1.login, "NewSecret2026x", meta, { delay: false })).resolves.toBeTruthy();
  });

  it("перебор пароля приводит к временной блокировке без раскрытия логина", async () => {
    for (let i = 0; i < 5; i++) await login(u.realtor1.login, `bad-pass-${i}x`, meta, { delay: false }).catch(() => undefined);
    await expect(login(u.realtor1.login, TEST_PASSWORD, meta, { delay: false })).rejects.toBeInstanceOf(RateLimitError);
    for (let i = 0; i < 5; i++) await login("ghost_login", `bad-pass-${i}x`, meta, { delay: false }).catch(() => undefined);
    await expect(login("ghost_login", "whatever1x", meta, { delay: false })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("истёкшая сессия недействительна", async () => {
    const r = await login(u.manager.login, TEST_PASSWORD, meta, { delay: false });
    await db.userSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveSession(r.token)).toBeNull();
  });
});
