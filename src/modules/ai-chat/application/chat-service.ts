import { getConfig } from "@/shared/config/env";
import { modelTimeData, modelTimeInstructions } from "@/modules/ai/domain/model-time";
import { Prisma } from "@/generated/prisma/client";
import { lockSql } from "@/shared/db/dialect";
import { z } from "zod";
import { db, transaction, type Tx } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { parseInput } from "@/shared/validation";
import { DomainError, NotFoundError } from "@/shared/errors";
import { clientScope, taskScope, needScope, offerScope, showingScope, documentScope, propertyReadScope } from "@/modules/access/domain/scopes";
import { AiError, type ResponsesProvider, type ResponseInput } from "@/modules/ai/domain/contracts";
import { createTask } from "@/modules/tasks/application/task-service";
import { createOffer } from "@/modules/commercial-offers/application/offer-service";
import { writeAudit } from "@/modules/audit/application/audit";
import { contextSchema, safeText, referenceText, displayText, taskProposal, offerProposal, instructions, type RecordLink, type ChatContext } from "../domain/policy";
import { runChatLoop } from "../domain/loop";
import { chatRuntime } from "../infrastructure/composition";
import { safeTaskTextScope } from "@/modules/notifications/application/notification-context";
import { assembleScreenContext } from "./screen-context";
import { checkContext, modelContext, collectionScope, listingScope, executeTool, validateProposal, redactScreenData } from "./tools";
const sessionContext = (s: {
    contextType: string;
    contextId: string | null;
}) => contextSchema.parse({ kind: s.contextType, ...(s.contextId ? { id: s.contextId } : {}) });
async function contextLinks(actor: Actor, context: ChatContext, tx: Tx | typeof db = db): Promise<RecordLink[]> {
    await checkContext(actor, context, tx);
    if (context.kind === "client" || context.kind === "need") {
        const clientId = context.kind === "client" ? context.id : (await tx.clientNeed.findUniqueOrThrow({ where: { id: context.id }, select: { clientId: true } })).clientId;
        const client = await tx.client.findFirstOrThrow({ where: { id: clientId, ...clientScope(actor) }, select: { id: true, displayName: true } });
        return [{ id: client.id, label: client.displayName, href: `/clients/${client.id}` }];
    }
    if (context.kind === "collection") {
        const collection = await tx.propertyCollection.findFirstOrThrow({ where: { id: context.id, ...collectionScope(actor) }, select: { id: true, name: true } });
        return [{ id: collection.id, label: collection.name, href: `/collections/${collection.id}` }];
    }
    return [];
}
export async function loadSession(actor: Actor, id: string, tx: Tx | typeof db = db) {
    const s = await tx.aiChatSession.findFirst({ where: { id, ownerUserId: actor.userId, archivedAt: null } });
    if (!s)
        throw new NotFoundError();
    await checkContext(actor, sessionContext(s), tx);
    return s;
}
export async function createChat(actor: Actor, raw: unknown) {
    const p = parseInput(z.object({ context: contextSchema.default({ kind: "none" }) }).strict(), raw);
    await checkContext(actor, p.context);
    return db.aiChatSession.create({ data: { ownerUserId: actor.userId, title: "Новый диалог", contextType: p.context.kind, contextId: p.context.id } });
}
export async function listChats(actor: Actor) {
    const rows = await db.aiChatSession.findMany({ where: { ownerUserId: actor.userId, archivedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 30 });
    const visible = [];
    for (const s of rows) {
        try {
            await checkContext(actor, sessionContext(s));
            visible.push({ ...s, title: displayText(s.title, await contextLinks(actor, sessionContext(s))) });
        }
        catch {  }
    }
    return { items: visible };
}
async function checkSavedLinks(actor: Actor, value: unknown) {
    if (!Array.isArray(value))
        return;
    for (const raw of value) {
        const link = raw as {
            id: string;
            href: string;
        };
        const targetId = link.href.match(/\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? link.id;
        let allowed = true;
        if (link.href.startsWith("/reports/"))
            await checkContext(actor, { kind: "reports" });
        if (link.href.startsWith("/clients/")) {
            const client = await db.client.findFirst({ where: { id: targetId, ...clientScope(actor) }, select: { displayName: true } });
            allowed = !!client;
            if (client) (raw as { label: string }).label = client.displayName;
        }
        if (link.href.startsWith("/properties/"))
            allowed = !!await db.property.findFirst({ where: { id: targetId, ...propertyReadScope(actor) }, select: { id: true } });
        if (link.href.startsWith("/needs/"))
            allowed = !!await db.clientNeed.findFirst({ where: { id: targetId, AND: [needScope(actor), { client: clientScope(actor) }] }, select: { id: true } });
        if (link.href.startsWith("/tasks/"))
            allowed = !!await db.task.findFirst({ where: { id: targetId, AND:[taskScope(actor),safeTaskTextScope(actor)] }, select: { id: true } });
        if (link.href.startsWith("/offers/"))
            allowed = !!await db.commercialOffer.findFirst({ where: { id: targetId, AND:[offerScope(actor),{need:{client:clientScope(actor)}}] }, select: { id: true } });
        if (link.href.startsWith("/deals/"))
            await checkContext(actor, { kind: "deal", id: targetId });
        if (link.href.startsWith("/agreements/"))
            await checkContext(actor, { kind: "agreement", id: targetId });
        if (link.href.startsWith("/showings/"))
            allowed = !!await db.showing.findFirst({ where: { id: targetId, ...showingScope(actor) }, select: { id: true } });
        if (link.href.startsWith("/collections/"))
            allowed = !!await db.propertyCollection.findFirst({ where: { id: targetId, ...collectionScope(actor) }, select: { id: true } });
        if (link.href.startsWith("/api/v1/documents/"))
            allowed = !!await db.document.findFirst({ where: { id: targetId, ...documentScope(actor) }, select: { id: true } });
        if(link.href.startsWith("/property-search?listingId="))
            allowed=!!await db.externalListing.findFirst({where:{id:link.id,...listingScope(actor)},select:{id:true}});
        if (!allowed)
            throw new NotFoundError();
    }
}
export async function getChat(actor: Actor, id: string) {
    const s = await loadSession(actor, id);
    const messages = await db.aiChatMessage.findMany({ where: { sessionId: id, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 40, select: { id: true, role: true, content: true, toolArgs: true, createdAt: true } });
    const actions = await db.aiPendingAction.findMany({ where: { sessionId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
    for (const m of messages)
        await checkSavedLinks(actor, m.toolArgs);
    for (const a of actions)
        await validateProposal(actor, a.actionType, a.payload);
    const links = await contextLinks(actor, sessionContext(s));
    for (const a of actions) {
        const payload = a.actionType === "task" ? taskProposal.parse(a.payload) : offerProposal.parse(a.payload);
        links.push(...await contextLinks(actor, "clientId" in payload ? { kind: "client", id: payload.clientId } : { kind: "need", id: payload.clientNeedId }));
    }
    const availableLinks = [...links, ...messages.flatMap(m => Array.isArray(m.toolArgs) ? m.toolArgs as RecordLink[] : [])];
    const visibleMessages = messages.reverse().map(m => {
        const refs = [...availableLinks.filter(l => m.content.includes(`[[${l.id}]]`)), ...(Array.isArray(m.toolArgs) ? m.toolArgs as RecordLink[] : [])];
        return { ...m, toolArgs: [...new Map(refs.map(l => [l.id, l])).values()] };
    });
    const visibleActions = actions.map(a => {
        const payload = a.payload as { title: string; description?: string };
        return { ...a, payload: { ...payload, title: displayText(payload.title, availableLinks), ...(payload.description ? { description: displayText(payload.description, availableLinks) } : {}) } };
    });
    return { ...s, title: displayText(s.title, availableLinks), messages: visibleMessages, actions: visibleActions };
}
const busy = new Set<string>();
export async function sendMessage(actor: Actor, id: string, raw: unknown, injected?: ResponsesProvider) {
    const p = parseInput(z.object({ text: z.string().trim().min(1).max(4000) }).strict(), raw);
    const s = await loadSession(actor, id);
    await getChat(actor, id);
    if (busy.has(id))
        throw new DomainError("AI_CHAT_BUSY", "Дождитесь ответа помощника.");
    busy.add(id);
    const turnStartedAt = new Date();
    try {
        const history = await db.aiChatMessage.findMany({ where: { sessionId: id, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 6 });
        const identities = await db.client.findMany({ where: clientScope(actor), select: { displayName: true, contactPersons: { select: { fullName: true } } }, take: 500 });
        const names = identities.flatMap(c => [c.displayName, ...c.contactPersons.map(p => p.fullName)]);
        const screen = await assembleScreenContext(actor, sessionContext(s));
        const references = [...new Map([...screen.links, ...await contextLinks(actor, sessionContext(s))].map(l => [l.id, l])).values()];
        const text = safeText(referenceText(p.text, references), names);
        await db.aiChatMessage.create({ data: { sessionId: id, role: "user", content: text } });
        const input: ResponseInput[] = [{ role: "user", content: JSON.stringify(modelTimeData({ context: s.contextType === "collection" ? await modelContext(actor, sessionContext(s)) : await redactScreenData(actor, screen.data), now: new Date(), untrusted_data: history.reverse().map(m => ({ role: m.role, content: safeText(m.content), links: Array.isArray(m.toolArgs)?m.toolArgs.map(v=>({id:(v as {id?:string})?.id})):[] })) }, getConfig().APP_TIMEZONE)) }, { role: "user", content: text }];
        const runtime = await chatRuntime(actor, id, injected);
        const result = await runChatLoop(input, r => runtime.call(r), (name, args) => executeTool(actor, id, name, args), runtime.model, getConfig().APP_TIMEZONE);
        await loadSession(actor, id);
        await db.aiChatMessage.create({ data: { sessionId: id, role: "assistant", content: result.text, toolArgs: JSON.parse(JSON.stringify([...references, ...result.links])) } });
        await db.aiChatSession.update({ where: { id }, data: { title: s.title === "Новый диалог" ? displayText(text, references).slice(0, 70) : s.title, updatedAt: new Date() } });
        return await getChat(actor, id);
    }
    catch (e) {
        if (e instanceof AiError && await db.aiPendingAction.count({ where: { sessionId: id, createdAt: { gte: turnStartedAt } } })) {
            return { ...await getChat(actor, id), warning: `Ответ помощника прерван (${e.code}). Сохранённый черновик доступен для проверки.` };
        }
        if (e instanceof AiError)
            throw new DomainError(e.code, `Помощник не выполнил запрос: ${e.code}. Проверьте лимиты ИИ или сократите запрос.`);
        throw e;
    }
    finally {
        busy.delete(id);
    }
}
export async function decideAction(actor: Actor, sessionId: string, actionId: string, raw: unknown) {
    const p = parseInput(z.object({ decision: z.enum(["confirm", "reject"]), confirmed: z.literal(true) }).strict(), raw);
    return transaction(async (tx) => {
        await loadSession(actor, sessionId, tx);
        await tx.$queryRaw(lockSql(Prisma.sql`SELECT id FROM ai_pending_actions WHERE id=${actionId}::uuid FOR UPDATE`));
        const a = await tx.aiPendingAction.findFirst({ where: { id: actionId, sessionId } });
        if (!a)
            throw new NotFoundError();
        if (a.status !== "proposed")
            return { status: a.status };
        if (a.expiresAt && a.expiresAt < new Date())
            throw new DomainError("AI_DRAFT_EXPIRED", "Черновик устарел. Подготовьте новый.");
        let record: {
            id: string;
        } | undefined;
        if (p.decision === "confirm") {
            await validateProposal(actor, a.actionType, a.payload, tx);
            if (a.actionType === "task") {
                const d = taskProposal.parse(a.payload);
                const links = await contextLinks(actor, { kind: "client", id: d.clientId }, tx);
                record = await createTask(actor, { title: displayText(d.title, links), description: d.description ? displayText(d.description, links) : undefined, taskType: "call_or_contact", dueAt: d.dueAt, links: { clientIds: [d.clientId] } }, tx);
            }
            else if (a.actionType === "offer") {
                const d = offerProposal.parse(a.payload);
                record = await createOffer(actor, { clientNeedId: d.clientNeedId, title: d.title, items: d.propertyIds.map(propertyId => ({ propertyId })) }, tx);
            }
            else
                throw new DomainError("AI_ACTION_INVALID", "Неизвестное действие.");
        }
        const status = p.decision === "confirm" ? "confirmed" : "rejected";
        await tx.aiPendingAction.update({ where: { id: actionId }, data: { status, decidedBy: actor.userId, decidedAt: new Date() } });
        await writeAudit(tx, { actorUserId: actor.userId, action: `ai.chat.${status}`, entityType: "AiPendingAction", entityId: actionId, after: { status, recordId: record?.id } });
        if (record)
            await tx.aiChatMessage.create({ data: { sessionId, role: "assistant", content: a.actionType === "task" ? "Задача создана сотрудником." : "Черновик КП создан сотрудником.", pendingActionId: actionId, toolArgs: [{ id: record.id, label: a.actionType === "task" ? "Открыть задачу" : "Открыть КП", href: `/${a.actionType === "task" ? "tasks" : "offers"}/${record.id}` }] } });
        return { status, recordId: record?.id };
    });
}
export async function confirmedWebSearch(actor: Actor, id: string, raw: unknown, injected?: ResponsesProvider) {
    const p = parseInput(z.object({ query: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).strict(), raw);
    await loadSession(actor, id);
    try {
        const runtime = await chatRuntime(actor, id, injected);
        const r = await runtime.call({ model: runtime.webModel, instructions: instructions + " " + modelTimeInstructions + " Только публичный веб-поиск. Указывай источники; не изменяй CRM.", input: JSON.stringify(modelTimeData({ query: safeText(p.query), now: new Date() }, getConfig().APP_TIMEZONE)), maxOutputTokens: 1200, tools: [{ type: "web_search", search_context_size: "low", filters: {} }] }, true);
        await db.aiChatMessage.create({ data: { sessionId: id, role: "assistant", content: r.text.slice(0, 8000) } });
        return getChat(actor, id);
    }
    catch (e) {
        if (e instanceof AiError)
            throw new DomainError(e.code, "Внешний поиск недоступен: проверьте бюджет и настройки ИИ.");
        throw e;
    }
}
