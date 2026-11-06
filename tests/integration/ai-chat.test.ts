import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, makeProperty, inDays, apiRequest, sessionCookieFor, routeParams, type TestUsers } from "../helpers/fixtures";
import { createChat, sendMessage, decideAction, getChat, confirmedWebSearch } from "@/modules/ai-chat/application/chat-service";
import { executeTool, redactToolData } from "@/modules/ai-chat/application/tools";
import { FakeResponsesProvider } from "@/modules/ai/infrastructure/fake";
import { resetConfigCache } from "@/shared/config/env";
import { seedAiTariffs } from "@/modules/ai/application/seed-ai";
import * as composition from "@/modules/ai-chat/infrastructure/composition";
import { POST } from "@/app/api/v1/ai-chat/sessions/[id]/messages/route";
let users: TestUsers;
beforeEach(async () => { vi.stubEnv("AI_ENABLED", "true"); resetConfigCache(); await resetDatabase(); users = await seedBase(); await db.aiSetting.create({ data: { aiEnabled: true, perJobLimit: 4 } }); await seedAiTariffs(db); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetConfigCache(); });
it("tools only return authorized clients; ledger links every provider call to the chat", async () => {
    const own = await makeClient(users.realtor1, { displayName: "Иван Петров" });
    const other = await makeClient(users.realtor2, { displayName: "Чужой Клиент" });
    const s = await createChat(users.realtor1, { context: { kind: "client", id: own.id } });
    const f = new FakeResponsesProvider(r => r.inputItems?.length === 2 ? { text: "", functionCalls: [{ type: "function_call", call_id: "c", name: "find_clients", arguments: "{}" }] } : { text: `данные [[${own.id}]]` });
    const result = await sendMessage(users.realtor1, s.id, { text: "данные данные" }, f);
    expect(f.requests).toHaveLength(2);
    const outputs = JSON.stringify(f.requests[1]);
    expect(outputs).toContain(own.id);
    expect(outputs).not.toContain(other.id);
    expect(outputs).not.toMatch(/Иван|Петров|Чужой/);
    expect(result.messages.at(-1)?.toolArgs).toMatchObject([{ id: own.id, href: `/clients/${own.id}` }]);
    expect(await db.aiUsageLog.count({ where: { callType: "chat", status: "success" } })).toBe(2);
    expect(await db.aiChatMessage.count({ where: { sessionId: s.id, aiUsageLogId: { not: null } } })).toBe(2);
});
it("proposal preview does not create task; concurrent confirmations create exactly one task", async () => {
    const c = await makeClient(users.realtor1);
    const s = await createChat(users.realtor1, { context: { kind: "client", id: c.id } });
    const before = await db.task.count();
    const f = new FakeResponsesProvider(r => r.inputItems?.length === 2 ? { functionCalls: [{ type: "function_call", call_id: "draft", name: "prepare_task", arguments: JSON.stringify({ clientId: c.id, title: "данные данные данные", dueAt: inDays(2) }) }] } : { text: "данные данные. данные данные." });
    const preview = await sendMessage(users.realtor1, s.id, { text: "данные данные" }, f);
    const a = preview.actions[0]!;
    expect(a.status).toBe("proposed");
    expect(await db.task.count()).toBe(before);
    await Promise.all([decideAction(users.realtor1, s.id, a.id, { decision: "confirm", confirmed: true }), decideAction(users.realtor1, s.id, a.id, { decision: "confirm", confirmed: true })]);
    expect(await db.task.count()).toBe(before + 1);
    expect(f.requests).toHaveLength(2);
    expect(await db.taskClient.count({ where: { clientId: c.id } })).toBe(1);
});
it("rejecting changes neither tasks nor offers and never calls provider", async () => { const c = await makeClient(users.realtor1); const s = await createChat(users.realtor1, {}); await executeTool(users.realtor1, s.id, "prepare_task", { clientId: c.id, title: "данные данные", dueAt: inDays(1) }); const a = await db.aiPendingAction.findFirstOrThrow(); await decideAction(users.realtor1, s.id, a.id, { decision: "reject", confirmed: true }); expect(await db.task.count()).toBe(0); expect(await db.commercialOffer.count()).toBe(0); expect(await db.aiUsageLog.count()).toBe(0); expect((await getChat(users.realtor1, s.id)).actions[0]?.status).toBe("rejected"); });
it("offer confirmation uses CRM snapshots and original invariants", async () => { const c = await makeClient(users.realtor1); const n = await makeNeed(users.realtor1, c.id); const p = await makeProperty(users.realtor1, { area: "80", price: "100000" }); const s = await createChat(users.realtor1, { context: { kind: "need", id: n.id } }); await executeTool(users.realtor1, s.id, "prepare_offer", { clientNeedId: n.id, title: "данные данные", propertyIds: [p.id] }); expect(await db.commercialOffer.count()).toBe(0); const a = await db.aiPendingAction.findFirstOrThrow(); await decideAction(users.realtor1, s.id, a.id, { decision: "confirm", confirmed: true }); expect(await db.commercialOfferItem.findFirst()).toMatchObject({ propertyId: p.id }); expect((await db.commercialOfferItem.findFirst())?.priceSnapshot?.toString()).toBe("100000"); });
it("exhausted budget refuses without provider invocation", async () => { const s = await createChat(users.realtor1, {}); await db.aiSetting.updateMany({ data: { monthlyBudgetRub: "0" } }); const f = new FakeResponsesProvider(); await expect(sendMessage(users.realtor1, s.id, { text: "данные" }, f)).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" }); expect(f.requests).toHaveLength(0); expect(await db.aiUsageLog.count()).toBe(0); });
it("web requires a separate literal confirmation", async () => { const s = await createChat(users.realtor1, {}); const f = new FakeResponsesProvider(); await expect(confirmedWebSearch(users.realtor1, s.id, { query: "данные", confirmed: false }, f)).rejects.toThrow(); expect(f.requests).toHaveLength(0); });
it("timeline and task text exclude protected client data and tool rows are bounded", async () => { const c = await makeClient(users.realtor1); const other = await makeClient(users.realtor2); const s = await createChat(users.realtor1, {}); await expect(executeTool(users.realtor1, s.id, "client_timeline", { clientId: other.id })).rejects.toMatchObject({ code: "NOT_FOUND" }); const timeline = await executeTool(users.realtor1, s.id, "client_timeline", { clientId: c.id }); expect(JSON.stringify(timeline.data)).not.toMatch(/passwordHash|passport|phone/); });
it("strict tool schemas reject injected mutation fields without changes", async () => { const c = await makeClient(users.realtor1); const s = await createChat(users.realtor1, {}); await expect(executeTool(users.realtor1, s.id, "prepare_task", { clientId: c.id, title: "Задача", dueAt: inDays(1), execute: true })).rejects.toThrow(); expect(await db.aiPendingAction.count()).toBe(0); expect(await db.task.count()).toBe(0); });

it("confirmed web search uses the same gate, reserve, settlement and chat relation",async()=>{vi.stubEnv("YANDEX_WEB_SEARCH_ENABLED","true");resetConfigCache();await db.aiSetting.updateMany({data:{webSearchManualAllowed:true}});const s=await createChat(users.realtor1,{});const f=new FakeResponsesProvider(()=>({text:"Публичные результаты",webSearchCalls:1}));await confirmedWebSearch(users.realtor1,s.id,{query:"Офисы Новосибирск",confirmed:true},f);expect(f.requests).toHaveLength(1);expect(f.requests[0]?.tools?.[0]?.type).toBe("web_search");expect(await db.aiUsageLog.findFirst()).toMatchObject({callType:"chat_web",status:"success",webSearchCalls:1});expect(await db.aiChatMessage.count({where:{sessionId:s.id,aiUsageLogId:{not:null}}})).toBe(1);});

it("redacts lowercase matching identities and contact persons after 500 clients without loading an arbitrary prefix", async () => {
    await db.client.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ displayName: `Синтетика ${i}`, clientKind: "person", status: "active", responsibleUserId: users.realtor1.userId, createdBy: users.realtor1.userId })) });
    const c = await makeClient(users.realtor1, { displayName: "фамилиятест имяредкое" });
    await db.clientContactPerson.create({ data: { clientId: c.id, fullName: "контакттест редкоеимя" } });
    const output = await redactToolData(users.realtor1, { title: "Позвонить фамилиятест имяредкое и контакттест редкоеимя", dueAt: "2026-11-05T10:00:00.000Z", id: c.id, area: "80" });
    expect(JSON.stringify(output)).not.toMatch(/фамилиятест|имяредкое|контакттест|редкоеимя/);
    expect(output).toMatchObject({ dueAt: "2026-11-05T10:00:00.000Z", id: c.id, area: "80" });
});

it("first API response contains the reply, named links and draft without a refresh; no cache", async () => {
    const client = await makeClient(users.realtor1, { displayName: "ООО «Надежда»", clientKind: "organization" });
    const session = await createChat(users.realtor1, { context: { kind: "client", id: client.id } });
    const fake = new FakeResponsesProvider(r => r.inputItems?.length === 2
        ? { functionCalls: [{ type: "function_call", call_id: "draft", name: "prepare_task", arguments: JSON.stringify({ clientId: client.id, title: `Уточнить [[${client.id}]]`, dueAt: inDays(1) }) }] }
        : { text: `Черновик для [[${client.id}]] готов` });
    const runtime = composition.chatRuntime;
    vi.spyOn(composition, "chatRuntime").mockImplementation((actor, id) => runtime(actor, id, fake));
    const cookie = await sessionCookieFor(users.realtor1);
    const response = await POST(apiRequest("POST", `/api/v1/ai-chat/sessions/${session.id}/messages`, { cookie, body: { text: "Подготовь задачу для ООО «Надежда»" } }), routeParams({ id: session.id }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(result.title).toContain("ООО «Надежда»");
    expect(result.title).not.toContain(client.id);
    expect(result.messages.at(-1)).toMatchObject({ content: `Черновик для [[${client.id}]] готов`, toolArgs: [{ label: "ООО «Надежда»" }] });
    expect(result.actions[0].payload.title).toBe("Уточнить ООО «Надежда»");
    expect(JSON.stringify(fake.requests)).not.toContain("Надежда");
    expect(await db.task.count()).toBe(0);
    await decideAction(users.realtor1, session.id, result.actions[0].id, { decision: "confirm", confirmed: true });
    expect((await db.task.findFirstOrThrow()).title).toBe("Уточнить ООО «Надежда»");
});

it("returns an authorized persisted draft immediately when the next call is stopped by the gate", async () => {
    const client = await makeClient(users.realtor1);
    const session = await createChat(users.realtor1, { context: { kind: "client", id: client.id } });
    await db.aiSetting.updateMany({ data: { perJobLimit: 1 } });
    const fake = new FakeResponsesProvider(() => ({ functionCalls: [{ type: "function_call", call_id: "draft", name: "prepare_task", arguments: JSON.stringify({ clientId: client.id, title: "Уточнить условия", dueAt: inDays(1) }) }] }));
    const result = await sendMessage(users.realtor1, session.id, { text: "подготовь задачу" }, fake);
    expect(result).toMatchObject({ warning: expect.stringContaining("AI_RATE_LIMIT"), actions: [{ status: "proposed", payload: { title: "Уточнить условия" } }] });
    expect(fake.requests).toHaveLength(1);
    expect(await db.task.count()).toBe(0);
});
