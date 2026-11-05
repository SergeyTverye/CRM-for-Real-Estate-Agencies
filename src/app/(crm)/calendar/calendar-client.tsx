"use client";
import { useCallback, useRef, useState } from "react";
import type { EventSourceFunc } from "@fullcalendar/core";
import FullCalendar from "@fullcalendar/react";
import { CalendarQuickCreate } from "./quick-create";
import type { NeedLabels } from "@/ui/domain/deal-pickers";
import dayGrid from "@fullcalendar/daygrid";
import timeGrid from "@fullcalendar/timegrid";
import list from "@fullcalendar/list";
import interaction from "@fullcalendar/interaction";
import ru from "@fullcalendar/core/locales/ru";
import type { CalendarItem } from "@/modules/calendar/domain/calendar-rules";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner } from "@/ui/form";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/shared/time";
import { optionsOf } from "@/shared/codebook";

type EventRecord = { id?: string; title: string; description: string | null; startAt: string; endAt: string; allDay: boolean; visibility: string; recurrenceRule: string | null; updatedAt?: string; clientId?: string | null; needId?: string | null; propertyId?: string | null; dealId?: string | null };
export function CalendarClient({ timeZone, userId, users, labels }: { timeZone: string; userId: string; users: { value: string; label: string }[]; labels: NeedLabels }) {
  const calendar = useRef<FullCalendar>(null);
  const [employee, setEmployee] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const action = useApiAction();
  const setError = action.setError;
  useUnsavedChangesWarning(dirty);
  const refresh = () => calendar.current?.getApi().refetchEvents();
  const local = (iso: string) => iso.length === 10 ? iso : toDateTimeLocalValue(iso, timeZone);
  // Without a premium timezone plugin, UTC is a display coordinate. Convert at both boundaries.
  const utc = (date: Date) => fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone);
  const loadEvents = useCallback<EventSourceFunc>((range, success, failure) => {
    const toUtc = (date: Date) => fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone);
    const displayTime = (iso: string) => iso.length === 10 ? iso : toDateTimeLocalValue(iso, timeZone);
    const q = new URLSearchParams({ from: toUtc(range.start), to: toUtc(range.end), ...(employee ? { employee } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}) });
    apiCall<{ items: CalendarItem[] }>("GET", `/api/v1/calendar?${q}`).then(({ items }) => {
      setEmpty(!items.length);
      success(items.map(e => ({ id: e.id, title: e.title, start: displayTime(e.start), ...(e.end ? { end: displayTime(e.end) } : {}), allDay: e.allDay,
        editable: e.editable && !e.recurrenceRule, extendedProps: { item: e }, color: e.type === "calendar_event" ? "#475569" : e.type === "showing" ? "#047857" : "#2563eb" })));
    }).catch(e => { failure(e); setError({ code: "LOAD_ERROR", message: e.message }); });
  }, [timeZone, employee, type, status, setError]);
  const openNew = (start = new Date().toISOString()) => {
    setEditing({ title: "", description: "", startAt: start, endAt: new Date(+new Date(start) + 3600000).toISOString(), allDay: false, visibility: "private", recurrenceRule: null });
    setDirty(false);
  };
  function close() { if (!dirty || window.confirm("Закрыть без сохранения?")) { setEditing(null); setDirty(false); } }
  return <div>
    <h1 className="text-2xl font-semibold">Календарь</h1><p className="mb-3 text-sm">Часовой пояс: {timeZone}. Срок задачи и показ без длительности — точечные события.</p>
    <div className="mb-4 flex flex-wrap gap-2">
      <button className="btn btn-primary" onClick={() => openNew()}>+ Встреча / личная запись</button>
      <CalendarQuickCreate timeZone={timeZone} users={users} labels={labels} onDone={refresh} />
      <label>Сотрудник <select className="input" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Все доступные</option><option value={userId}>Я</option>{users.filter(u => u.value !== userId).map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
      <label>Тип <select className="input" value={type} onChange={e => setType(e.target.value)}><option value="">Все</option>{[["task","Задача"],["showing","Показ"],["agreement","Договор"],["calendar_event","Встреча / запись"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Статус <select className="input" value={status} onChange={e => setStatus(e.target.value)}><option value="">Все</option>{[...optionsOf("taskStatus"), { value: "scheduled", label: "Встреча" }, { value: "busy", label: "Занято" }, { value: "active", label: "Действующий договор" }].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <button className="btn" onClick={refresh}>Обновить</button>
    </div>
    <FormErrorBanner error={action.error} onRetry={() => { close(); refresh(); }} />
    {loading ? <p role="status">Загрузка календаря…</p> : empty ? <p>В выбранном периоде событий нет. Выберите свободное время для создания встречи.</p> : null}
    <FullCalendar ref={calendar} plugins={[dayGrid, timeGrid, list, interaction]} locale={ru} timeZone="UTC" initialView="timeGridWeek"
      headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth,listWeek" }}
      height="auto" firstDay={1} now={local(new Date().toISOString())} selectable eventDurationEditable={false} forceEventDuration={false} displayEventEnd={false}
      loading={setLoading}
      events={loadEvents}
      select={r => { openNew(utc(r.start)); calendar.current?.getApi().unselect(); }}
      eventClick={e => {
        const item = e.event.extendedProps.item as CalendarItem;
        if (item.type === "calendar_event" && item.editable && item.sourceId) {
          void action.run(async () => { setEditing(await apiCall<EventRecord>("GET", `/api/v1/calendar/events/${item.sourceId}`)); setDirty(false); return true; });
        } else if (item.url) window.location.assign(item.url);
      }}
      eventDrop={e => {
        const item = e.event.extendedProps.item as CalendarItem;
        void action.run(async () => {
          try {
            const result = await apiCall<{ warning?: string }>("POST", "/api/v1/calendar/move", { type: item.type, id: item.sourceId, startAt: utc(e.event.start!), expectedUpdatedAt: item.updatedAt });
            if (result.warning) window.alert(result.warning);
            refresh(); return true;
          } catch (error) { e.revert(); throw error; }
        });
      }} />
    {editing ? <EventEditor key={editing.id ?? editing.startAt} initial={editing} timeZone={timeZone} onDirty={() => setDirty(true)} onClose={close} onSaved={() => { setDirty(false); setEditing(null); refresh(); }} /> : null}
  </div>;
}

function EventEditor({ initial, timeZone, onDirty, onClose, onSaved }: { initial: EventRecord; timeZone: string; onDirty: () => void; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(initial);
  const action = useApiAction();
  const change = (patch: Partial<EventRecord>) => { setValue(v => ({ ...v, ...patch })); onDirty(); };
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Встреча / личная запись">
    <form className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-y-auto rounded bg-white p-5" onSubmit={e => { e.preventDefault(); void action.run(async () => {
      const result = await apiCall<{ warning?: string }>(initial.id ? "PATCH" : "POST", initial.id ? `/api/v1/calendar/events/${initial.id}` : "/api/v1/calendar/events", { ...value, expectedUpdatedAt: initial.updatedAt });
      if (result.warning) window.alert(result.warning);
      onSaved(); return true;
    }); }}>
      <h2 className="text-xl font-semibold">{initial.id ? "Изменить серию / встречу" : "Новая встреча / личная запись"}</h2>
      <FormErrorBanner error={action.error} onRetry={onClose} />
      <Field label="Заголовок" required error={action.fieldError("title")}><input className="input" required maxLength={300} value={value.title} onChange={e => change({ title: e.target.value })} /></Field>
      <Field label="Описание"><textarea className="input" maxLength={4000} value={value.description ?? ""} onChange={e => change({ description: e.target.value })} /></Field>
      {(["startAt", "endAt"] as const).map(key => <Field key={key} label={key === "startAt" ? "Начало" : "Окончание"} error={action.fieldError(key)} required><input className="input" type="datetime-local" required value={toDateTimeLocalValue(value[key], timeZone)} onChange={e => change({ [key]: fromDateTimeLocalValue(e.target.value, timeZone) })} /></Field>)}
      <label className="block"><input type="checkbox" checked={value.allDay} onChange={e => change({ allDay: e.target.checked })} /> Весь день (окончание исключается)</label>
      <Field label="Видимость"><select className="input" value={value.visibility} onChange={e => change({ visibility: e.target.value })}><option value="private">Личное — другим только «Занято»</option><option value="public">Общее</option></select></Field>
      <Field label="Повторение" hint="FREQ=DAILY, FREQ=WEEKLY или FREQ=MONTHLY;UNTIL=20271231T235959Z" error={action.fieldError("recurrenceRule")}><input className="input" value={value.recurrenceRule ?? ""} onChange={e => change({ recurrenceRule: e.target.value || null })} /></Field>
      <details><summary>Ссылки на CRM (ID записей)</summary>{(["clientId", "needId", "propertyId", "dealId"] as const).map((key, index) => <Field key={key} label={["Клиент", "Потребность", "Объект", "Сделка"][index]!}><input className="input" value={value[key] ?? ""} onChange={e => change({ [key]: e.target.value || null })} /></Field>)}</details>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={action.pending}>{action.pending ? "Сохранение…" : "Сохранить"}</button><button type="button" className="btn" onClick={onClose}>Закрыть</button>{initial.id ? <button type="button" className="btn" disabled={action.pending} onClick={() => { if (window.confirm("Удалить встречу / всю серию?")) void action.run(async () => { await apiCall("DELETE", `/api/v1/calendar/events/${initial.id}`, { expectedUpdatedAt: initial.updatedAt }); onSaved(); return true; }); }}>Удалить</button> : null}</div>
    </form>
  </div>;
}
