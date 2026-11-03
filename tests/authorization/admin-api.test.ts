import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiRequest, db, readBody, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";
import { GET as listUsers, POST as createUserRoute } from "@/app/api/v1/admin/users/route";
import { PATCH as patchUser } from "@/app/api/v1/admin/users/[id]/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { resetConfigCache } from "@/shared/config/env";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});
afterEach(() => {
  delete process.env.INSTANCE_ROLE;
  resetConfigCache();
});

describe("API: роли и административные функции (T01, T05)", () => {
  it("без сессии — 401", async () => {
    const res = await listUsers(apiRequest("GET", "/api/v1/admin/users"), routeParams({}));
    expect(res.status).toBe(401);
  });

  it("риелтор получает 403 на административный список и создание пользователя", async () => {
    const cookie = await sessionCookieFor(u.realtor1);
    expect((await listUsers(apiRequest("GET", "/api/v1/admin/users", { cookie }), routeParams({}))).status).toBe(403);
    const res = await createUserRoute(
      apiRequest("POST", "/api/v1/admin/users", { cookie, body: { login: "hacker", displayName: "X", roleCode: "manager" } }),
      routeParams({}),
    );
    expect(res.status).toBe(403);
    expect(await db.user.count({ where: { login: "hacker" } })).toBe(0);
  });

  it("риелтор не может повысить себя до руководителя прямым PATCH", async () => {
    const cookie = await sessionCookieFor(u.realtor1);
    const res = await patchUser(
      apiRequest("PATCH", `/api/v1/admin/users/${u.realtor1.userId}`, { cookie, body: { roleCode: "manager" } }),
      routeParams({ id: u.realtor1.userId }),
    );
    expect(res.status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.realtor1.userId } })).roleCode).toBe("realtor");
  });

  it("руководитель получает список пользователей без password_hash", async () => {
    const cookie = await sessionCookieFor(u.manager);
    const res = await listUsers(apiRequest("GET", "/api/v1/admin/users", { cookie }), routeParams({}));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await readBody(res));
    expect(text).toContain("t_realtor1");
    expect(text).not.toMatch(/passwordHash|argon2/);
  });

  it("CSRF: изменяющий запрос без Origin или с чужим Origin отклоняется", async () => {
    const cookie = await sessionCookieFor(u.manager);
    const body = { login: "csrf_user", displayName: "CSRF", roleCode: "realtor" };
    const noOrigin = await createUserRoute(apiRequest("POST", "/api/v1/admin/users", { cookie, body, origin: null }), routeParams({}));
    const evil = await createUserRoute(apiRequest("POST", "/api/v1/admin/users", { cookie, body, origin: "https://evil.example" }), routeParams({}));
    expect(noOrigin.status).toBe(403);
    expect(evil.status).toBe(403);
    expect(await db.user.count({ where: { login: "csrf_user" } })).toBe(0);
  });

  it("некорректный UUID в пути — 404 без обращения к БД", async () => {
    const cookie = await sessionCookieFor(u.manager);
    const res = await patchUser(apiRequest("PATCH", "/api/v1/admin/users/1 OR 1=1", { cookie, body: {} }), routeParams({ id: "1 OR 1=1" }));
    expect(res.status).toBe(404);
  });

  it("пользователь с временным паролем допускается только к смене пароля", async () => {
    await db.user.update({ where: { id: u.manager.userId }, data: { mustChangePassword: true } });
    const cookie = await sessionCookieFor(u.manager);
    const res = await listUsers(apiRequest("GET", "/api/v1/admin/users", { cookie }), routeParams({}));
    expect(res.status).toBe(403);
    expect((await readBody<{ error: { code: string } }>(res)).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await me(apiRequest("GET", "/api/v1/auth/me", { cookie }), routeParams({}))).status).toBe(200);
  });

  it("standby-экземпляр отклоняет изменяющие запросы", async () => {
    process.env.INSTANCE_ROLE = "standby";
    resetConfigCache();
    const cookie = await sessionCookieFor(u.manager);
    const res = await createUserRoute(
      apiRequest("POST", "/api/v1/admin/users", { cookie, body: { login: "standby_user", displayName: "S", roleCode: "realtor" } }),
      routeParams({}),
    );
    expect(res.status).toBe(503);
    expect((await readBody<{ error: { code: string } }>(res)).error.code).toBe("INSTANCE_READ_ONLY");
  });
});
