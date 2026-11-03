import { beforeEach, describe, expect, it } from "vitest";
import { db, makeClient, makeProperty, nextAction, NEED_PARAMS, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { createClient, updateClient } from "@/modules/clients/application/client-service";
import { registerRequest } from "@/modules/requests/application/request-service";
import { listRequests } from "@/modules/requests/application/request-queries";
import { ConflictError, DomainError, NotFoundError } from "@/shared/errors";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

const base = { occurredAt: new Date().toISOString(), channelCode: "phone", sourceCode: "avito", summary: "Ищет помещение" };

describe("T02 / UC-02: дубли клиентов без утечки сведений", () => {
  it("риелтор получает нейтральный конфликт при совпадении телефона с чужим клиентом", async () => {
    const { id } = await createClient(u.realtor1, { displayName: "Секретный Клиент", contacts: [{ contactType: "phone", value: "8 (912) 111-22-33" }] });
    const err = await createClient(u.realtor2, { displayName: "Новый", contacts: [{ contactType: "phone", value: "+7 912 111 22 33" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe("DUPLICATE_CONFLICT");
    const serialized = JSON.stringify(err.toJSON());
    expect(serialized).not.toContain(id);
    expect(serialized).not.toContain("Секретный");
    expect(serialized).not.toContain(u.realtor1.userId);
    expect(serialized).not.toContain("Риелтор Один");
    // auto-merge не выполняется, новый клиент не создан
    expect(await db.client.count()).toBe(1);
  });

  it("руководитель видит кандидата и может явно создать нового клиента без слияния", async () => {
    await createClient(u.realtor1, { displayName: "Иван", contacts: [{ contactType: "email", value: "Ivan@Example.ru" }] });
    const err = await createClient(u.manager, { displayName: "Иван 2", contacts: [{ contactType: "email", value: "ivan@example.ru" }] }).catch((e) => e);
    expect(err.code).toBe("PROBABLE_DUPLICATE");
    expect(err.details.candidates[0].displayName).toBe("Иван");
    await createClient(u.manager, { displayName: "Иван 2", contacts: [{ contactType: "email", value: "ivan@example.ru" }], confirmDuplicate: true });
    expect(await db.client.count()).toBe(2);
    expect(await db.auditLog.count({ where: { action: "client.created_despite_duplicate" } })).toBe(1);
  });

  it("совпадение с собственным клиентом риелтора — предупреждение с карточкой", async () => {
    await createClient(u.realtor1, { displayName: "Мой клиент", contacts: [{ contactType: "phone", value: "89120000001" }] });
    const err = await createClient(u.realtor1, { displayName: "Дубль", contacts: [{ contactType: "phone", value: "+79120000001" }] }).catch((e) => e);
    expect(err.code).toBe("PROBABLE_DUPLICATE");
    expect(err.details.candidates[0].displayName).toBe("Мой клиент");
  });

  it("optimistic concurrency: устаревшая версия формы отклоняется", async () => {
    const { id } = await makeClient(u.realtor1);
    const c = await db.client.findUniqueOrThrow({ where: { id } });
    await updateClient(u.realtor1, id, { expectedUpdatedAt: c.updatedAt.toISOString(), notes: "первое" });
    const err = await updateClient(u.realtor1, id, { expectedUpdatedAt: c.updatedAt.toISOString(), notes: "второе" }).catch((e) => e);
    expect(err.code).toBe("STALE_UPDATE");
    expect((await db.client.findUniqueOrThrow({ where: { id } })).notes).toBe("первое");
  });
});

describe("T02 / UC-01: регистрация обращения", () => {
  it("«чей объект, того и клиент»: новый клиент по объекту риелтора 2, зарегистрированный риелтором 1", async () => {
    const prop = await makeProperty(u.realtor2);
    const r = await registerRequest(u.realtor1, {
      ...base,
      propertyId: prop.id,
      client: { mode: "new", client: { displayName: "Арендатор", contacts: [{ contactType: "phone", value: "89125550001" }] } },
      outcome: { resultCode: "new_need", need: NEED_PARAMS, nextAction: nextAction() },
    });
    expect(r.responsibleUserId).toBe(u.realtor2.userId);
    expect(r.assignedToOther).toBe(true);
    const client = await db.client.findUniqueOrThrow({ where: { id: r.clientId! } });
    const need = await db.clientNeed.findUniqueOrThrow({ where: { id: r.needId! } });
    const lr = await db.leadRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect([client.responsibleUserId, need.responsibleUserId, lr.responsibleUserId]).toEqual([u.realtor2.userId, u.realtor2.userId, u.realtor2.userId]);
    expect(lr.createdBy).toBe(u.realtor1.userId);
    expect(lr.statusCode).toBe("processed");
    // Регистрирующий видит своё обращение, но не карточку чужого клиента.
    const list = await listRequests(u.realtor1, {});
    expect(list.items.map((i) => i.id)).toContain(r.requestId);
    expect(list.items.find((i) => i.id === r.requestId)?.clientVisible).toBe(false);
  });

  it("существующий клиент сохраняет ответственного; конфликт с ответственным объекта возвращается", async () => {
    const prop = await makeProperty(u.realtor2);
    const { id: clientId } = await makeClient(u.realtor1);
    const r = await registerRequest(u.realtor1, {
      ...base,
      propertyId: prop.id,
      client: { mode: "existing", clientId },
      outcome: { resultCode: "new_need", need: NEED_PARAMS, nextAction: nextAction() },
    });
    expect(r.responsibleUserId).toBe(u.realtor1.userId);
    expect(r.responsibleConflict).toEqual({ propertyResponsible: u.realtor2.userId, clientResponsible: u.realtor1.userId });
    expect((await db.client.findUniqueOrThrow({ where: { id: clientId } })).responsibleUserId).toBe(u.realtor1.userId);
  });

  it("обращение без дальнейшей потребности сохраняется", async () => {
    const r = await registerRequest(u.realtor1, { ...base, rawContact: "неизвестный номер", client: { mode: "none" }, outcome: { resultCode: "no_followup" } });
    const lr = await db.leadRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(lr.clientId).toBeNull();
    expect(lr.resultCode).toBe("no_followup");
    expect(lr.statusCode).toBe("closed");
  });

  it("новое обращение реактивирует inactive клиента, archived — не восстанавливается", async () => {
    const { id: c1 } = await makeClient(u.realtor1);
    await db.client.update({ where: { id: c1 }, data: { status: "inactive" } });
    const r = await registerRequest(u.realtor1, { ...base, client: { mode: "existing", clientId: c1 }, outcome: { resultCode: "one_off_service" } });
    expect(r.clientReactivated).toBe(true);
    expect((await db.client.findUniqueOrThrow({ where: { id: c1 } })).status).toBe("active");

    const { id: c2 } = await makeClient(u.realtor1);
    await db.client.update({ where: { id: c2 }, data: { status: "archived", archivedAt: new Date() } });
    await registerRequest(u.realtor1, { ...base, client: { mode: "existing", clientId: c2 }, outcome: { resultCode: "no_followup" } });
    expect((await db.client.findUniqueOrThrow({ where: { id: c2 } })).status).toBe("archived");
    const err = await registerRequest(u.realtor1, {
      ...base,
      client: { mode: "existing", clientId: c2 },
      outcome: { resultCode: "new_need", need: NEED_PARAMS, nextAction: nextAction() },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("CLIENT_ARCHIVED");
    // факт обращения всё равно сохранён (первое обращение) — и транзакция второго откатилась целиком
    expect(await db.leadRequest.count({ where: { clientId: c2 } })).toBe(1);
  });

  it("совпадение контакта с чужим клиентом: нейтральный конфликт, затем передача руководителю", async () => {
    await createClient(u.realtor1, { displayName: "Чужой", contacts: [{ contactType: "phone", value: "89127770000" }] });
    const input = {
      ...base,
      client: { mode: "new", client: { displayName: "Кто-то", contacts: [{ contactType: "phone", value: "8 912 777 00 00" }] } },
      outcome: { resultCode: "new_need", need: NEED_PARAMS, nextAction: nextAction() },
    };
    const err = await registerRequest(u.realtor2, input).catch((e) => e);
    expect(err.code).toBe("DUPLICATE_CONFLICT");
    const r = await registerRequest(u.realtor2, { ...input, escalateDuplicate: true });
    expect(r.escalated).toBe(true);
    expect(r.clientId).toBeNull();
    const task = await db.task.findUniqueOrThrow({ where: { id: r.taskId! } });
    expect(task.responsibleUserId).toBe(u.manager.userId);
    expect(task.description).not.toContain("Чужой");
    expect(await db.client.count()).toBe(1);
  });

  it("риелтор не может выбрать чужого существующего клиента по ID", async () => {
    const { id } = await makeClient(u.realtor1);
    await expect(registerRequest(u.realtor2, { ...base, client: { mode: "existing", clientId: id }, outcome: { resultCode: "no_followup" } })).rejects.toBeInstanceOf(NotFoundError);
  });
});
