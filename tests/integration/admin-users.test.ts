import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { createUser, resetUserPassword, updateUser } from "@/modules/users/application/users-service";
import { login } from "@/modules/auth/application/auth-service";
import { DomainError, ForbiddenError, ValidationError } from "@/shared/errors";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

describe("I1: администрирование учётных записей (UC-13, FR-29)", () => {
  it("руководитель создаёт пользователя с временным паролем и обязательной сменой", async () => {
    const { user, temporaryPassword } = await createUser(u.manager, { login: "New.Agent", displayName: "Новый риелтор", roleCode: "realtor" });
    expect(user.login).toBe("new.agent");
    expect(user.mustChangePassword).toBe(true);
    const r = await login("new.agent", temporaryPassword, { ip: null }, { delay: false });
    expect(r.mustChangePassword).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.created", entityId: user.id } });
    expect(JSON.stringify(audit)).not.toMatch(/password|argon/i);
  });

  it("риелтор не может создавать пользователей (сервер)", async () => {
    await expect(createUser(u.realtor1, { login: "x_user", displayName: "X", roleCode: "manager" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("логин уникален без учёта регистра", async () => {
    await expect(createUser(u.manager, { login: "T_REALTOR1", displayName: "Дубль", roleCode: "realtor" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("изменение роли фиксируется в AuditLog", async () => {
    await updateUser(u.manager, u.realtor1.userId, { roleCode: "manager" });
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "user.role_changed", entityId: u.realtor1.userId } });
    expect(a.beforeJsonb).toEqual({ roleCode: "realtor" });
    expect(a.afterJsonb).toEqual({ roleCode: "manager" });
    expect(a.actorUserId).toBe(u.manager.userId);
  });

  it("нельзя деактивировать последнего руководителя", async () => {
    await expect(updateUser(u.manager, u.manager.userId, { isActive: false })).rejects.toBeInstanceOf(DomainError);
  });

  it("сброс пароля выдаёт временный пароль, отзывает сессии и требует смену", async () => {
    const s = await login(u.realtor2.login, "TestPassw0rd!", { ip: null }, { delay: false });
    const { temporaryPassword } = await resetUserPassword(u.manager, u.realtor2.userId);
    expect(await db.userSession.count({ where: { userId: u.realtor2.userId, revokedAt: null } })).toBe(0);
    void s;
    const r = await login(u.realtor2.login, temporaryPassword, { ip: null }, { delay: false });
    expect(r.mustChangePassword).toBe(true);
  });

  it("восстановление деактивированной учётной записи", async () => {
    await updateUser(u.manager, u.realtor1.userId, { isActive: false });
    await updateUser(u.manager, u.realtor1.userId, { isActive: true });
    await expect(login(u.realtor1.login, "TestPassw0rd!", { ip: null }, { delay: false })).resolves.toBeTruthy();
    expect(await db.auditLog.count({ where: { entityId: u.realtor1.userId, action: { in: ["user.deactivated", "user.activated"] } } })).toBe(2);
  });
});
