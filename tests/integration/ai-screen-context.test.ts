import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, makeProperty, type TestUsers } from "../helpers/fixtures";
import { createChat, sendMessage, getChat } from "@/modules/ai-chat/application/chat-service";
import { assembleScreenContext } from "@/modules/ai-chat/application/screen-context";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";
import { resetConfigCache } from "@/shared/config/env";
import { seedAiTariffs } from "@/modules/ai/application/seed-ai";
let users: TestUsers;
beforeEach(async () => { vi.stubEnv("AI_ENABLED", "true"); resetConfigCache(); await resetDatabase(); users = await seedBase(); await db.aiSetting.create({ data: { aiEnabled: true } }); await seedAiTariffs(db); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigCache(); });
it("client and need include events, tasks, stages and showings but no forbidden personal data in provider payload", async () => {
  const c = await makeClient(users.realtor1, { displayName: "SecretIdentity", notes: "password=secretCredential; паспорт 1234 567890" });
  const n = await makeNeed(users.realtor1, c.id, { budgetMax: "50000000" });
  const p = await makeProperty(users.realtor2);
  await db.propertyOwner.create({ data: { propertyId: p.id, clientId: c.id } });
  await db.communication.create({ data: { clientId: c.id, clientNeedId: n.id, authorUserId: users.realtor1.userId, communicationType: "call", occurredAt: new Date(), resultCode: "followup_required", comment: "паспорт 1234 567890; token=secretToken; owner@example.com" } });
  await db.showing.create({ data: { clientNeedId: n.id, propertyId: p.id, responsibleUserId: users.realtor1.userId, scheduledAt: new Date(), status: "planned", createdBy: users.realtor1.userId, participantsText: "secretOwnerContact" } });
  for (const kind of ["client", "need"] as const) {
    const session = await createChat(users.realtor1, { context: { kind, id: kind === "client" ? c.id : n.id } });
    const fake = new FakeResponsesProvider(() => ({ text: "Уточните условия, затем согласуйте следующий контакт." }));
    const before = await db.task.count();
    await sendMessage(users.realtor1, session.id, { text: "Какое следующее действие?" }, fake);
    const payload = JSON.stringify(fake.requests);
    expect(payload).toContain("50000000");
    expect(payload).toContain('communications'); expect(payload).toContain('stages'); expect(payload).toContain('showings'); expect(payload).toContain(n.id);
    expect(payload).not.toMatch(/SecretIdentity|secretCredential|1234 567890|secretToken|owner@example|secretOwnerContact|passwordHash|normalizedValue/);
    expect(await db.task.count()).toBe(before);
    expect(fake.requests).toHaveLength(1);
  }
});
it("Today is bounded to my safe open tasks and includes totals and priority", async () => {
  const c = await makeClient(users.realtor1); await makeNeed(users.realtor1, c.id);
  const other = await makeClient(users.realtor2); const n = await makeNeed(users.realtor2, other.id);
  const foreignTask = await db.task.findFirstOrThrow({ where: { needLinks: { some: { clientNeedId: n.id } } } });
  const r = await assembleScreenContext(users.realtor1, { kind: "today" });
  expect(r.data).toMatchObject({ scope: "my", openTaskCount: 1, tasks: [expect.objectContaining({ priority: expect.any(String) })] });
  expect(JSON.stringify(r)).not.toContain(foreignTask.id);
});
it("task links, deal parties/checklist and agreement dates are available without identities", async () => {
  const c = await makeClient(users.realtor1); const n = await makeNeed(users.realtor1, c.id); const p = await makeProperty(users.realtor1);
  const task = await db.task.findFirstOrThrow({ where: { needLinks: { some: { clientNeedId: n.id } } } });
  expect((await assembleScreenContext(users.realtor1, { kind: "task", id: task.id })).links).toContainEqual(expect.objectContaining({ href: `/needs/${n.id}` }));
  const deal = await db.deal.create({ data: { propertyId: p.id, legalEntityId: users.llcId, responsibleUserId: users.realtor1.userId, createdBy: users.realtor1.userId, status: "draft", parties: { create: { clientId: c.id, partyRole: "buyer" } }, checklistItems: { create: { code: "documents", title: "SecretTitle", responsibleUserId: users.realtor1.userId } } } });
  await expect(assembleScreenContext(users.manager, { kind: "deal", id: deal.id })).resolves.toHaveProperty("data");
  const d = await assembleScreenContext(users.realtor1, { kind: "deal", id: deal.id });
  expect(d.data).toMatchObject({ deal: { parties: [{ clientId: c.id, partyRole: "buyer" }], checklistItems: [{ code: "documents", label: "Проверка по сделке", statusLabel: "Нет" }] } });
  expect(JSON.stringify(d)).not.toContain("SecretTitle");
  const agreement = await db.agreement.create({ data: { clientId: c.id, dealId: deal.id, responsibleUserId: users.realtor1.userId, agreementType: "information", status: "draft", validUntil: new Date("2026-12-01"), notes: "secretNotes" } });
  await expect(assembleScreenContext(users.manager, { kind: "agreement", id: agreement.id })).resolves.toHaveProperty("data");
  expect((await assembleScreenContext(users.realtor1, { kind: "agreement", id: agreement.id })).data).toMatchObject({ agreement: { validUntil: new Date("2026-12-01") } });
  expect(JSON.stringify(await assembleScreenContext(users.realtor1, { kind: "agreement", id: agreement.id }))).not.toContain("secretNotes");
});
it("reports use existing calculated metrics and no primary identities", async () => {
  const r = await assembleScreenContext(users.manager, { kind: "reports" });
  expect(r.data).toMatchObject({ metrics: expect.arrayContaining([expect.objectContaining({ key: "overdue", value: 0 })]), period: { timeZone: "Asia/Novosibirsk" } });
});
it("foreign tasks, deals, linked agreements and report context are refused before a provider call", async () => {
  const c = await makeClient(users.realtor2); const n = await makeNeed(users.realtor2, c.id); const p = await makeProperty(users.realtor2);
  const task = await db.task.findFirstOrThrow({ where: { needLinks: { some: { clientNeedId: n.id } } } });
  // Even an own deal/contract cannot leak its foreign client through the assistant.
  const deal = await db.deal.create({ data: { propertyId: p.id, legalEntityId: users.llcId, responsibleUserId: users.realtor1.userId, createdBy: users.realtor1.userId, status: "draft", parties: { create: { clientId: c.id, partyRole: "seller" } } } });
  const agreement = await db.agreement.create({ data: { clientId: c.id, dealId: deal.id, responsibleUserId: users.realtor1.userId, agreementType: "information", status: "draft" } });
  for (const context of [{ kind: "task", id: task.id }, { kind: "deal", id: deal.id }, { kind: "agreement", id: agreement.id }, { kind: "reports" }]) {
    await expect(createChat(users.realtor1, { context })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  expect(await db.aiUsageLog.count()).toBe(0);
});
it("task transfer revokes existing chat before dispatch and read", async () => {
  const c = await makeClient(users.realtor1); const n = await makeNeed(users.realtor1, c.id);
  const task = await db.task.findFirstOrThrow({ where: { needLinks: { some: { clientNeedId: n.id } } } });
  const s = await createChat(users.realtor1, { context: { kind: "task", id: task.id } });
  await db.client.update({ where: { id: c.id }, data: { responsibleUserId: users.realtor2.userId } });
  const fake = new FakeResponsesProvider();
  await expect(sendMessage(users.realtor1, s.id, { text: "следующее действие" }, fake)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getChat(users.realtor1, s.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(fake.requests).toHaveLength(0);
});

it("task free text is sanitized before provider dispatch while retaining its meaning", async () => {
 const c=await makeClient(users.realtor1,{displayName:"редкоефио тестличность"}); const n=await makeNeed(users.realtor1,c.id);
 const task=await db.task.findFirstOrThrow({where:{needLinks:{some:{clientNeedId:n.id}}}});
 await db.task.update({where:{id:task.id},data:{title:"уточнить условия редкоефио тестличность",description:"проверить срок; паспорт 1234 567890; password=secretCredential; token=secretToken; +7 900 123-45-67; owner@example.com"}});
 const s=await createChat(users.realtor1,{context:{kind:"task",id:task.id}});
 const fake=new FakeResponsesProvider(()=>({text:"Уточните условия перед следующим контактом."}));
 await sendMessage(users.realtor1,s.id,{text:"что проверить?"},fake);
 const payload=JSON.stringify(fake.requests);
 expect(payload).toContain("уточнить условия");
 expect(payload).not.toMatch(/редкоефио|тестличность|1234 567890|secretCredential|secretToken|900 123|owner@example/);
});
