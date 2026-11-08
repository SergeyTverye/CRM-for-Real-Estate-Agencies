"use client";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiCall, ApiCallError } from "@/ui/api-client";
import { useUnsavedChangesWarning } from "@/ui/hooks";
import { pageContext, contextLabels, quickQuestions, taskFormHref } from "@/modules/ai-chat/domain/context";
import type { RecordLink } from "@/modules/ai-chat/domain/policy";
type Session = {
    id: string;
    title: string;
    contextType: string;
    contextId: string | null;
};
type Action = {
    id: string;
    actionType: string;
    status: string;
    payload: {
        title: string;
        dueAt?: string;
        description?: string;
        propertyIds?: string[];
        clientId?: string;
        clientNeedId?: string;
    };
};
type Chat = Session & {
    warning?: string;
    messages: {
        id: string;
        role: string;
        content: string;
        toolArgs: RecordLink[] | null;
    }[];
    actions: Action[];
};
function Message({ text, links }: {
    text: string;
    links: RecordLink[];
}) {
    const referenced = new Set<string>();
    const parts = text.split(/(\[\[[0-9a-f-]{36}\]\])/gi).map((part, i) => { const id = part.match(/^\[\[([0-9a-f-]{36})\]\]$/i)?.[1]; const l = links.find(l => l.id === id); if (l) {
        referenced.add(l.id);
        return <Link className="text-blue-700 underline" href={l.href} key={i}>{l.label}</Link>;
    } return <span key={i}>{part.replace(/\[PERSON\]/g, "данные скрыты").replace(/\[\[[0-9a-f-]{36}\]\]/gi, "[запись]").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "[запись]")}</span>; });
    return <><p className="whitespace-pre-wrap">{parts}</p><div className="mt-2 flex flex-wrap gap-2">{links.filter(l => !referenced.has(l.id)).slice(0, 10).map(l => <Link className="text-blue-700 underline" key={l.id} href={l.href}>{l.label}</Link>)}</div></>;
}
export function AiChatPanel() {
    const path = usePathname();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [chat, setChat] = useState<Chat | null>(null);
    const activeKind = (chat?.contextType ?? pageContext(path).kind) as keyof typeof contextLabels;
    const contextChanged = !!chat && (chat.contextType !== pageContext(path).kind || chat.contextId !== (pageContext(path).id ?? null));
    const [text, setText] = useState("");
    const [pending, setPending] = useState(false);
    const working = useRef(false);
    const [error, setError] = useState("");
    const [feedback, setFeedback] = useState("");
    const [webPreview, setWebPreview] = useState(false);
    useUnsavedChangesWarning(!!text);
    async function run(work: () => Promise<void>) { if (working.current) return; working.current = true; setPending(true); setError(""); setFeedback(""); try {
        await work();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Личные диалоги");
    }
    finally {
        working.current = false;
        setPending(false);
    } }
    async function refreshSessions() { setSessions((await apiCall<{
        items: Session[];
    }>("GET", "/api/v1/ai-chat/sessions")).items); }
    async function create() { const s = await apiCall<Session>("POST", "/api/v1/ai-chat/sessions", { context: pageContext(path) }); setChat({ ...s, messages: [], actions: [] }); await refreshSessions(); }
    async function send() { let active = chat; if (!active) {
        const s = await apiCall<Session>("POST", "/api/v1/ai-chat/sessions", { context: pageContext(path) });
        active = { ...s, messages: [], actions: [] };
        setChat(active);
    } try {
        const result = await apiCall<Chat>("POST", `/api/v1/ai-chat/sessions/${active.id}/messages`, { text });
        setChat(result); setText(""); setFeedback(result.warning ?? "");
    } catch (error) {
        // A draft or reply may already be durable after a gate/network failure.
        // Read only: never repeat the paid POST automatically.
        try { setChat(await apiCall<Chat>("GET", `/api/v1/ai-chat/sessions/${active.id}`)); }
        catch (refreshError) { if (refreshError instanceof ApiCallError && [403, 404].includes(refreshError.status)) setChat(null); }
        throw error;
    }
    await refreshSessions(); }
    async function decide(a: Action, decision: "confirm" | "reject") { if (!chat)
        return; await apiCall("POST", `/api/v1/ai-chat/sessions/${chat.id}/actions/${a.id}`, { decision, confirmed: true }); setChat(await apiCall<Chat>("GET", `/api/v1/ai-chat/sessions/${chat.id}`)); setFeedback(decision === "confirm" ? "Действие подтверждено и выполнено" : "Черновик отклонён. CRM не изменена."); router.refresh(); }
    return <Dialog.Root open={open} onOpenChange={value => { setOpen(value); if (value)
        void run(refreshSessions); }}>
 <Dialog.Trigger asChild><button type="button" className="btn btn-sm" aria-label="Открыть AI-помощника">AI-помощник</button></Dialog.Trigger>
 <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/25"/><Dialog.Content className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-xl flex-col border-l bg-white p-4 shadow-xl">
 <div className="flex items-center justify-between gap-2"><Dialog.Title className="text-lg font-semibold">AI-помощник</Dialog.Title><Dialog.Close className="btn btn-sm">Закрыть</Dialog.Close></div>
 <Dialog.Description className="mt-1 text-sm text-slate-600">Личная история. Изменения выполняются после предпросмотра и подтверждения.</Dialog.Description>
 <div className="my-3 flex gap-2"><select aria-label="История диалогов" className="input min-w-0 flex-1" disabled={pending || !!text} value={chat?.id ?? ""} onChange={e => void run(async () => { setChat(await apiCall<Chat>("GET", `/api/v1/ai-chat/sessions/${e.target.value}`)); })}><option value="" disabled>Личные диалоги</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select><button className="btn btn-sm" disabled={pending || !!text} onClick={() => void run(create)}>Новый диалог</button></div>
 <p className="text-xs text-slate-600">{contextLabels[activeKind] ?? "общий"}. Новый диалог использует текущую страницу.</p>
 {contextChanged && <p role="status" className="mt-2 text-sm text-amber-800">Страница изменилась. Для её контекста нажмите «Новый диалог».</p>}
 <div className="mt-2 flex flex-wrap gap-2">{quickQuestions(activeKind).map(q => <button key={q} type="button" className="btn btn-sm text-left" disabled={pending} onClick={() => setText(q)}>{q}</button>)}</div>
 <div className="mt-2 flex gap-2"><Link className="btn btn-sm" href={taskFormHref(chat ? { kind: activeKind, ...(chat.contextId ? { id: chat.contextId } : {}) } : pageContext(path))} onClick={() => setOpen(false)}>Создать задачу</Link><span className="text-xs text-slate-500">Откроется форма: проверьте связи и срок перед сохранением.</span></div>
 <div className="my-3 flex-1 space-y-3 overflow-y-auto" aria-live="polite">{!chat?.messages.length && <p className="p-4 text-sm text-slate-500">Спросите о задачах, истории клиента или сравнении объектов. Можно подготовить черновик задачи или КП.</p>}{chat?.messages.map(m => <article key={m.id} className={`rounded border p-3 text-sm ${m.role === "user" ? "bg-slate-50" : "bg-blue-50"}`}><p className="mb-1 font-semibold">{m.role === "user" ? "Вы" : "Помощник"}</p><Message text={m.content} links={Array.isArray(m.toolArgs) ? m.toolArgs : []}/></article>)}
 {chat?.actions.map(a => <section key={a.id} className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><p className="font-semibold">Черновик {a.actionType === "task" ? "задачи" : "КП"}: {a.payload.title}</p>{a.payload.description && <p>{a.payload.description}</p>}{a.payload.dueAt && <p>Срок: {new Date(a.payload.dueAt).toLocaleString("ru-RU", { timeZone: "Asia/Novosibirsk" })} (Новосибирск)</p>}{a.payload.clientId && <Link className="text-blue-700 underline" href={`/clients/${a.payload.clientId}`}>Открыть клиента</Link>}{a.payload.clientNeedId && <Link className="text-blue-700 underline" href={`/needs/${a.payload.clientNeedId}`}>Открыть потребность</Link>}{a.payload.propertyIds?.map((id, i) => <p key={id}><Link className="text-blue-700 underline" href={`/properties/${id}`}>Объект {i + 1}</Link></p>)}{a.status === "proposed" ? <div className="mt-2 flex gap-2"><button className="btn btn-sm" disabled={pending} onClick={() => void run(() => decide(a, "confirm"))}>Подтвердить</button><button className="btn btn-sm" disabled={pending} onClick={() => void run(() => decide(a, "reject"))}>Отклонить</button></div> : <p>{a.status === "confirmed" ? "Подтверждено" : a.status === "rejected" ? "Отклонено" : "Истёк срок"}</p>}</section>)}
 </div>{error && <p role="alert" className="mb-2 text-sm text-red-700">{error} <button className="underline" onClick={() => void run(async () => { if (chat)
        setChat(await apiCall<Chat>("GET", `/api/v1/ai-chat/sessions/${chat.id}`)); await refreshSessions(); })}>Обновить данные</button></p>}{feedback && <p role="status" className="mb-2 text-sm text-green-700">{feedback}</p>}{pending && <p role="status" className="mb-2 text-sm">Выполняется…</p>}
 <form onSubmit={e => { e.preventDefault(); void run(send); }} className="space-y-2"><label className="block text-sm" htmlFor="ai-chat-message">Сообщение</label><textarea id="ai-chat-message" className="input min-h-24 w-full" maxLength={4000} value={text} onChange={e => setText(e.target.value)} disabled={pending}/><div className="flex flex-wrap gap-2"><button className="btn" disabled={pending || !text.trim()}>Отправить</button><button type="button" className="btn btn-sm" disabled={pending || !chat || !text.trim()} onClick={() => setWebPreview(!webPreview)}>Платный веб-поиск…</button></div></form>
 {webPreview && <div className="mt-2 rounded border p-3 text-sm"><p>Отправить текст сообщения в платный поиск Yandex? Стоимость учитывается в общем бюджете CRM.</p><button className="btn btn-sm mt-2" disabled={pending} onClick={() => void run(async () => { if (!chat)
        return; setWebPreview(false); setChat(await apiCall<Chat>("POST", `/api/v1/ai-chat/sessions/${chat.id}/web-search`, { query: text, confirmed: true })); setText(""); })}>Подтвердить платный поиск</button><button className="btn btn-sm ml-2" onClick={() => setWebPreview(false)}>Отмена</button></div>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
