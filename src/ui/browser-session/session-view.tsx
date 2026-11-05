"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiCall, ApiCallError } from "@/ui/api-client";
import type { SessionFrame, SessionInput, SessionStatus } from "@/modules/browser-sessions/domain/session";

const labels: Record<SessionStatus, string> = { pending: "Открываем площадку…", active: "Пройдите проверку на площадке", completed: "Проверка пройдена. Поиск продолжен, сеанс закрыт.", cancelled: "Сеанс отменён", expired: "Время сеанса истекло", failed: "Площадка недоступна. Сеанс безопасно закрыт." };
export function BrowserSessionView({ id, searchRunId }: { id: string; searchRunId?: string }) {
  const searchUrl = searchRunId ? `/property-search?runId=${encodeURIComponent(searchRunId)}` : "/property-search";
  const canvas = useRef<HTMLCanvasElement>(null); const sequence = useRef(0);
  const terminal = useRef(false);
  const inputQueue = useRef(Promise.resolve()); const queued = useRef(0);
  const [status, setStatus] = useState<SessionStatus>("pending"); const [error, setError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false); const [frameReady, setFrameReady] = useState(false); const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const live = status === "active" || status === "pending";
  const explain = useCallback((e: unknown) => setError(e instanceof ApiCallError ? (e.status === 404 ? "Сеанс не найден или недоступен. Доступ есть только у владельца." : e.message) : "Не удалось связаться с сервером. Повторите попытку."), []);
  useEffect(() => {
    if (!live) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await apiCall<{ status: SessionStatus; continuing: boolean; frame: SessionFrame | null }>("GET", `/api/v1/browser-sessions/${id}/frame?after=${sequence.current}`);
        if (disposed || terminal.current) return;
        if (result.status !== "pending" && result.status !== "active") terminal.current = true;
        setStatus(result.status); setContinuing(!terminal.current && result.continuing); setError(null);
        if (result.frame && result.frame.sequence !== sequence.current) {
          sequence.current = result.frame.sequence;
          const image = new Image(); image.onload = () => { if (!disposed && !terminal.current) { canvas.current?.getContext("2d")?.drawImage(image, 0, 0, 1280, 800); setFrameReady(true); } };
          image.src = `data:image/jpeg;base64,${result.frame.jpeg}`;
        }
      } catch (e) {
        if (!disposed) {
          explain(e);
          if (e instanceof ApiCallError && [401, 403, 404].includes(e.status)) {
            terminal.current = true; setStatus("failed"); setContinuing(false);
            canvas.current?.getContext("2d")?.clearRect(0, 0, 1280, 800);
          }
        }
      }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 500); }
    }
    void poll(); return () => { disposed = true; clearTimeout(timer); };
  }, [id, live, explain]);
  useEffect(() => {
    if (live) return;
    canvas.current?.getContext("2d")?.clearRect(0, 0, 1280, 800); setFrameReady(false); setText("");
  }, [live]);
  function input(event: SessionInput) {
    if (!live || continuing || busy || queued.current >= 32) return;
    queued.current++;
    inputQueue.current = inputQueue.current.then(async () => {
      try { if (!terminal.current) await apiCall("POST", `/api/v1/browser-sessions/${id}/input`, event); }
      catch (e) { explain(e); }
      finally { queued.current--; await new Promise<void>(r => setTimeout(r, 60)); }
    });
  }
  async function action(action: "complete" | "cancel") {
    setBusy(true); setError(null);
    try { if (action === "complete") await inputQueue.current; const result = await apiCall<{ status: SessionStatus }>("POST", `/api/v1/browser-sessions/${id}/${action}`); terminal.current = result.status !== "pending" && result.status !== "active"; setStatus(result.status); setContinuing(false); }
    catch (e) { explain(e); } finally { setBusy(false); }
  }
  function coordinates(event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1279, Math.floor((event.clientX - rect.left) * 1280 / rect.width))), y: Math.max(0, Math.min(799, Math.floor((event.clientY - rect.top) * 800 / rect.height))) };
  }
  return <section className="space-y-3" aria-label="Проверка на площадке">
    <p role="status">{live && continuing ? "Проверка пройдена. Продолжаем поиск…" : labels[status]}</p>
    <p className="text-sm text-slate-500">Сеанс виден только вам. Нажмите на экран для ввода; доступны клавиши, прокрутка и Tab. Закрытие вкладки не отменяет тайм-аут: 10 минут бездействия, не более 20 минут всего.</p>
    {error ? <div role="alert" className="field-error">{error}<button className="btn btn-secondary ml-2" onClick={() => { setError(null); }}>Повторить</button></div> : null}
    {live && !frameReady ? <p>Ожидаем изображение площадки…</p> : null}
    <canvas ref={canvas} width={1280} height={800} tabIndex={live && !continuing ? 0 : -1} role="application" aria-label="Экран площадки" aria-disabled={!live || continuing}
      className={`w-full rounded border bg-slate-100 outline-blue-500 ${live ? "" : "hidden"}`} style={{ aspectRatio: "8 / 5", maxWidth: 1280 }}
      onClick={e => { e.currentTarget.focus(); void input({ type: "click", ...coordinates(e) }); }}
      onWheel={e => { if (live) void input({ type: "scroll", ...coordinates(e), deltaY: Math.max(-1600, Math.min(1600, Math.round(e.deltaY))) }); }}
      onKeyDown={e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
        const keys = ["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
        if (keys.includes(e.key)) { e.preventDefault(); void input({ type: "key", key: e.key as Extract<SessionInput, { type: "key" }>["key"] }); }
        else if (e.key.length === 1) { e.preventDefault(); void input({ type: "text", text: e.key }); }
      }} />
    <div className="flex flex-wrap gap-2">{live ? <><button className="btn btn-primary" disabled={busy || continuing || !frameReady} onClick={() => void action("complete")}>{busy ? "Ожидаем…" : "Готово"}</button><button className="btn btn-secondary" disabled={busy} onClick={() => void action("cancel")}>Отменить сеанс</button></> : null}
      <Link className="btn btn-secondary" href={searchUrl}>Вернуться к поиску</Link>
      {!live && status !== "completed" ? <><Link className="btn btn-secondary" href="/import">Ручной импорт</Link><Link className="btn btn-secondary" href={searchUrl}>Добавить по ссылке</Link></> : null}
    </div>
    {live ? <form className="flex flex-wrap gap-2" autoComplete="off" onSubmit={e => { e.preventDefault(); if (text) { input({ type: "text", text }); setText(""); } }}>
      <label className="text-sm">Текст для площадки (после выбора поля на экране)<input aria-label="Текст для площадки" className="input ml-2" type="password" autoComplete="off" maxLength={128} value={text} onChange={e => setText(e.target.value)} disabled={busy || continuing} /></label>
      <button className="btn btn-secondary" disabled={busy || continuing || !text} type="submit">Передать текст</button>
    </form> : null}
  </section>;
}
